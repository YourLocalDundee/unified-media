/**
 * Party Play — the dedicated WebSocket server and server-authority command pipeline.
 *
 * THE SERVER "BRAIN". This runs in the same process as the Next server (started
 * from instrumentation.ts) but on its own internal port (PARTY_WS_PORT, 3002),
 * because the Next standalone HTTP server cannot be reached from the
 * instrumentation hook for the upgrade event (verified against next 16.x). Caddy
 * routes wss://.../api/party/ws to this port at the edge.
 *
 * Responsibilities:
 *   - Validate the unified-session cookie at upgrade (handshake auth) and
 *     re-validate party membership on every control/heartbeat/ready/chat/reaction.
 *   - Own the serialized server-authority command pipeline (commandSeq + effectiveAt).
 *   - Run the readiness gate, drift/median reconciliation, chat backlog, reactions.
 *   - Keep sockets alive (ws ping/pong) and survive brief drops (grace window).
 *   - Checkpoint to SQLite, end empty parties, rehydrate active parties on boot.
 *
 * It talks to live state ONLY through getPartyStore() (the horizontal-scale seam),
 * and to SQLite only through the durable db helpers.
 */
import 'server-only'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, WebSocket } from 'ws'

import {
  PARTY_WS_PORT,
  PARTY_WS_PATH,
  WS_PING_INTERVAL_MS,
  WS_PONG_MISS_LIMIT,
  PLAY_LEAD_MS,
  CONTROL_LEAD_MS,
  COMMAND_DEBOUNCE_MS,
  KEEPALIVE_STATE_BROADCAST_MS,
  DISCONNECT_GRACE_MS,
  EMPTY_PARTY_IDLE_END_MS,
  CHECKPOINT_THROTTLE_MS,
  READINESS_GATE_MAX_WAIT_MS,
  DRIFT_HARD_RESEEK_S,
  MEDIAN_OUTLIER_RESEEK_S,
  SEEK_DEADBAND_S,
  POST_JOIN_SETTLE_MS,
  isAllowedReaction,
  MAX_POSITION_TICKS,
  MAX_CHAT_LENGTH,
  WS_RATE_WINDOW_MS,
  WS_CHAT_MAX_PER_WINDOW,
  WS_REACTION_MAX_PER_WINDOW,
  WS_CONTROL_MAX_PER_WINDOW,
  WS_MSG_MAX_PER_WINDOW,
  WS_MAX_MESSAGE_BYTES,
  MAX_SOCKETS_PER_USER,
  MAX_MEMBERS_PER_PARTY,
  MAX_TOTAL_PARTIES,
  MAX_QUEUE_LENGTH,
  SESSION_RECHECK_INTERVAL_MS,
  TICKS_PER_MS,
  allowedWsOrigins,
  COUNTDOWN_DURATION_MS,
} from './constants'
import {
  extrapolatePosition,
  medianReportedPositionTicks,
  secondsToTicks,
  ticksToSeconds,
} from './position'
import { getPartyStore } from './state-store'
import { parseSessionCookie, lookupPartySession } from './session'
import {
  isActiveMember,
  checkpointParty,
  endPartyRow,
  loadActiveParties,
  getPlayableMedia,
  persistQueue,
  loadQueue,
  setPartyMedia,
  getActivePartyById,
  kickMember,
  setControlLocked,
} from './db'
import { partyEvents } from './events'
import type {
  ClientMessage,
  ServerMessage,
  ErrorMessage,
  StateMessage,
  PartyLiveState,
  PartyMemberLive,
  PartySessionIdentity,
  ControlMessage,
  MemberSummary,
  ChatMessage,
  QueueItem,
  QueueItemDTO,
  QueueAddMessage,
  QueueRemoveMessage,
  QueueReorderMessage,
  QueueAdvanceRequest,
  KickMessage,
  ControlLockMessage,
  StartCountdownMessage,
} from './types'

const PERIODIC_TICK_MS = 2500

/** Per-socket rolling-window rate counters (reset every WS_RATE_WINDOW_MS). */
interface RateWindow {
  windowStart: number
  total: number
  chat: number
  reaction: number
  control: number
  /** Throttle the error reply itself so a flooder isn't answered per-message. */
  lastThrottleErrorAt: number
}

interface SocketEntry {
  id: string
  ws: WebSocket
  identity: PartySessionIdentity
  /** The unified-session id captured at upgrade, for periodic re-validation (H2). */
  sessionId: string
  partyId: string | null
  isAlive: boolean
  missedPongs: number
  rate: RateWindow
  /** Server wall clock of the last successful session re-validation. */
  lastSessionCheck: number
}

interface ServerRuntime {
  http: http.Server
  wss: WebSocketServer
  sockets: Map<string, SocketEntry>
  partySockets: Map<string, Set<string>> // partyId -> socketIds
  /** Per-party debounce tracking: last applied action + time + position. */
  lastCommand: Map<string, { action: string; at: number; positionTicks: number; paused: boolean }>
  /** Per-party timestamp of the last keepalive state broadcast. */
  lastKeepalive: Map<string, number>
  pingInterval: ReturnType<typeof setInterval>
  periodicInterval: ReturnType<typeof setInterval>
}

const GLOBAL_KEY = '__partyServerStarted'

type GlobalWithServer = typeof globalThis & {
  [GLOBAL_KEY]?: boolean
  __partyServerRuntime__?: ServerRuntime
}

function getRuntime(): ServerRuntime | undefined {
  return (globalThis as GlobalWithServer).__partyServerRuntime__
}

// ---------------------------------------------------------------------------
// Send helpers
// ---------------------------------------------------------------------------

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState !== WebSocket.OPEN) return
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    /* socket may be closing; ignore */
  }
}

function sendError(ws: WebSocket, code: string, message: string): void {
  const err: ErrorMessage = { type: 'error', code, message }
  send(ws, err)
}

/** Build a wire StateMessage from live state. members Map -> array; never serialize graceTimer. */
function buildStateMessage(state: PartyLiveState, effectiveAt: number, serverTime: number): StateMessage {
  const members: MemberSummary[] = []
  for (const m of state.members.values()) {
    members.push({
      userId: m.userId,
      displayName: m.displayName,
      ready: m.ready,
      userReady: m.userReady,
      connectionState: m.connectionState,
    })
  }
  return {
    type: 'state',
    partyId: state.partyId,
    positionTicks: Math.round(state.positionTicks),
    paused: state.paused,
    playbackRate: state.playbackRate,
    commandSeq: state.commandSeq,
    serverTime,
    effectiveAt,
    lastActor: state.lastActor,
    members,
  }
}

function broadcastToParty(rt: ServerRuntime, partyId: string, msg: ServerMessage): void {
  const ids = rt.partySockets.get(partyId)
  if (!ids) return
  for (const id of ids) {
    const entry = rt.sockets.get(id)
    if (entry) send(entry.ws, msg)
  }
}

/** Broadcast the current authoritative snapshot to the whole party with the given effectiveAt. */
function broadcastState(rt: ServerRuntime, state: PartyLiveState, effectiveAt: number): void {
  const now = Date.now()
  rt.lastKeepalive.set(state.partyId, now)
  broadcastToParty(rt, state.partyId, buildStateMessage(state, effectiveAt, now))
}

function sendToMember(rt: ServerRuntime, state: PartyLiveState, userId: string, msg: ServerMessage): void {
  const member = state.members.get(userId)
  if (!member) return
  const entry = rt.sockets.get(member.socketId)
  if (entry) send(entry.ws, msg)
}

// --- shared queue (feature 3) ---

function queueToDTO(queue: QueueItem[]): QueueItemDTO[] {
  return queue.map((q) => ({
    id: q.id,
    mediaId: q.mediaId,
    title: q.title,
    addedBy: { userId: q.addedByUserId, displayName: q.addedByDisplayName },
  }))
}

/** Broadcast the current queue to the whole party. */
function broadcastQueue(rt: ServerRuntime, state: PartyLiveState): void {
  broadcastToParty(rt, state.partyId, { type: 'queue', partyId: state.partyId, items: queueToDTO(state.queue) })
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------

function registerSocketToParty(rt: ServerRuntime, socketId: string, partyId: string): void {
  let set = rt.partySockets.get(partyId)
  if (!set) {
    set = new Set()
    rt.partySockets.set(partyId, set)
  }
  set.add(socketId)
  const entry = rt.sockets.get(socketId)
  if (entry) entry.partyId = partyId
}

function unregisterSocket(rt: ServerRuntime, socketId: string): void {
  const entry = rt.sockets.get(socketId)
  if (entry?.partyId) {
    const set = rt.partySockets.get(entry.partyId)
    if (set) {
      set.delete(socketId)
      if (set.size === 0) rt.partySockets.delete(entry.partyId)
    }
  }
  rt.sockets.delete(socketId)
}

// ---------------------------------------------------------------------------
// Checkpoint helper (throttled per CHECKPOINT_THROTTLE_MS unless forced)
// ---------------------------------------------------------------------------

async function checkpoint(partyId: string, force: boolean): Promise<void> {
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (!state) return
  const now = Date.now()
  if (!force && now - state.lastCheckpointAt < CHECKPOINT_THROTTLE_MS) return
  const pos = extrapolatePosition(state, now)
  try {
    checkpointParty(partyId, pos, state.paused)
    await store.updateParty(partyId, (s) => {
      s.lastCheckpointAt = now
    })
  } catch (err) {
    console.warn('[party] checkpoint failed (non-fatal):', err)
  }
}

// ---------------------------------------------------------------------------
// Readiness gate
// ---------------------------------------------------------------------------

/** Connected members who are not ready. Used to decide whether a play may fire. */
function notReadyConnected(state: PartyLiveState): PartyMemberLive[] {
  const out: PartyMemberLive[] = []
  for (const m of state.members.values()) {
    if (m.connectionState === 'connected' && !m.ready) out.push(m)
  }
  return out
}

/** Apply a held/granted play to authoritative state. Mutates in-place; caller is inside updateParty. */
function applyPlay(state: PartyLiveState, positionTicks: number, actor: { userId: string; displayName: string }, now: number): number {
  state.paused = false
  state.positionTicks = positionTicks
  state.lastTickWallClock = now
  state.commandSeq += 1
  state.lastActor = { userId: actor.userId, displayName: actor.displayName, action: 'play' }
  state.pendingPlay = null
  return now + PLAY_LEAD_MS
}

// ---------------------------------------------------------------------------
// The command pipeline (control)
// ---------------------------------------------------------------------------

async function handleControl(rt: ServerRuntime, entry: SocketEntry, identity: PartySessionIdentity, msg: ControlMessage): Promise<void> {
  const store = getPartyStore()
  const partyId = msg.partyId
  const now = Date.now()

  // Control-lock gate: if the lock is active and the sender is not the host, reject.
  // getParty is a direct in-memory Map lookup; getActivePartyById is a sync indexed query.
  const liveSt = await store.getParty(partyId)
  if (liveSt?.controlLocked) {
    const partyRow = getActivePartyById(partyId)
    if (partyRow && identity.userId !== partyRow.host_user_id) {
      sendError(entry.ws, 'control_locked', 'Playback controls are locked to the host')
      return
    }
  }

  let effectiveAt = now
  let waitingFor: { userId: string; displayName: string }[] | null = null
  let broadcast = false
  // M2: a same-action command collapsed by the debounce inside the critical section.
  let debounced = false

  const state = await store.updateParty(partyId, (s) => {
    // M2: DEBOUNCE inside the serialized per-party critical section so two truly
    // simultaneous same-action commands are actually collapsed (not both applied).
    // The lastCommand record is also read AND written here, never outside the lock.
    const prev = rt.lastCommand.get(partyId)
    if (prev && prev.action === msg.action && now - prev.at < COMMAND_DEBOUNCE_MS) {
      const deadbandTicks = secondsToTicks(SEEK_DEADBAND_S)
      const samePos = Math.abs(prev.positionTicks - msg.positionTicks) <= deadbandTicks
      if (
        (msg.action === 'pause' && prev.paused && samePos) ||
        (msg.action === 'seek' && samePos) ||
        (msg.action === 'play' && !prev.paused && samePos)
      ) {
        debounced = true
        return
      }
    }

    if (msg.action === 'play') {
      const notReady = notReadyConnected(s)
      if (notReady.length > 0) {
        // Hold the play at the readiness gate. Do NOT advance commandSeq.
        // M1: if a pendingPlay already exists, preserve the original requestedAt
        // (the gate deadline) — only update the held position. Repeated play
        // presses must not push the READINESS_GATE_MAX_WAIT_MS timeout forward.
        if (s.pendingPlay) {
          s.pendingPlay.positionTicks = msg.positionTicks
          s.pendingPlay.requestedByUserId = identity.userId
          s.pendingPlay.requestedByDisplayName = identity.displayName
        } else {
          s.pendingPlay = {
            positionTicks: msg.positionTicks,
            requestedByUserId: identity.userId,
            requestedByDisplayName: identity.displayName,
            requestedAt: now,
          }
        }
        waitingFor = notReady.map((m) => ({ userId: m.userId, displayName: m.displayName }))
        // M1: record the held play so repeats are debounced.
        rt.lastCommand.set(partyId, { action: 'play', at: now, positionTicks: msg.positionTicks, paused: s.paused })
        return
      }
      effectiveAt = applyPlay(s, msg.positionTicks, identity, now)
      broadcast = true
    } else if (msg.action === 'pause') {
      s.paused = true
      s.positionTicks = msg.positionTicks
      s.lastTickWallClock = now
      s.commandSeq += 1
      s.lastActor = { userId: identity.userId, displayName: identity.displayName, action: 'pause' }
      s.pendingPlay = null
      effectiveAt = now + CONTROL_LEAD_MS
      broadcast = true
    } else if (msg.action === 'seek') {
      // seek: keep paused as-is
      s.positionTicks = msg.positionTicks
      s.lastTickWallClock = now
      s.commandSeq += 1
      s.lastActor = { userId: identity.userId, displayName: identity.displayName, action: 'seek' }
      effectiveAt = now + CONTROL_LEAD_MS
      broadcast = true
    }

    // Record the applied command for the next debounce, inside the same lock.
    if (broadcast) {
      rt.lastCommand.set(partyId, { action: msg.action, at: now, positionTicks: msg.positionTicks, paused: s.paused })
    }
  })

  if (debounced) return

  if (waitingFor) {
    broadcastToParty(rt, partyId, { type: 'waiting', partyId, waitingFor })
    return
  }

  if (broadcast) {
    broadcastState(rt, state, effectiveAt)
    if (msg.action === 'pause' || msg.action === 'seek') {
      void checkpoint(partyId, true)
    }
  }
}

// ---------------------------------------------------------------------------
// Shared queue (feature 3) — any member may add/remove/reorder/advance.
// Each mutation runs through updateParty (atomic per-party), is persisted to
// SQLite (queue ops are infrequent), then broadcast to the whole party.
// ---------------------------------------------------------------------------

async function handleQueueAdd(rt: ServerRuntime, identity: PartySessionIdentity, msg: QueueAddMessage): Promise<void> {
  const store = getPartyStore()
  // Validate the item is playable (non-NULL file_path) BEFORE touching state.
  const media = getPlayableMedia(msg.mediaId)
  if (!media) {
    const s = await store.getParty(msg.partyId)
    if (s) sendToMember(rt, s, identity.userId, { type: 'error', code: 'bad_media', message: 'Item is not playable' })
    return
  }
  let added = false
  const state = await store.updateParty(msg.partyId, (s) => {
    if (s.queue.length >= MAX_QUEUE_LENGTH) return
    s.queue.push({
      id: randomUUID(),
      mediaId: media.id,
      title: (typeof msg.title === 'string' && msg.title.trim() ? msg.title.trim().slice(0, 300) : media.title),
      addedByUserId: identity.userId,
      addedByDisplayName: identity.displayName,
      addedAt: Date.now(),
    })
    added = true
  })
  if (added) {
    persistQueue(msg.partyId, state.queue)
    broadcastQueue(rt, state)
  } else {
    sendToMember(rt, state, identity.userId, { type: 'error', code: 'queue_full', message: 'Queue is full' })
  }
}

async function handleQueueRemove(rt: ServerRuntime, _identity: PartySessionIdentity, msg: QueueRemoveMessage): Promise<void> {
  const store = getPartyStore()
  let changed = false
  const state = await store.updateParty(msg.partyId, (s) => {
    const before = s.queue.length
    s.queue = s.queue.filter((q) => q.id !== msg.itemId)
    changed = s.queue.length !== before
  })
  if (changed) {
    persistQueue(msg.partyId, state.queue)
    broadcastQueue(rt, state)
  }
}

async function handleQueueReorder(rt: ServerRuntime, _identity: PartySessionIdentity, msg: QueueReorderMessage): Promise<void> {
  const store = getPartyStore()
  let changed = false
  const state = await store.updateParty(msg.partyId, (s) => {
    const idx = s.queue.findIndex((q) => q.id === msg.itemId)
    if (idx < 0) return
    const [item] = s.queue.splice(idx, 1)
    const to = Math.min(Math.max(0, msg.toIndex), s.queue.length)
    s.queue.splice(to, 0, item)
    changed = to !== idx
  })
  if (changed) {
    persistQueue(msg.partyId, state.queue)
    broadcastQueue(rt, state)
  }
}

async function handleQueueAdvance(rt: ServerRuntime, _identity: PartySessionIdentity, msg: QueueAdvanceRequest): Promise<void> {
  const store = getPartyStore()
  let next: QueueItem | null = null
  const state = await store.updateParty(msg.partyId, (s) => {
    // Only advance if the sender's "current" still matches — concurrent end/Next presses
    // reference the same fromMediaId, so the first wins and the rest become no-ops.
    if (s.mediaId !== msg.fromMediaId) return
    if (s.queue.length === 0) return
    next = s.queue.shift()!
    s.mediaId = next.mediaId
    s.positionTicks = 0
    // Start the new item playing (zero-click binge); the client readiness/auto-play path in
    // applyState plays it once buffered. Browsers permit this because the document already
    // had user interaction before the client-side navigation.
    s.paused = false
    s.playbackRate = 1
    s.lastTickWallClock = Date.now()
    s.pendingPlay = null
    s.commandSeq += 1
    s.lastActor = null
    for (const m of s.members.values()) m.ready = false
  })

  const target = next as QueueItem | null
  if (!target) return // stale/duplicate advance, or empty queue — ignore

  setPartyMedia(msg.partyId, target.mediaId)
  persistQueue(msg.partyId, state.queue)

  const row = getActivePartyById(msg.partyId)
  broadcastToParty(rt, msg.partyId, {
    type: 'queue_advance',
    partyId: msg.partyId,
    mediaId: target.mediaId,
    joinCode: row?.join_code ?? '',
    items: queueToDTO(state.queue),
  })
}

// ---------------------------------------------------------------------------
// Drift + median reconciliation (on heartbeat round)
// ---------------------------------------------------------------------------

async function reconcileDrift(rt: ServerRuntime, partyId: string): Promise<void> {
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (!state || state.paused) return

  const now = Date.now()
  const connected: PartyMemberLive[] = []
  for (const m of state.members.values()) {
    if (m.connectionState === 'connected') connected.push(m)
  }
  if (connected.length === 0) return

  // Extrapolate each member's last reported position forward to `now` so we
  // compare like-with-like against the `now`-extrapolated reference. A member's
  // report is up to HEARTBEAT_INTERVAL_MS stale; treat them as advancing at the
  // room rate since their last heartbeat (M3 — eliminates phantom ~5s drift).
  const projectReport = (m: PartyMemberLive): number => {
    const deltaMs = Math.max(0, now - m.lastHeartbeat)
    return m.reportedPositionTicks + deltaMs * TICKS_PER_MS * state.playbackRate
  }

  // Snapshot each connected member's projected position ONCE, before any await (A5-03).
  // heartbeat() mutates reportedPositionTicks/lastHeartbeat outside the per-party lock;
  // re-reading those across the `await store.updateParty` below could make the median and
  // the per-member reseek comparison disagree. Using a single snapshot keeps them
  // internally consistent and honors the scale-seam's atomicity contract.
  const snapshot = connected.map((m) => ({ m, projected: projectReport(m) }))

  let reference = extrapolatePosition(state, now)

  // With more than two connected members, reconcile the authoritative timeline
  // toward the median of reported positions so the room center sets the clock.
  if (connected.length > 2) {
    const median = medianReportedPositionTicks(snapshot.map((s) => s.projected))
    const gapTicks = Math.abs(reference - median)
    // Reconcile conservatively: only when the gap is meaningful (>= deadband).
    if (gapTicks >= secondsToTicks(SEEK_DEADBAND_S)) {
      // Forward-only high-water clamp (C2): never move the authoritative
      // position backward via reconciliation. The median can pull the room
      // toward consensus, but only forward.
      const target = Math.max(median, reference)
      const updated = await store.updateParty(partyId, (s) => {
        if (s.paused) return
        if (target > s.positionTicks) {
          s.positionTicks = target
          s.lastTickWallClock = now
        }
      })
      reference = extrapolatePosition(updated, now)
    } else {
      reference = median
    }
  }

  // Per-member targeted reseek for hard-drift / median outliers, suppressing
  // hard reseeks during POST_JOIN_SETTLE_MS after that member joined/reconnected.
  // Uses the same snapshot taken above (A5-03) so the comparison matches the median.
  for (const { m, projected } of snapshot) {
    if (now - m.joinedAt < POST_JOIN_SETTLE_MS) continue
    const driftS = Math.abs(ticksToSeconds(reference - projected))
    if (driftS >= DRIFT_HARD_RESEEK_S || driftS >= MEDIAN_OUTLIER_RESEEK_S) {
      sendToMember(rt, state, m.userId, {
        type: 'reseek',
        partyId,
        positionTicks: Math.round(reference),
        effectiveAt: now + CONTROL_LEAD_MS,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Creator-kick (feature: kick)
// ---------------------------------------------------------------------------

/** Host boots a member: close their socket (4003), stamp kicked_at in DB, broadcast. */
async function handleKick(
  rt: ServerRuntime,
  entry: SocketEntry,
  identity: PartySessionIdentity,
  msg: KickMessage,
): Promise<void> {
  const store = getPartyStore()
  const partyId = msg.partyId

  // Verify the sender is the host.
  const partyRow = getActivePartyById(partyId)
  if (!partyRow || identity.userId !== partyRow.host_user_id) {
    sendError(entry.ws, 'not_host', 'Only the host can kick members')
    return
  }

  // The host cannot kick themselves.
  if (msg.targetUserId === identity.userId) {
    sendError(entry.ws, 'bad_field', 'Cannot kick yourself')
    return
  }

  const state = await store.getParty(partyId)
  if (!state) {
    sendError(entry.ws, 'party_not_found', 'Party not found')
    return
  }

  const targetMember = state.members.get(msg.targetUserId)
  const displayName = targetMember?.displayName ?? msg.targetUserId

  // Broadcast member_kicked to ALL members first (including the target) so the
  // kicked client can show a "you were kicked" message before the socket closes.
  broadcastToParty(rt, partyId, {
    type: 'member_kicked',
    partyId,
    userId: msg.targetUserId,
    displayName,
  })

  // Close the kicked member's socket with code 4003.
  if (targetMember) {
    const targetEntry = rt.sockets.get(targetMember.socketId)
    if (targetEntry) {
      try {
        targetEntry.ws.close(4003, 'kicked')
      } catch {
        /* ignore — may already be closing */
      }
    }
  }

  // Stamp kicked_at in DB (prevents rejoining via isActiveMember).
  try {
    kickMember(partyId, msg.targetUserId)
  } catch {
    /* non-fatal — the live removal still happens */
  }

  // Remove from live state and broadcast the updated member list.
  await store.removeMember(partyId, msg.targetUserId)
  const fresh = await store.getParty(partyId)
  if (fresh) broadcastState(rt, fresh, Date.now())
}

// ---------------------------------------------------------------------------
// Control-lock (feature: control-lock)
// ---------------------------------------------------------------------------

/** Host toggles the control lock: persists to DB and broadcasts to all members. */
async function handleControlLock(
  rt: ServerRuntime,
  entry: SocketEntry,
  identity: PartySessionIdentity,
  msg: ControlLockMessage,
): Promise<void> {
  const partyRow = getActivePartyById(msg.partyId)
  if (!partyRow || identity.userId !== partyRow.host_user_id) {
    sendError(entry.ws, 'not_host', 'Only the host can toggle control lock')
    return
  }

  const store = getPartyStore()
  await store.updateParty(msg.partyId, (s) => {
    s.controlLocked = msg.locked
  })

  // Persist to SQLite so the lock survives a server restart.
  try {
    setControlLocked(msg.partyId, msg.locked)
  } catch {
    /* non-fatal — live state is already updated */
  }

  broadcastToParty(rt, msg.partyId, {
    type: 'control_locked',
    partyId: msg.partyId,
    locked: msg.locked,
  })
}

// ---------------------------------------------------------------------------
// Ready-check + countdown (feature: pre-play lobby)
// ---------------------------------------------------------------------------

/** Host starts the synchronized 5-second countdown. Whether or not everyone has
 *  marked themselves userReady, the host may always start. Broadcasts endsAt (shared
 *  wall-clock target so every client starts playback in sync with no further message)
 *  and the current authoritative positionTicks so every client aligns before counting
 *  down. Resets every member's userReady — a fresh lobby for the next round. */
async function handleStartCountdown(
  rt: ServerRuntime,
  entry: SocketEntry,
  identity: PartySessionIdentity,
  msg: StartCountdownMessage,
): Promise<void> {
  const partyId = msg.partyId
  const partyRow = getActivePartyById(partyId)
  if (!partyRow || identity.userId !== partyRow.host_user_id) {
    sendError(entry.ws, 'not_host', 'Only the host can start the countdown')
    return
  }

  const store = getPartyStore()
  const now = Date.now()
  const endsAt = now + COUNTDOWN_DURATION_MS
  let startPositionTicks = 0

  try {
    await store.updateParty(partyId, (s) => {
      startPositionTicks = Math.round(extrapolatePosition(s, now))
      for (const m of s.members.values()) m.userReady = false
    })
  } catch {
    sendError(entry.ws, 'party_not_found', 'Party not found')
    return
  }

  broadcastToParty(rt, partyId, {
    type: 'countdown',
    partyId,
    endsAt,
    startPositionTicks,
  })
}

// ---------------------------------------------------------------------------
// Inbound validation (C1) + rate limiting (H3)
// ---------------------------------------------------------------------------

/** A finite position in [0, MAX_POSITION_TICKS]. */
function isValidPosition(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_POSITION_TICKS
}

/** Clamp a playback rate to a sane range; reject non-finite. */
function sanePlaybackRate(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(4, Math.max(0.25, v))
}

/**
 * Validate every inbound message field before any handler uses it. Returns true
 * when the message is structurally sound for its type; on rejection it sends a
 * clean `error` and the caller ignores the message. `partyId` is required to be
 * a non-empty string on every non-join message (join validates separately).
 */
function validateMessage(entry: SocketEntry, msg: ClientMessage): boolean {
  switch (msg.type) {
    case 'join':
      if (typeof msg.partyId !== 'string' || msg.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      return true

    case 'control': {
      const m = msg as { partyId?: unknown; action?: unknown; positionTicks?: unknown; clientTime?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (m.action !== 'play' && m.action !== 'pause' && m.action !== 'seek') {
        sendError(entry.ws, 'bad_field', 'Invalid control action')
        return false
      }
      if (!isValidPosition(m.positionTicks)) {
        sendError(entry.ws, 'bad_field', 'Invalid positionTicks')
        return false
      }
      if (m.clientTime !== undefined && (typeof m.clientTime !== 'number' || !Number.isFinite(m.clientTime))) {
        sendError(entry.ws, 'bad_field', 'Invalid clientTime')
        return false
      }
      return true
    }

    case 'heartbeat': {
      const m = msg as { partyId?: unknown; positionTicks?: unknown; playbackRate?: unknown; clientTime?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (!isValidPosition(m.positionTicks)) {
        sendError(entry.ws, 'bad_field', 'Invalid positionTicks')
        return false
      }
      if (sanePlaybackRate(m.playbackRate) === null) {
        sendError(entry.ws, 'bad_field', 'Invalid playbackRate')
        return false
      }
      if (m.clientTime !== undefined && (typeof m.clientTime !== 'number' || !Number.isFinite(m.clientTime))) {
        sendError(entry.ws, 'bad_field', 'Invalid clientTime')
        return false
      }
      return true
    }

    case 'ready': {
      const m = msg as { partyId?: unknown; ready?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.ready !== 'boolean') {
        sendError(entry.ws, 'bad_field', 'Invalid ready')
        return false
      }
      return true
    }

    case 'ping': {
      const m = msg as { partyId?: unknown; clientTime?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.clientTime !== 'number' || !Number.isFinite(m.clientTime)) {
        sendError(entry.ws, 'bad_field', 'Invalid clientTime')
        return false
      }
      return true
    }

    case 'chat': {
      const m = msg as { partyId?: unknown; text?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.text !== 'string') {
        sendError(entry.ws, 'bad_field', 'Invalid chat text')
        return false
      }
      return true
    }

    case 'reaction': {
      const m = msg as { partyId?: unknown; emoji?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.emoji !== 'string') {
        sendError(entry.ws, 'bad_field', 'Invalid emoji')
        return false
      }
      return true
    }

    case 'leave': {
      const m = msg as { partyId?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      return true
    }

    case 'queue_add': {
      const m = msg as { partyId?: unknown; mediaId?: unknown; title?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.mediaId !== 'string' || m.mediaId.length === 0 || m.mediaId.length > 128) {
        sendError(entry.ws, 'bad_field', 'Invalid mediaId')
        return false
      }
      if (m.title !== undefined && typeof m.title !== 'string') {
        sendError(entry.ws, 'bad_field', 'Invalid title')
        return false
      }
      return true
    }

    case 'queue_remove': {
      const m = msg as { partyId?: unknown; itemId?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.itemId !== 'string' || m.itemId.length === 0 || m.itemId.length > 64) {
        sendError(entry.ws, 'bad_field', 'Invalid itemId')
        return false
      }
      return true
    }

    case 'queue_reorder': {
      const m = msg as { partyId?: unknown; itemId?: unknown; toIndex?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.itemId !== 'string' || m.itemId.length === 0 || m.itemId.length > 64) {
        sendError(entry.ws, 'bad_field', 'Invalid itemId')
        return false
      }
      if (typeof m.toIndex !== 'number' || !Number.isInteger(m.toIndex) || m.toIndex < 0 || m.toIndex > MAX_QUEUE_LENGTH) {
        sendError(entry.ws, 'bad_field', 'Invalid toIndex')
        return false
      }
      return true
    }

    case 'queue_advance': {
      const m = msg as { partyId?: unknown; fromMediaId?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.fromMediaId !== 'string' || m.fromMediaId.length === 0 || m.fromMediaId.length > 128) {
        sendError(entry.ws, 'bad_field', 'Invalid fromMediaId')
        return false
      }
      return true
    }

    case 'kick': {
      const m = msg as { partyId?: unknown; targetUserId?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.targetUserId !== 'string' || m.targetUserId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid targetUserId')
        return false
      }
      return true
    }

    case 'control_lock': {
      const m = msg as { partyId?: unknown; locked?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.locked !== 'boolean') {
        sendError(entry.ws, 'bad_field', 'Invalid locked')
        return false
      }
      return true
    }

    case 'set_user_ready': {
      const m = msg as { partyId?: unknown; ready?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      if (typeof m.ready !== 'boolean') {
        sendError(entry.ws, 'bad_field', 'Invalid ready')
        return false
      }
      return true
    }

    case 'start_countdown': {
      const m = msg as { partyId?: unknown }
      if (typeof m.partyId !== 'string' || m.partyId.length === 0) {
        sendError(entry.ws, 'bad_field', 'Invalid partyId')
        return false
      }
      return true
    }

    default:
      return true
  }
}

/**
 * Per-socket rolling-window rate limiter (H3). Returns true when the message of
 * the given type is allowed; on exceed it drops the message and (throttled)
 * sends a `rate_limited` error. Resets the window every WS_RATE_WINDOW_MS.
 */
function allowRate(entry: SocketEntry, type: ClientMessage['type'], now: number): boolean {
  const r = entry.rate
  if (now - r.windowStart >= WS_RATE_WINDOW_MS) {
    r.windowStart = now
    r.total = 0
    r.chat = 0
    r.reaction = 0
    r.control = 0
  }

  const deny = (): boolean => {
    if (now - r.lastThrottleErrorAt >= 1000) {
      r.lastThrottleErrorAt = now
      sendError(entry.ws, 'rate_limited', 'Too many messages')
    }
    return false
  }

  if (r.total >= WS_MSG_MAX_PER_WINDOW) return deny()
  if (type === 'chat' && r.chat >= WS_CHAT_MAX_PER_WINDOW) return deny()
  if (type === 'reaction' && r.reaction >= WS_REACTION_MAX_PER_WINDOW) return deny()
  if (type === 'control' && r.control >= WS_CONTROL_MAX_PER_WINDOW) return deny()

  r.total += 1
  if (type === 'chat') r.chat += 1
  else if (type === 'reaction') r.reaction += 1
  else if (type === 'control') r.control += 1
  return true
}

// ---------------------------------------------------------------------------
// Per-message dispatch
// ---------------------------------------------------------------------------

/**
 * Confirm the sender holds LIVE membership for the party on THIS socket (H5).
 * Established sockets (control/heartbeat/ready/chat/reaction/leave) must appear
 * in the live members map with their current socketId equal to this entry's id.
 * The durable `isActiveMember` fallback is used ONLY for the `join` claim step.
 */
async function isLiveMemberOnSocket(partyId: string, userId: string, socketId: string): Promise<boolean> {
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (!state) return false
  const member = state.members.get(userId)
  return !!member && member.socketId === socketId
}

async function handleMessage(rt: ServerRuntime, entry: SocketEntry, raw: string): Promise<void> {
  let msg: ClientMessage
  try {
    msg = JSON.parse(raw) as ClientMessage
  } catch {
    sendError(entry.ws, 'bad_json', 'Malformed message')
    return
  }
  if (!msg || typeof msg !== 'object' || typeof (msg as { type?: unknown }).type !== 'string') {
    sendError(entry.ws, 'bad_message', 'Missing message type')
    return
  }

  // C1: validate every inbound field before any handler uses it.
  if (!validateMessage(entry, msg)) return

  // H3: per-socket rolling-window rate limiting (drops on exceed).
  if (!allowRate(entry, msg.type, Date.now())) return

  const identity = entry.identity
  const store = getPartyStore()

  // join is the claim step: confirm durable membership, then register.
  if (msg.type === 'join') {
    await handleJoin(rt, entry, msg.partyId)
    return
  }

  // PER-MESSAGE AUTH (H5): every other (established) message must come from a
  // socket that holds LIVE membership for this party on THIS socket. The durable
  // DB fallback applies only at the `join` claim step above.
  const partyId = (msg as { partyId: string }).partyId
  if (!partyId || !(await isLiveMemberOnSocket(partyId, identity.userId, entry.id))) {
    sendError(entry.ws, 'not_member', 'Not a member of this party')
    return
  }

  switch (msg.type) {
    case 'control':
      await handleControl(rt, entry, identity, msg)
      break

    case 'heartbeat': {
      await store.heartbeat(partyId, identity.userId, msg.positionTicks, Date.now())
      await reconcileDrift(rt, partyId)
      break
    }

    case 'ready': {
      await store.setMemberReady(partyId, identity.userId, msg.ready)
      if (msg.ready) await maybeReleasePendingPlay(rt, partyId)
      break
    }

    case 'ping':
      send(entry.ws, { type: 'pong', partyId, clientTime: msg.clientTime, serverTime: Date.now() })
      break

    case 'chat': {
      const text = msg.text.trim().slice(0, MAX_CHAT_LENGTH)
      if (text.length === 0) return
      const now = Date.now()
      const chat: ChatMessage = {
        id: randomUUID(),
        fromUserId: identity.userId,
        fromDisplayName: identity.displayName,
        text,
        ts: now,
      }
      await store.appendChat(partyId, chat)
      broadcastToParty(rt, partyId, {
        type: 'chat',
        partyId,
        from: { userId: chat.fromUserId, displayName: chat.fromDisplayName },
        text: chat.text,
        ts: chat.ts,
        id: chat.id,
      })
      break
    }

    case 'reaction': {
      if (!isAllowedReaction(msg.emoji)) {
        sendError(entry.ws, 'bad_reaction', 'Reaction emoji not allowed')
        return
      }
      broadcastToParty(rt, partyId, {
        type: 'reaction',
        partyId,
        from: { userId: identity.userId, displayName: identity.displayName },
        emoji: msg.emoji,
        ts: Date.now(),
      })
      break
    }

    case 'leave':
      await handleLeave(rt, entry, partyId)
      break

    case 'queue_add':
      await handleQueueAdd(rt, identity, msg)
      break

    case 'queue_remove':
      await handleQueueRemove(rt, identity, msg)
      break

    case 'queue_reorder':
      await handleQueueReorder(rt, identity, msg)
      break

    case 'queue_advance':
      await handleQueueAdvance(rt, identity, msg)
      break

    case 'kick':
      await handleKick(rt, entry, identity, msg)
      break

    case 'control_lock':
      await handleControlLock(rt, entry, identity, msg)
      break

    case 'set_user_ready': {
      await store.setMemberUserReady(partyId, identity.userId, msg.ready)
      // Broadcast promptly (unlike the technical `ready` gate) so the roster's
      // userReady dots and the host's "(X/Y ready)" label update live for everyone,
      // not just at the next periodic keepalive.
      const fresh = await store.getParty(partyId)
      if (fresh) broadcastState(rt, fresh, Date.now())
      break
    }

    case 'start_countdown':
      await handleStartCountdown(rt, entry, identity, msg)
      break

    default:
      sendError(entry.ws, 'unknown_type', 'Unknown message type')
  }
}

// ---------------------------------------------------------------------------
// join
// ---------------------------------------------------------------------------

async function handleJoin(rt: ServerRuntime, entry: SocketEntry, partyId: string): Promise<void> {
  const store = getPartyStore()
  const identity = entry.identity

  // Confirm durable membership (join is the claim step).
  let member: boolean
  try {
    member = isActiveMember(partyId, identity.userId)
  } catch {
    member = false
  }
  if (!member) {
    sendError(entry.ws, 'not_member', 'Not a member of this party')
    return
  }

  // Ensure the live party exists; if not, load from the db checkpoint row.
  let state = await store.getParty(partyId)
  if (!state) {
    // H4: cap total live parties before loading a new one into memory.
    try {
      const liveCount = (await store.listParties()).length
      if (liveCount >= MAX_TOTAL_PARTIES) {
        sendError(entry.ws, 'capacity', 'Server party capacity reached')
        return
      }
    } catch {
      /* listing failed — fall through; createParty below may still fail safely */
    }
    const { getActivePartyById } = await import('./db')
    const row = getActivePartyById(partyId)
    if (!row) {
      sendError(entry.ws, 'party_not_found', 'Party not found or ended')
      return
    }
    await store.createParty({
      partyId: row.id,
      mediaId: row.media_id,
      positionTicks: row.last_position_ticks,
      paused: row.last_paused === 1,
    })
    // Restore the control-lock state from the DB row (feature: control-lock).
    if (row.control_locked === 1) {
      await store.updateParty(row.id, (s) => {
        s.controlLocked = true
      })
    }
    state = await store.getParty(partyId)
    if (!state) {
      sendError(entry.ws, 'party_not_found', 'Party not found')
      return
    }
  }

  const now = Date.now()

  // If this userId is already present (a reconnect within grace), clear the grace
  // timer and adopt the new socket; otherwise add a fresh member.
  const existing = state.members.get(identity.userId)
  if (existing) {
    if (existing.graceTimer) {
      clearTimeout(existing.graceTimer)
    }
    await store.updateParty(partyId, (s) => {
      const m = s.members.get(identity.userId)
      if (m) {
        m.socketId = entry.id
        m.connectionState = 'connected'
        m.graceTimer = null
        m.joinedAt = now
        m.lastHeartbeat = now
      }
    })
  } else {
    // H4: cap members per party before admitting a brand-new member.
    if (state.members.size >= MAX_MEMBERS_PER_PARTY) {
      sendError(entry.ws, 'party_full', 'Party is full')
      return
    }
    const reportedPositionTicks = extrapolatePosition(state, now)
    const newMember: PartyMemberLive = {
      userId: identity.userId,
      socketId: entry.id,
      displayName: identity.displayName,
      ready: false,
      userReady: false,
      lastHeartbeat: now,
      reportedPositionTicks,
      clockOffsetMs: 0,
      connectionState: 'connected',
      graceTimer: null,
      joinedAt: now,
    }
    await store.addMember(partyId, newMember)
  }

  registerSocketToParty(rt, entry.id, partyId)

  const fresh = await store.getParty(partyId)
  if (!fresh) return

  // Reply to THIS socket: full snapshot (apply now) + chat backlog.
  send(entry.ws, buildStateMessage(fresh, now, now))
  const backlog = await store.getChatBacklog(partyId)
  send(entry.ws, {
    type: 'chat_backlog',
    partyId,
    messages: backlog.map((c) => ({
      from: { userId: c.fromUserId, displayName: c.fromDisplayName },
      text: c.text,
      ts: c.ts,
      id: c.id,
    })),
  })

  // Send the shared queue snapshot so a joiner (or a client that just navigated on auto-advance)
  // sees "up next" immediately.
  send(entry.ws, { type: 'queue', partyId, items: queueToDTO(fresh.queue) })

  // Broadcast the membership change to the whole party (effectiveAt = now: reconcile now).
  broadcastState(rt, fresh, now)

  // Member join is a significant checkpoint event.
  void checkpoint(partyId, true)
}

// ---------------------------------------------------------------------------
// leave (graceful)
// ---------------------------------------------------------------------------

async function handleLeave(rt: ServerRuntime, entry: SocketEntry, partyId: string): Promise<void> {
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (state) {
    const member = state.members.get(entry.identity.userId)
    // Only remove if THIS socket is the member's current socket (avoid evicting a
    // member who already reconnected on a different socket).
    if (member && member.socketId === entry.id) {
      await store.removeMember(partyId, entry.identity.userId)
      const fresh = await store.getParty(partyId)
      if (fresh) broadcastState(rt, fresh, Date.now())
    }
  }
  // Unregister this socket from fan-out but keep the connection open (REST leave
  // handles left_at; the socket itself may simply close after).
  if (entry.partyId === partyId) {
    const set = rt.partySockets.get(partyId)
    if (set) {
      set.delete(entry.id)
      if (set.size === 0) rt.partySockets.delete(partyId)
    }
    entry.partyId = null
  }
}

// ---------------------------------------------------------------------------
// Readiness gate release (on ready=true and on timeout)
// ---------------------------------------------------------------------------

async function maybeReleasePendingPlay(rt: ServerRuntime, partyId: string, force = false): Promise<void> {
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (!state || !state.pendingPlay) return

  const now = Date.now()
  const timedOut = force || now - state.pendingPlay.requestedAt >= READINESS_GATE_MAX_WAIT_MS
  const allReady = notReadyConnected(state).length === 0

  if (!allReady && !timedOut) {
    // Still holding; refresh the waiting broadcast so late-joiners see it.
    const waitingFor = notReadyConnected(state).map((m) => ({ userId: m.userId, displayName: m.displayName }))
    broadcastToParty(rt, partyId, { type: 'waiting', partyId, waitingFor })
    return
  }

  let effectiveAt = now
  const updated = await store.updateParty(partyId, (s) => {
    if (!s.pendingPlay) return
    effectiveAt = applyPlay(
      s,
      s.pendingPlay.positionTicks,
      { userId: s.pendingPlay.requestedByUserId, displayName: s.pendingPlay.requestedByDisplayName },
      now
    )
  })
  rt.lastCommand.set(partyId, { action: 'play', at: now, positionTicks: updated.positionTicks, paused: false })
  broadcastState(rt, updated, effectiveAt)
}

// ---------------------------------------------------------------------------
// Disconnect / grace
// ---------------------------------------------------------------------------

async function handleClose(rt: ServerRuntime, entry: SocketEntry): Promise<void> {
  const partyId = entry.partyId
  // Always unregister the socket from the registry on close.
  unregisterSocket(rt, entry.id)

  if (!partyId) return
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (!state) return
  const member = state.members.get(entry.identity.userId)
  // Only enter grace if THIS socket is still the member's active socket.
  if (!member || member.socketId !== entry.id) return

  await store.setMemberConnectionState(partyId, entry.identity.userId, 'grace')
  await store.updateParty(partyId, (s) => {
    const m = s.members.get(entry.identity.userId)
    if (!m) return
    if (m.graceTimer) clearTimeout(m.graceTimer)
    m.graceTimer = setTimeout(() => {
      void evictAfterGrace(rt, partyId, entry.identity.userId, entry.id)
    }, DISCONNECT_GRACE_MS)
  })

  const fresh = await store.getParty(partyId)
  if (fresh) broadcastState(rt, fresh, Date.now())
}

async function evictAfterGrace(rt: ServerRuntime, partyId: string, userId: string, socketId: string): Promise<void> {
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (!state) return
  const member = state.members.get(userId)
  // Only evict if the member is still in grace on the same socket (no reconnect happened).
  if (!member || member.connectionState !== 'grace' || member.socketId !== socketId) return
  await store.removeMember(partyId, userId)
  const fresh = await store.getParty(partyId)
  if (fresh) broadcastState(rt, fresh, Date.now())
}

// ---------------------------------------------------------------------------
// Periodic tick: gate timeout, keepalive, checkpoint, empty-party end
// ---------------------------------------------------------------------------

async function periodicTick(rt: ServerRuntime): Promise<void> {
  const store = getPartyStore()
  const now = Date.now()
  let partyIds: string[]
  try {
    partyIds = await store.listParties()
  } catch {
    return
  }

  for (const partyId of partyIds) {
    const state = await store.getParty(partyId)
    if (!state) continue

    // (1) Release a timed-out held play.
    if (state.pendingPlay && now - state.pendingPlay.requestedAt >= READINESS_GATE_MAX_WAIT_MS) {
      await maybeReleasePendingPlay(rt, partyId, true)
    }

    // (4) End empty parties (zero connected members past the idle window).
    let connectedCount = 0
    for (const m of state.members.values()) {
      if (m.connectionState === 'connected') connectedCount += 1
    }
    if (connectedCount === 0 && state.emptySince != null && now - state.emptySince >= EMPTY_PARTY_IDLE_END_MS) {
      try {
        endPartyRow(partyId)
      } catch (err) {
        console.warn('[party] endPartyRow failed (non-fatal):', err)
      }
      await store.endParty(partyId) // fans party_ended via the events bridge
      continue
    }

    // (2) Keepalive state broadcast (effectiveAt = serverTime, "reconcile now").
    const lastKa = rt.lastKeepalive.get(partyId) ?? 0
    if (state.members.size > 0 && now - lastKa >= KEEPALIVE_STATE_BROADCAST_MS) {
      broadcastState(rt, state, now)
    }

    // (3) Throttled checkpoint to SQLite.
    if (now - state.lastCheckpointAt >= CHECKPOINT_THROTTLE_MS) {
      await checkpoint(partyId, false)
    }
  }
}

// ---------------------------------------------------------------------------
// ws ping/pong keepalive + dead-peer detection
// ---------------------------------------------------------------------------

function pingSweep(rt: ServerRuntime): void {
  const now = Date.now()
  for (const entry of rt.sockets.values()) {
    // H8: account the miss in the SAME sweep that detects a non-pong. A pong since
    // the last sweep clears isAlive→true (and resets the counter in the pong
    // handler); if it is still false here, this socket missed a pong this round.
    if (!entry.isAlive) {
      entry.missedPongs += 1
      if (entry.missedPongs >= WS_PONG_MISS_LIMIT) {
        try {
          entry.ws.terminate()
        } catch {
          /* ignore */
        }
        continue
      }
    } else {
      entry.missedPongs = 0
    }

    // H2: fold periodic session re-validation into the ping sweep. Close any
    // socket whose unified-session no longer resolves (expired/suspended/revoked).
    if (now - entry.lastSessionCheck >= SESSION_RECHECK_INTERVAL_MS) {
      entry.lastSessionCheck = now
      let stillValid: boolean
      try {
        stillValid = lookupPartySession(entry.sessionId) !== null
      } catch {
        stillValid = false
      }
      if (!stillValid) {
        try {
          entry.ws.close(1008, 'session_expired')
        } catch {
          /* ignore */
        }
        try {
          entry.ws.terminate()
        } catch {
          /* ignore */
        }
        continue
      }
    }

    // Arm the next round: mark not-alive and ping only OPEN sockets.
    entry.isAlive = false
    if (entry.ws.readyState === WebSocket.OPEN) {
      try {
        entry.ws.ping()
      } catch {
        /* ignore */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// party_ended bridge
// ---------------------------------------------------------------------------

function onPartyEnded(rt: ServerRuntime, partyId: string): void {
  broadcastToParty(rt, partyId, { type: 'party_ended', partyId })
  const ids = rt.partySockets.get(partyId)
  if (ids) {
    for (const id of [...ids]) {
      const entry = rt.sockets.get(id)
      if (entry) {
        try {
          entry.ws.close(1000, 'party_ended')
        } catch {
          /* ignore */
        }
        entry.partyId = null
      }
    }
  }
  rt.partySockets.delete(partyId)
  rt.lastCommand.delete(partyId)
  rt.lastKeepalive.delete(partyId)
}

// ---------------------------------------------------------------------------
// Startup rehydration
// ---------------------------------------------------------------------------

async function rehydrate(): Promise<void> {
  const store = getPartyStore()
  let rows: { id: string; media_id: string; last_position_ticks: number; last_paused: number; control_locked: number }[]
  try {
    rows = loadActiveParties()
  } catch (err) {
    console.warn('[party] rehydrate query failed (non-fatal):', err)
    return
  }
  for (const row of rows) {
    try {
      await store.createParty({
        partyId: row.id,
        mediaId: row.media_id,
        positionTicks: row.last_position_ticks,
        paused: row.last_paused === 1,
      })
      // Restore the shared queue from its durable mirror.
      const queued = loadQueue(row.id)
      if (queued.length > 0 || row.control_locked === 1) {
        await store.updateParty(row.id, (s) => {
          if (queued.length > 0) s.queue = queued
          if (row.control_locked === 1) s.controlLocked = true
        })
      }
    } catch (err) {
      console.warn(`[party] rehydrate party ${row.id} failed (non-fatal):`, err)
    }
  }
  if (rows.length > 0) {
    console.log(`[party] rehydrated ${rows.length} active party(ies) from checkpoint`)
  }
}

// ---------------------------------------------------------------------------
// initPartyServer
// ---------------------------------------------------------------------------

export function initPartyServer(): void {
  const g = globalThis as GlobalWithServer
  if (g[GLOBAL_KEY]) return
  g[GLOBAL_KEY] = true

  const httpServer = http.createServer((_req, res) => {
    // This server exists only for the WS upgrade; no plain HTTP routes.
    res.writeHead(426, { 'Content-Type': 'text/plain' })
    res.end('Upgrade Required')
  })

  // C1: cap inbound frame size so oversized payloads are rejected at the protocol layer.
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_MESSAGE_BYTES })

  const rt: ServerRuntime = {
    http: httpServer,
    wss,
    sockets: new Map(),
    partySockets: new Map(),
    lastCommand: new Map(),
    lastKeepalive: new Map(),
    pingInterval: setInterval(() => pingSweep(rt), WS_PING_INTERVAL_MS),
    periodicInterval: setInterval(() => {
      void periodicTick(rt)
    }, PERIODIC_TICK_MS),
  }
  g.__partyServerRuntime__ = rt

  // ----- upgrade: validate path + session cookie BEFORE completing the handshake.
  httpServer.on('upgrade', (req, socket, head) => {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '', 'http://localhost').pathname
    } catch {
      socket.destroy()
      return
    }
    if (pathname !== PARTY_WS_PATH) {
      socket.destroy()
      return
    }

    // H1: reject cross-site WebSocket hijacking. A present Origin must match the
    // app origin allowlist; a MISSING Origin (non-browser client) is allowed.
    const origin = req.headers.origin
    if (origin && !allowedWsOrigins().includes(origin)) {
      socket.destroy()
      return
    }

    const sessionId = parseSessionCookie(req.headers.cookie)
    if (!sessionId) {
      socket.destroy()
      return
    }
    let identity: PartySessionIdentity | null
    try {
      identity = lookupPartySession(sessionId)
    } catch {
      identity = null
    }
    if (!identity) {
      socket.destroy()
      return
    }

    // H4: cap concurrent sockets per user. Reject past the cap before upgrading.
    let liveForUser = 0
    for (const e of rt.sockets.values()) {
      if (e.identity.userId === identity.userId) liveForUser += 1
    }
    if (liveForUser >= MAX_SOCKETS_PER_USER) {
      socket.destroy()
      return
    }

    const sid = sessionId
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, identity, sid)
    })
  })

  // ----- connection: register the socket, wire message/pong/close handlers.
  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, identity: PartySessionIdentity, sessionId: string) => {
    const nowConn = Date.now()
    const entry: SocketEntry = {
      id: randomUUID(),
      ws,
      identity,
      sessionId,
      partyId: null,
      isAlive: true,
      missedPongs: 0,
      rate: {
        windowStart: nowConn,
        total: 0,
        chat: 0,
        reaction: 0,
        control: 0,
        lastThrottleErrorAt: 0,
      },
      lastSessionCheck: nowConn,
    }
    rt.sockets.set(entry.id, entry)

    ws.on('pong', () => {
      entry.isAlive = true
      entry.missedPongs = 0
    })

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8')
      void handleMessage(rt, entry, raw).catch((err) => {
        console.warn('[party] message handler error (non-fatal):', err)
      })
    })

    ws.on('close', () => {
      void handleClose(rt, entry).catch((err) => {
        console.warn('[party] close handler error (non-fatal):', err)
      })
    })

    ws.on('error', () => {
      /* close handler will run on socket teardown */
    })
  })

  // ----- party_ended bridge: fan party_ended to sockets and clean the registry.
  // M4: register exactly one 'ended' listener even if this module is re-evaluated
  // (HMR / double import). removeAllListeners first, and read the runtime via the
  // accessor inside the handler rather than closing over a possibly-stale `rt`.
  partyEvents.removeAllListeners('ended')
  partyEvents.on('ended', (partyId: string) => {
    const current = getRuntime()
    if (current) onPartyEnded(current, partyId)
  })

  httpServer.on('error', (err) => {
    console.warn('[party] ws http server error:', err)
  })

  httpServer.listen(PARTY_WS_PORT, '0.0.0.0', () => {
    console.log(`[party] WebSocket server listening on 0.0.0.0:${PARTY_WS_PORT}${PARTY_WS_PATH}`)
    void rehydrate()
  })
}
