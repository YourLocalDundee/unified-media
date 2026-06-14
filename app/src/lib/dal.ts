/**
 * Data Access Layer (DAL) — session management and audit logging.
 *
 * All exports are server-only (enforced by the 'server-only' sentinel).
 * This is the single authoritative location for reading/writing sessions;
 * nothing else in the app touches the sessions table directly.
 *
 * Session lifecycle:
 *   - 30-day rolling TTL — each request bumps last_seen and extends expires_at
 *   - 24-hour rotation — after 24h from creation the session ID is replaced
 *     and a new cookie is issued (limits the window for stolen-cookie reuse)
 *   - 90-day absolute maximum — rotation resets created_at so this is the
 *     wall-clock limit regardless of continuous activity
 *
 * Cookie mutations (set/delete) throw in Server Component render context under
 * Next.js 15. Every mutation site is wrapped in try/catch so that Route
 * Handlers and Server Actions work normally while Server Components no-op.
 */
import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from './db/index'
import { getCountryFromIP } from './geo'

export interface SessionData {
  userId: string
  username: string
  role: string
  sessionId: string
  // True when the account is flagged for a forced password change (admin reset or
  // auto-generated temp password). requireAuth() funnels these users to /change-password;
  // getSession() still resolves the identity so the change-password flow can use it.
  forcePwChange: boolean
}

const SESSION_COOKIE = 'unified-session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000       // rolling window
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000       // re-issue session ID after this long
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000      // hard ceiling regardless of activity

// Uses Web Crypto (available in both Node.js 15+ and Edge Runtime).
// Modulo bias is negligible for 62 chars over a 256-value byte.
export function makeId(size: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(size)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

interface SessionRow {
  id: string
  user_id: string
  username: string
  role: string
  force_pw_change: number
  created_at: number
  expires_at: number
  last_seen: number
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies()
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value
  if (!sessionId) return null

  const db = getDb()
  const now = Date.now()

  // JOIN with users lets us check is_active in one query, avoiding a second
  // round-trip and preventing suspended accounts from slipping through on cached sessions.
  const session = db.prepare(
    `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.last_seen,
            u.username, u.role, u.force_pw_change
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`
  ).get(sessionId, now) as SessionRow | undefined

  if (!session) {
    // Attempt to clear the stale cookie. This succeeds in Route Handlers and
    // Server Actions; in Server Components Next.js 15 throws — ignore it.
    try { cookieStore.delete(SESSION_COOKIE) } catch { /* server component context */ }
    return null
  }

  // Absolute TTL enforced here because rotation resets created_at — without this
  // check a very active user could hold a session indefinitely.
  if (now - session.created_at > ABSOLUTE_TTL_MS) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    try { cookieStore.delete(SESSION_COOKIE) } catch { /* server component context */ }
    return null
  }

  // Replace the session ID every 24h to limit stolen-cookie replay window.
  // created_at is also reset so the absolute TTL clock restarts from this rotation.
  // IMPORTANT: cookie set MUST precede the DB update. In Server Component context
  // cookieStore.set() throws; catching it here keeps the existing row intact so the
  // browser's current cookie stays valid. If the set succeeds (Route Handler context)
  // the DB is updated atomically in the same try block.
  if (now - session.created_at > ROTATION_INTERVAL_MS) {
    const newId = makeId(32)
    try {
      cookieStore.set(SESSION_COOKIE, newId, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_MS / 1000,
      })
      db.prepare(
        'UPDATE sessions SET id = ?, expires_at = ?, last_seen = ?, created_at = ? WHERE id = ?'
      ).run(newId, now + SESSION_TTL_MS, now, now, sessionId)
      return { userId: session.user_id, username: session.username, role: session.role, sessionId: newId, forcePwChange: session.force_pw_change === 1 }
    } catch {
      // Cookie set failed (Server Component context) — skip rotation this request
      // and keep the existing session row valid. Rotation will succeed on the next
      // Route Handler request where cookie mutations are permitted.
      db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, sessionId)
      return { userId: session.user_id, username: session.username, role: session.role, sessionId, forcePwChange: session.force_pw_change === 1 }
    }
  }

  db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, sessionId)
  return { userId: session.user_id, username: session.username, role: session.role, sessionId, forcePwChange: session.force_pw_change === 1 }
}

// redirect() throws a special Next.js error — TypeScript doesn't narrow the return
// type here, but calling code can rely on it never returning null.
//
// A force_pw_change account holds a valid session but is funnelled to
// /change-password until it picks a new password. This is the session-gate the
// audit (A1-001) flagged as missing: previously force_pw_change was only honored
// in the login *response*, so a user who ignored the client redirect kept a fully
// usable session. The /change-password page itself is a client component that
// never calls requireAuth(), so this redirect cannot loop.
export async function requireAuth(): Promise<SessionData> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.forcePwChange) redirect('/change-password')
  return session
}

export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth()
  // Non-admins get a silent redirect to home rather than a 403 to avoid leaking route existence
  if (session.role !== 'admin') redirect('/')
  return session
}

export async function createSession(
  userId: string,
  ip?: string,
  userAgent?: string
): Promise<string> {
  const id = makeId(32)
  const now = Date.now()
  getDb().prepare(
    `INSERT INTO sessions (id, user_id, ip_address, user_agent, created_at, expires_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, ip ?? null, userAgent ?? null, now, now + SESSION_TTL_MS, now)
  return id
}

export async function deleteSession(sessionId: string): Promise<void> {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

// logEvent is fire-and-forget — audit failures must never surface to the user.
// Geo lookup (ip-api.com) is skipped when no IP is supplied, e.g. for system events.
export async function logEvent(
  eventType: string,
  details: Record<string, unknown>,
  opts?: { userId?: string; username?: string; ip?: string }
): Promise<void> {
  try {
    const db = getDb()
    let country = ''
    let city = ''
    if (opts?.ip) {
      const geo = await getCountryFromIP(opts.ip)
      country = geo.country
      city = geo.city
    }
    // details is serialised to JSON string; the column type is TEXT, not JSONB
    db.prepare(
      `INSERT INTO audit_log (user_id, username, event_type, details, ip_address, country, city, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts?.userId ?? null,
      opts?.username ?? null,
      eventType,
      JSON.stringify(details),
      opts?.ip ?? null,
      country,
      city,
      Date.now()
    )
  } catch { /* never throws */ }
}
