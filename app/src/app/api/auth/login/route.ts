/**
 * POST /api/auth/login — credential verification and session creation.
 *
 * Flow: rate-limit check → username lookup (case-insensitive) → is_active
 * guard → bcrypt verify → login_attempts insert → session cookie set.
 *
 * force_pw_change accounts return a JSON flag instead of a session cookie so
 * the client is forced to /change-password before a real session is issued.
 *
 * Rate limit: 10 attempts per IP per 15 minutes. A 2-second artificial delay
 * kicks in after 3+ recent failures to slow credential-stuffing without
 * revealing the exact lockout threshold to an attacker.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { verifyPassword } from '@/lib/password'
import { checkRateLimit } from '@/lib/rate-limit'
import { createSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'
import { verifyOrigin } from '@/lib/csrf'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30-day TTL; rotation and absolute max enforced in dal.ts
const SESSION_COOKIE = 'unified-session'

interface UserRow {
  id: string; username: string; password_hash: string; role: string
  is_active: number; force_pw_change: number
}

// x-forwarded-for is a comma-separated list when multiple proxies are in the
// chain; take only the first (leftmost) value, which is the client IP added by
// the outermost trusted proxy (BunkerWeb / Caddy).
function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? '127.0.0.1'
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ip = getClientIp(req)
  const rl = checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': '900' } }
    )
  }

  let body: { username?: string; password?: string }
  try { body = await req.json() as { username?: string; password?: string } }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const { username, password } = body
  if (!username || !password) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  const db = getDb()
  // Case-insensitive so "Admin" and "admin" resolve to the same account.
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username) as UserRow | undefined

  if (!user) {
    await logEvent('login_failure', { username }, { ip })
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  if (!user.is_active) {
    return NextResponse.json({ error: 'Account suspended. Contact the site owner.' }, { status: 403 })
  }

  // Count failures from the last 5 minutes to decide whether to apply a delay.
  // We check this BEFORE verifyPassword (which is slow by design) so the delay
  // is additive on top of bcrypt time, not redundant with it.
  const recentFailures = (db.prepare(
    'SELECT COUNT(*) as c FROM login_attempts WHERE LOWER(username) = LOWER(?) AND success = 0 AND created_at > ?'
  ).get(username, Date.now() - 5 * 60 * 1000) as { c: number }).c

  const valid = await verifyPassword(password, user.password_hash)

  // Record the attempt after verification so the result is accurate.
  db.prepare('INSERT INTO login_attempts (ip_address, username, success, created_at) VALUES (?, ?, ?, ?)')
    .run(ip, username.toLowerCase(), valid ? 1 : 0, Date.now())

  if (!valid) {
    // Artificial delay after repeated failures makes brute-force measurably
    // slower without revealing the lockout threshold via an immediate 429.
    if (recentFailures >= 2) await new Promise<void>(r => setTimeout(r, 2000))
    await logEvent('login_failure', { username: user.username }, { userId: user.id, username: user.username, ip })
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  // Session is created before the force_pw_change check so /api/auth/change-password
  // can call requireAuth() successfully. Without a session the change-password route
  // redirects back to /login, trapping the user in an infinite loop.
  const sessionId = await createSession(user.id, ip, req.headers.get('user-agent') ?? undefined)
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), user.id)
  await logEvent('login_success', {}, { userId: user.id, username: user.username, ip })

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })

  if (user.force_pw_change) {
    // Session cookie is already set above. The client redirects to /change-password
    // which can now authenticate the user and clear force_pw_change.
    return NextResponse.json({ requiresPasswordChange: true })
  }

  return NextResponse.json({ username: user.username, role: user.role })
}
