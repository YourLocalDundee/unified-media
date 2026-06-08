/**
 * InMemoryPartyStateStore — v1 single-instance backing for PartyStateStore.
 *
 * THIS IS THE HORIZONTAL-SCALE BOUNDARY. All party logic talks only to the
 * PartyStateStore interface (lib/party/state-store.ts). This implementation
 * backs it with a Map and a Node EventEmitter and is SINGLE-INSTANCE ONLY: it
 * holds live state in this process's memory, so running multiple app instances
 * would split-brain the parties. When that day comes, swap this class for a
 * Redis/Postgres-backed implementation behind the same interface — subscribe()
 * becomes a pub/sub subscription and updateParty() publishes — and no other
 * party code changes.
 */
import { EventEmitter } from 'node:events'
import { CHAT_RING_BUFFER_SIZE } from './constants'
import { partyEvents } from './events'
import type { ChatMessage, ConnectionState, PartyLiveState, PartyMemberLive } from './types'
import type { CreatePartyInput, PartyStateListener, PartyStateStore, Unsubscribe } from './state-store'

const CHANGE_EVENT = (partyId: string) => `change:${partyId}`

export class InMemoryPartyStateStore implements PartyStateStore {
  private readonly parties = new Map<string, PartyLiveState>()
  private readonly emitter = new EventEmitter()
  /** Per-party promise chain serializing updateParty so a future async backing
   *  store preserves atomicity. Each call awaits the current tail, then replaces it. */
  private readonly locks = new Map<string, Promise<void>>()

  constructor() {
    // Parties can outnumber EventEmitter's default 10-listener warning cap.
    this.emitter.setMaxListeners(0)
  }

  private emit(state: PartyLiveState): void {
    this.emitter.emit(CHANGE_EVENT(state.partyId), state)
  }

  async createParty(input: CreatePartyInput): Promise<void> {
    if (this.parties.has(input.partyId)) return // no-op if it already exists
    const now = Date.now()
    this.parties.set(input.partyId, {
      partyId: input.partyId,
      mediaId: input.mediaId,
      positionTicks: input.positionTicks,
      paused: input.paused,
      playbackRate: 1.0,
      lastTickWallClock: now,
      commandSeq: 0,
      pendingPlay: null,
      lastActor: null,
      members: new Map(),
      chatBacklog: [],
      emptySince: now,
      lastCheckpointAt: 0,
    })
  }

  async getParty(partyId: string): Promise<PartyLiveState | null> {
    return this.parties.get(partyId) ?? null
  }

  /**
   * Apply the mutator inside a per-party critical section. Node is single-threaded
   * so the synchronous mutator is already atomic, but we still serialize through a
   * promise-chain lock so a future async backing store (Redis/Postgres) inherits
   * the same one-mutation-at-a-time guarantee without changing callers.
   */
  async updateParty(
    partyId: string,
    mutator: (state: PartyLiveState) => void
  ): Promise<PartyLiveState> {
    const prior = this.locks.get(partyId) ?? Promise.resolve()
    let release!: () => void
    const next = new Promise<void>((resolve) => {
      release = resolve
    })
    this.locks.set(partyId, prior.then(() => next))

    await prior
    try {
      const state = this.parties.get(partyId)
      if (!state) throw new Error(`updateParty: party ${partyId} not found`)
      mutator(state)
      this.emit(state)
      return state
    } finally {
      release()
      // Drop the lock entry once this is the tail, to avoid unbounded growth.
      if (this.locks.get(partyId) === next) this.locks.delete(partyId)
    }
  }

  async addMember(partyId: string, member: PartyMemberLive): Promise<void> {
    const state = this.requireParty(partyId)
    state.members.set(member.userId, member)
    state.emptySince = null
    this.emit(state)
  }

  async removeMember(partyId: string, userId: string): Promise<void> {
    const state = this.requireParty(partyId)
    const member = state.members.get(userId)
    if (member?.graceTimer) clearTimeout(member.graceTimer)
    state.members.delete(userId)
    if (state.members.size === 0) state.emptySince = Date.now()
    this.emit(state)
  }

  async setMemberReady(partyId: string, userId: string, ready: boolean): Promise<void> {
    const state = this.requireParty(partyId)
    const member = state.members.get(userId)
    if (!member) return
    member.ready = ready
    this.emit(state)
  }

  async setMemberConnectionState(
    partyId: string,
    userId: string,
    connState: ConnectionState
  ): Promise<void> {
    const state = this.requireParty(partyId)
    const member = state.members.get(userId)
    if (!member) return
    member.connectionState = connState
    this.emit(state)
  }

  /**
   * Persist ONLY this member's reportedPositionTicks and lastHeartbeat. Never
   * touches authoritative positionTicks (monotonic high-water-mark guard): a
   * lagging client's stale report must not drag the room backward. The
   * authoritative position moves only via updateParty (applied commands /
   * median reconciliation). Intentionally does not emit — heartbeats are frequent
   * (every HEARTBEAT_INTERVAL_MS) and would otherwise storm subscribers.
   */
  async heartbeat(
    partyId: string,
    userId: string,
    reportedPositionTicks: number,
    wallClock: number
  ): Promise<void> {
    const member = this.parties.get(partyId)?.members.get(userId)
    if (!member) return
    member.reportedPositionTicks = reportedPositionTicks
    member.lastHeartbeat = wallClock
  }

  async appendChat(partyId: string, message: ChatMessage): Promise<void> {
    const state = this.requireParty(partyId)
    state.chatBacklog.push(message)
    if (state.chatBacklog.length > CHAT_RING_BUFFER_SIZE) {
      // Keep the most-recent CHAT_RING_BUFFER_SIZE.
      state.chatBacklog.splice(0, state.chatBacklog.length - CHAT_RING_BUFFER_SIZE)
    }
    // The WS layer broadcasts chat directly; no state-change emit needed.
  }

  async getChatBacklog(partyId: string): Promise<ChatMessage[]> {
    const state = this.parties.get(partyId)
    if (!state) return []
    return state.chatBacklog.slice(-CHAT_RING_BUFFER_SIZE)
  }

  async listParties(): Promise<string[]> {
    return [...this.parties.keys()]
  }

  async endParty(partyId: string): Promise<void> {
    const state = this.parties.get(partyId)
    if (state) {
      // Clear any pending grace eviction timers to avoid leaks.
      for (const member of state.members.values()) {
        if (member.graceTimer) clearTimeout(member.graceTimer)
      }
      this.emit(state) // final state for any listeners before teardown
    }
    this.parties.delete(partyId)
    this.locks.delete(partyId)
    this.emitter.removeAllListeners(CHANGE_EVENT(partyId))
    // Bridge the end signal to the WS server (and any other in-process listener)
    // so it can fan a party_ended message to all sockets and clean up its registry.
    partyEvents.emit('ended', partyId)
  }

  subscribe(partyId: string, listener: PartyStateListener): Unsubscribe {
    const event = CHANGE_EVENT(partyId)
    this.emitter.on(event, listener)
    return () => {
      this.emitter.off(event, listener)
    }
  }

  private requireParty(partyId: string): PartyLiveState {
    const state = this.parties.get(partyId)
    if (!state) throw new Error(`party ${partyId} not found`)
    return state
  }
}
