/**
 * Party Play — shared type contracts.
 *
 * This file is the single protocol contract shared by:
 *   - the REST lifecycle routes (/api/party/*)
 *   - the WebSocket server (lib/party/server.ts)
 *   - the in-memory state store (lib/party/in-memory-store.ts)
 *   - the client hook (hooks/usePartySync.ts) and UI
 *
 * Client-safe: type-only, no runtime/server imports. The client imports the
 * protocol message unions from here.
 */
import type { ReactionEmoji } from './constants'

export type ControlAction = 'play' | 'pause' | 'seek'
export type ConnectionState = 'connected' | 'grace'
export type PartyStatus = 'active' | 'ended'

// ---------------------------------------------------------------------------
// Durable (SQLite) shapes
// ---------------------------------------------------------------------------

export interface WatchPartyRow {
  id: string
  join_code: string
  host_user_id: string
  media_id: string
  status: PartyStatus
  created_at: number
  updated_at: number
  ended_at: number | null
  last_position_ticks: number
  last_paused: number // 0 | 1
}

export interface WatchPartyMemberRow {
  id: number
  party_id: string
  user_id: string
  joined_at: number
  left_at: number | null
  is_host: number // 0 | 1
}

// ---------------------------------------------------------------------------
// Live (in-memory) shapes
// ---------------------------------------------------------------------------

export interface LastActor {
  userId: string
  displayName: string
  action: ControlAction
}

/** A held play intent waiting on the readiness gate. */
export interface PendingPlay {
  positionTicks: number
  requestedByUserId: string
  requestedByDisplayName: string
  requestedAt: number // server wall clock when the play was requested (gate deadline = this + READINESS_GATE_MAX_WAIT_MS)
}

/** A chat message as held in the server ring buffer (server-stamped identity). */
export interface ChatMessage {
  id: string
  fromUserId: string
  fromDisplayName: string
  text: string
  ts: number
}

/** One item in a party's shared "up next" queue (live in memory, mirrored to SQLite). */
export interface QueueItem {
  id: string
  mediaId: string
  title: string
  addedByUserId: string
  addedByDisplayName: string
  addedAt: number
}

/** A connected (or briefly disconnected) party member, live in memory. */
export interface PartyMemberLive {
  userId: string
  socketId: string
  displayName: string
  ready: boolean
  lastHeartbeat: number
  reportedPositionTicks: number
  clockOffsetMs: number
  connectionState: ConnectionState
  /** Eviction timer handle while in 'grace'. Not serialized. */
  graceTimer: ReturnType<typeof setTimeout> | null
  /** When this member joined/reconnected — used to suppress hard reseek during POST_JOIN_SETTLE_MS. */
  joinedAt: number
  rendition?: string
}

/** Full authoritative live state for one party. */
export interface PartyLiveState {
  partyId: string
  mediaId: string
  positionTicks: number
  paused: boolean
  playbackRate: number
  lastTickWallClock: number
  commandSeq: number
  pendingPlay: PendingPlay | null
  lastActor: LastActor | null
  members: Map<string, PartyMemberLive>
  /** Shared "up next" queue (feature 3). Any member may add/remove/reorder; auto-advance
   *  on item end shifts the head. Mirrored to SQLite on every mutation for restart recovery. */
  queue: QueueItem[]
  chatBacklog: ChatMessage[]
  /** Server wall clock when this party last had zero connected members (for empty-party idle end). null when occupied. */
  emptySince: number | null
  /** Last checkpoint write time, for CHECKPOINT_THROTTLE_MS throttling. */
  lastCheckpointAt: number
}

// ---------------------------------------------------------------------------
// Wire DTOs (server -> client)
// ---------------------------------------------------------------------------

export interface MemberSummary {
  userId: string
  displayName: string
  ready: boolean
  connectionState: ConnectionState
}

export interface ChatMessageDTO {
  id: string
  from: { userId: string; displayName: string }
  text: string
  ts: number
}

export interface QueueItemDTO {
  id: string
  mediaId: string
  title: string
  addedBy: { userId: string; displayName: string }
}

// ---------------------------------------------------------------------------
// Client -> Server messages
// ---------------------------------------------------------------------------

export interface JoinMessage {
  type: 'join'
  partyId: string
}
export interface ControlMessage {
  type: 'control'
  partyId: string
  action: ControlAction
  positionTicks: number
  clientTime: number
}
export interface HeartbeatMessage {
  type: 'heartbeat'
  partyId: string
  positionTicks: number
  playbackRate: number
  clientTime: number
}
export interface ReadyMessage {
  type: 'ready'
  partyId: string
  ready: boolean
}
export interface PingMessage {
  type: 'ping'
  partyId: string
  clientTime: number
}
export interface ChatSendMessage {
  type: 'chat'
  partyId: string
  text: string
}
export interface ReactionSendMessage {
  type: 'reaction'
  partyId: string
  emoji: string
}
export interface LeaveMessage {
  type: 'leave'
  partyId: string
}
// --- shared queue (feature 3) ---
export interface QueueAddMessage {
  type: 'queue_add'
  partyId: string
  mediaId: string
  title?: string
}
export interface QueueRemoveMessage {
  type: 'queue_remove'
  partyId: string
  itemId: string
}
export interface QueueReorderMessage {
  type: 'queue_reorder'
  partyId: string
  itemId: string
  toIndex: number
}
/** Advance to the next queued item. fromMediaId is the item the sender believes is current —
 *  the server honours the advance only if it still matches, so concurrent end/Next presses
 *  advance exactly once. */
export interface QueueAdvanceRequest {
  type: 'queue_advance'
  partyId: string
  fromMediaId: string
}

export type ClientMessage =
  | JoinMessage
  | ControlMessage
  | HeartbeatMessage
  | ReadyMessage
  | PingMessage
  | ChatSendMessage
  | ReactionSendMessage
  | LeaveMessage
  | QueueAddMessage
  | QueueRemoveMessage
  | QueueReorderMessage
  | QueueAdvanceRequest

// ---------------------------------------------------------------------------
// Server -> Client messages
// ---------------------------------------------------------------------------

export interface StateMessage {
  type: 'state'
  partyId: string
  positionTicks: number
  paused: boolean
  playbackRate: number
  commandSeq: number
  serverTime: number
  effectiveAt: number
  lastActor: LastActor | null
  members: MemberSummary[]
}
export interface ReseekMessage {
  type: 'reseek'
  partyId: string
  positionTicks: number
  effectiveAt: number
}
export interface WaitingMessage {
  type: 'waiting'
  partyId: string
  waitingFor: { userId: string; displayName: string }[]
}
export interface ChatBroadcastMessage {
  type: 'chat'
  partyId: string
  from: { userId: string; displayName: string }
  text: string
  ts: number
  id: string
}
export interface ChatBacklogMessage {
  type: 'chat_backlog'
  partyId: string
  messages: { from: { userId: string; displayName: string }; text: string; ts: number; id: string }[]
}
export interface ReactionBroadcastMessage {
  type: 'reaction'
  partyId: string
  from: { userId: string; displayName: string }
  emoji: ReactionEmoji
  ts: number
}
export interface PongMessage {
  type: 'pong'
  partyId: string
  clientTime: number
  serverTime: number
}
export interface PartyEndedMessage {
  type: 'party_ended'
  partyId: string
}
// --- shared queue (feature 3) ---
/** Full queue snapshot — sent on join and after every queue mutation. */
export interface QueueBroadcastMessage {
  type: 'queue'
  partyId: string
  items: QueueItemDTO[]
}
/** Auto-advance: every client navigates to mediaId (using joinCode to re-join the same party).
 *  The remaining queue is included so the panel updates without waiting for the post-nav join. */
export interface QueueAdvanceBroadcast {
  type: 'queue_advance'
  partyId: string
  mediaId: string
  joinCode: string
  items: QueueItemDTO[]
}
export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

export type ServerMessage =
  | StateMessage
  | ReseekMessage
  | WaitingMessage
  | ChatBroadcastMessage
  | ChatBacklogMessage
  | ReactionBroadcastMessage
  | PongMessage
  | PartyEndedMessage
  | QueueBroadcastMessage
  | QueueAdvanceBroadcast
  | ErrorMessage

// ---------------------------------------------------------------------------
// Session identity resolved from the unified-session cookie at WS upgrade.
// ---------------------------------------------------------------------------

export interface PartySessionIdentity {
  userId: string
  username: string
  displayName: string
  role: string
}
