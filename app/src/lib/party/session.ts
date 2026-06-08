/**
 * Party Play — WebSocket upgrade auth helpers (server-only).
 *
 * This is the extracted core session lookup the spec calls for: the socket
 * upgrade handler resolves the unified-session cookie to an identity or null.
 * It deliberately does NOT duplicate the 24h rotation or cookie-mutation logic
 * from lib/dal.ts — rotation stays on HTTP requests; the socket only validates.
 */
import 'server-only'
import { getDb } from '../db/index'
import type { PartySessionIdentity } from './types'

const SESSION_COOKIE = 'unified-session'

/** Parse the unified-session value out of a raw Cookie header string. */
export function parseSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === SESSION_COOKIE) {
      const value = part.slice(eq + 1).trim()
      return value.length > 0 ? value : null
    }
  }
  return null
}

interface SessionLookupRow {
  id: string
  user_id: string
  created_at: number
  expires_at: number
  username: string
  role: string
  display_name: string | null
}

/**
 * Resolve a session ID to a valid identity, or null. Mirrors getSession's core
 * query (active user, unexpired session) without any rotation side effects.
 */
export function lookupPartySession(sessionId: string): PartySessionIdentity | null {
  const row = getDb()
    .prepare(
      `SELECT s.id, s.user_id, s.created_at, s.expires_at, u.username, u.role, u.display_name
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`
    )
    .get(sessionId, Date.now()) as SessionLookupRow | undefined

  if (!row) return null

  return {
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name ?? row.username,
    role: row.role,
  }
}
