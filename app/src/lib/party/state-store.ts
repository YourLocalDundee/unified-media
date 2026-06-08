/**
 * PartyStateStore — THE HORIZONTAL-SCALE BOUNDARY.
 *
 * All party logic talks ONLY to this interface. v1 ships a single in-memory
 * implementation (InMemoryPartyStateStore) pinned on globalThis, which is
 * single-instance only. If the app is ever run as multiple instances, swap the
 * in-memory implementation for a Redis pub/sub or Postgres LISTEN/NOTIFY backing
 * WITHOUT touching any other party code: subscribe() becomes a Redis subscription
 * and updateParty() publishes. The WebSocket layer code does not change.
 *
 * Do NOT build the distributed backing in v1. Implement in-memory now; keep the
 * seam clean.
 *
 * Reactions deliberately do not touch the store: they are fire-and-forget
 * passthrough broadcasts with no backlog, so there is no reaction method here.
 */
import type { ChatMessage, PartyLiveState, PartyMemberLive, ConnectionState } from './types'

export type Unsubscribe = () => void

/** Fired whenever a party's live state changes; the WS layer fans this to sockets. */
export type PartyStateListener = (state: PartyLiveState) => void

export interface CreatePartyInput {
  partyId: string
  mediaId: string
  positionTicks: number
  paused: boolean
}

export interface PartyStateStore {
  createParty(input: CreatePartyInput): Promise<void>
  getParty(partyId: string): Promise<PartyLiveState | null>
  /** Apply a mutation atomically (per-party critical section); returns the new state. */
  updateParty(partyId: string, mutator: (state: PartyLiveState) => void): Promise<PartyLiveState>
  addMember(partyId: string, member: PartyMemberLive): Promise<void>
  removeMember(partyId: string, userId: string): Promise<void>
  setMemberReady(partyId: string, userId: string, ready: boolean): Promise<void>
  heartbeat(
    partyId: string,
    userId: string,
    reportedPositionTicks: number,
    wallClock: number
  ): Promise<void>
  setMemberConnectionState(partyId: string, userId: string, state: ConnectionState): Promise<void>
  /** Push to ring buffer, trim to CHAT_RING_BUFFER_SIZE. */
  appendChat(partyId: string, message: ChatMessage): Promise<void>
  /** Most-recent CHAT_RING_BUFFER_SIZE messages, for a joiner. */
  getChatBacklog(partyId: string): Promise<ChatMessage[]>
  /** All currently-live party ids (for cleanup sweeps). */
  listParties(): Promise<string[]>
  endParty(partyId: string): Promise<void>
  /** Listener fires when this party's state changes. */
  subscribe(partyId: string, listener: PartyStateListener): Unsubscribe
}

// ---------------------------------------------------------------------------
// Singleton accessor — pinned on globalThis so it survives module re-evaluation
// and is shared by the WS server and the /api/party REST handlers (same process).
// ---------------------------------------------------------------------------

const GLOBAL_KEY = '__unifiedPartyStateStore__'

type GlobalWithStore = typeof globalThis & {
  [GLOBAL_KEY]?: PartyStateStore
}

export function getPartyStore(): PartyStateStore {
  const g = globalThis as GlobalWithStore
  if (!g[GLOBAL_KEY]) {
    // Lazy import keeps this module free of the concrete implementation at the
    // type-contract level. InMemoryPartyStateStore is the v1 single-instance backing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { InMemoryPartyStateStore } = require('./in-memory-store') as typeof import('./in-memory-store')
    g[GLOBAL_KEY] = new InMemoryPartyStateStore()
  }
  return g[GLOBAL_KEY]!
}
