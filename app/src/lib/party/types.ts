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

export type ClientMessage =
  | JoinMessage
  | ControlMessage
  | HeartbeatMessage
  | ReadyMessage
  | PingMessage
  | ChatSendMessage
  | ReactionSendMessage
  | LeaveMessage

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
