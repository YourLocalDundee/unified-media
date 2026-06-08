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
} from './constants'
import {
  extrapolatePosition,
  medianReportedPositionTicks,
  secondsToTicks,
  ticksToSeconds,
} from './position'
import { getPartyStore } from './state-store'
import { parseSessionCookie, lookupPartySession } from './session'
import { isActiveMember, checkpointParty, endPartyRow, loadActiveParties } from './db'
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
} from './types'

const CHAT_TEXT_MAX = 2000
const PERIODIC_TICK_MS = 2500

interface SocketEntry {
  id: string
  ws: WebSocket
  identity: PartySessionIdentity
  partyId: string | null
  isAlive: boolean
  missedPongs: number
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

async function handleControl(rt: ServerRuntime, identity: PartySessionIdentity, msg: ControlMessage): Promise<void> {
  const store = getPartyStore()
  const partyId = msg.partyId
  const now = Date.now()

  // DEBOUNCE: drop a competing same-action that would not meaningfully change state.
  const prev = rt.lastCommand.get(partyId)
  if (prev && prev.action === msg.action && now - prev.at < COMMAND_DEBOUNCE_MS) {
    const deadbandTicks = secondsToTicks(SEEK_DEADBAND_S)
    const samePos = Math.abs(prev.positionTicks - msg.positionTicks) <= deadbandTicks
    if (msg.action === 'pause' && prev.paused && samePos) return
    if (msg.action === 'seek' && samePos) return
    if (msg.action === 'play' && !prev.paused && samePos) return
  }

  let effectiveAt = now
  let waitingFor: { userId: string; displayName: string }[] | null = null
  let broadcast = false

  const state = await store.updateParty(partyId, (s) => {
    if (msg.action === 'play') {
      const notReady = notReadyConnected(s)
      if (notReady.length > 0) {
        // Hold the play at the readiness gate. Do NOT advance commandSeq.
        s.pendingPlay = {
          positionTicks: msg.positionTicks,
          requestedByUserId: identity.userId,
          requestedByDisplayName: identity.displayName,
          requestedAt: now,
        }
        waitingFor = notReady.map((m) => ({ userId: m.userId, displayName: m.displayName }))
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
    } else {
      // seek: keep paused as-is
      s.positionTicks = msg.positionTicks
      s.lastTickWallClock = now
      s.commandSeq += 1
      s.lastActor = { userId: identity.userId, displayName: identity.displayName, action: 'seek' }
      effectiveAt = now + CONTROL_LEAD_MS
      broadcast = true
    }
  })

  if (waitingFor) {
    broadcastToParty(rt, partyId, { type: 'waiting', partyId, waitingFor })
    return
  }

  rt.lastCommand.set(partyId, {
    action: msg.action,
    at: now,
    positionTicks: msg.positionTicks,
    paused: state.paused,
  })

  if (broadcast) {
    broadcastState(rt, state, effectiveAt)
    if (msg.action === 'pause' || msg.action === 'seek') {
      void checkpoint(partyId, true)
    }
  }
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

  let reference = extrapolatePosition(state, now)

  // With more than two connected members, reconcile the authoritative timeline
  // toward the median of reported positions so the room center sets the clock.
  if (connected.length > 2) {
    const median = medianReportedPositionTicks(connected.map((m) => m.reportedPositionTicks))
    const gapTicks = Math.abs(reference - median)
    // Reconcile conservatively: only when the gap is meaningful (>= deadband).
    if (gapTicks >= secondsToTicks(SEEK_DEADBAND_S)) {
      const updated = await store.updateParty(partyId, (s) => {
        if (s.paused) return
        s.positionTicks = median
        s.lastTickWallClock = now
      })
      reference = extrapolatePosition(updated, now)
    } else {
      reference = median
    }
  }

  // Per-member targeted reseek for hard-drift / median outliers, suppressing
  // hard reseeks during POST_JOIN_SETTLE_MS after that member joined/reconnected.
  for (const m of connected) {
    if (now - m.joinedAt < POST_JOIN_SETTLE_MS) continue
    const driftS = Math.abs(ticksToSeconds(reference - m.reportedPositionTicks))
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
// Per-message dispatch
// ---------------------------------------------------------------------------

/** Confirm the sender is a current member of the party named on the message. */
async function isMember(partyId: string, userId: string): Promise<boolean> {
  const store = getPartyStore()
  const state = await store.getParty(partyId)
  if (state && state.members.has(userId)) return true
  // Fall back to durable membership (covers a just-rehydrated party with no live members yet).
  try {
    return isActiveMember(partyId, userId)
  } catch {
    return false
  }
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

  const identity = entry.identity
  const store = getPartyStore()

  // join is the claim step: confirm durable membership, then register.
  if (msg.type === 'join') {
    await handleJoin(rt, entry, msg.partyId)
    return
  }

  // PER-MESSAGE AUTH: every other message must be from a current member.
  const partyId = (msg as { partyId: string }).partyId
  if (!partyId || !(await isMember(partyId, identity.userId))) {
    sendError(entry.ws, 'not_member', 'Not a member of this party')
    return
  }

  switch (msg.type) {
    case 'control':
      await handleControl(rt, identity, msg)
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
      const text = (msg.text ?? '').trim().slice(0, CHAT_TEXT_MAX)
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
    const reportedPositionTicks = extrapolatePosition(state, now)
    const newMember: PartyMemberLive = {
      userId: identity.userId,
      socketId: entry.id,
      displayName: identity.displayName,
      ready: false,
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
  for (const entry of rt.sockets.values()) {
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
    entry.isAlive = false
    try {
      entry.ws.ping()
    } catch {
      /* ignore */
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
  let rows: { id: string; media_id: string; last_position_ticks: number; last_paused: number }[]
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

  const wss = new WebSocketServer({ noServer: true })

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

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, identity)
    })
  })

  // ----- connection: register the socket, wire message/pong/close handlers.
  wss.on('connection', (ws: WebSocket, _req: http.IncomingMessage, identity: PartySessionIdentity) => {
    const entry: SocketEntry = {
      id: randomUUID(),
      ws,
      identity,
      partyId: null,
      isAlive: true,
      missedPongs: 0,
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
  partyEvents.on('ended', (partyId: string) => {
    onPartyEnded(rt, partyId)
  })

  httpServer.on('error', (err) => {
    console.warn('[party] ws http server error:', err)
  })

  httpServer.listen(PARTY_WS_PORT, '0.0.0.0', () => {
    console.log(`[party] WebSocket server listening on 0.0.0.0:${PARTY_WS_PORT}${PARTY_WS_PATH}`)
    void rehydrate()
  })
}
