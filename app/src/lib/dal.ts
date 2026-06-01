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
}

const SESSION_COOKIE = 'unified-session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const ROTATION_INTERVAL_MS = 24 * 60 * 60 * 1000
const ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000

function makeId(size: number): string {
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

  const session = db.prepare(
    `SELECT s.id, s.user_id, s.created_at, s.expires_at, s.last_seen,
            u.username, u.role
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1`
  ).get(sessionId, now) as SessionRow | undefined

  if (!session) return null

  if (now - session.created_at > ABSOLUTE_TTL_MS) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    return null
  }

  if (now - session.created_at > ROTATION_INTERVAL_MS) {
    const newId = makeId(32)
    db.prepare(
      'UPDATE sessions SET id = ?, expires_at = ?, last_seen = ?, created_at = ? WHERE id = ?'
    ).run(newId, now + SESSION_TTL_MS, now, now, sessionId)
    cookieStore.set(SESSION_COOKIE, newId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    })
    return { userId: session.user_id, username: session.username, role: session.role, sessionId: newId }
  }

  db.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now, sessionId)
  return { userId: session.user_id, username: session.username, role: session.role, sessionId }
}

export async function requireAuth(): Promise<SessionData> {
  const session = await getSession()
  if (!session) redirect('/login')
  return session
}

export async function requireAdmin(): Promise<SessionData> {
  const session = await requireAuth()
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
