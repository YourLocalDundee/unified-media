/**
 * Party Play — in-process event bridge.
 *
 * A tiny globalThis-pinned EventEmitter used to fan a party-ended signal from
 * wherever endParty() is invoked (the REST DELETE route, the last-member leave
 * route, and the store itself) out to the WebSocket server so it can deliver a
 * party_ended message to every socket and tear down its registry.
 *
 * This is deliberately a separate, dependency-free module so the in-memory
 * store can emit on it without importing the WS server (which would create a
 * server-only import cycle).
 */
import { EventEmitter } from 'node:events'

export interface PartyEvents {
  /** Emitted with the partyId when a party is ended in-process. */
  ended: (partyId: string) => void
}

const GLOBAL_KEY = '__unifiedPartyEvents__'

type GlobalWithEvents = typeof globalThis & {
  [GLOBAL_KEY]?: EventEmitter
}

function resolve(): EventEmitter {
  const g = globalThis as GlobalWithEvents
  if (!g[GLOBAL_KEY]) {
    const emitter = new EventEmitter()
    emitter.setMaxListeners(0)
    g[GLOBAL_KEY] = emitter
  }
  return g[GLOBAL_KEY]!
}

export const partyEvents = resolve()
