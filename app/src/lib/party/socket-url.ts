/**
 * Builds the party WebSocket URL per environment. Client-safe (uses window.location).
 *
 * Production: the page is served from unified.minijoe.dev over https; Caddy maps
 *   the path /api/party/ws* to the internal :3002 WS server, so the browser connects
 *   same-origin to wss://<host>/api/party/ws.
 *
 * Development: there is no Caddy. `next dev` serves the page on :3001 while the WS
 *   server listens on :3002 on the same hostname. Cookies are not port-scoped, so the
 *   unified-session cookie is still sent to :3002. Connect directly to
 *   ws://<hostname>:3002/api/party/ws.
 */
import { PARTY_WS_PATH, PARTY_WS_PORT } from './constants'

export function getPartySocketUrl(): string {
  if (typeof window === 'undefined') return ''
  const { protocol, hostname, port, host } = window.location

  // Dev: page served by `next dev` on :3001 (or localhost). WS server is on a
  // separate internal port on the same host.
  const isDev = port === '3001' || hostname === 'localhost' || hostname === '127.0.0.1'
  if (isDev) {
    return `ws://${hostname}:${PARTY_WS_PORT}${PARTY_WS_PATH}`
  }

  // Production: same-origin through Caddy. Match page scheme (https -> wss).
  const wsProto = protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProto}//${host}${PARTY_WS_PATH}`
}
