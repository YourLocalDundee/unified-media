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
import { getClientIp } from '@/lib/client-ip'
import { createSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'
import { verifyOrigin } from '@/lib/csrf'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30-day TTL; rotation and absolute max enforced in dal.ts
const SESSION_COOKIE = 'unified-session'

// A real cost-12 bcrypt hash with no known preimage. When the submitted username
// does not exist we still run bcrypt.compare against this so the response time is
// indistinguishable from the "user exists, wrong password" path — closing the
// username-enumeration timing oracle (A1-004).
const DUMMY_PASSWORD_HASH = '$2b$12$TVjeVOyMm3bxSN6KiWum9.9sAdZbtyR9CMZZRh3fvW2l40eRel5iq'

interface UserRow {
  id: string; username: string; password_hash: string; role: string
  is_active: number; force_pw_change: number
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

  // Count failures from the last 5 minutes to decide whether to apply a delay.
  // We check this BEFORE verifyPassword (which is slow by design) so the delay
  // is additive on top of bcrypt time, not redundant with it.
  const recentFailures = (db.prepare(
    'SELECT COUNT(*) as c FROM login_attempts WHERE LOWER(username) = LOWER(?) AND success = 0 AND created_at > ?'
  ).get(username, Date.now() - 5 * 60 * 1000) as { c: number }).c

  // Always run bcrypt — against the real hash when the user exists, otherwise a
  // dummy hash — so unknown-username and wrong-password take the same time (A1-004).
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH)

  // Record the attempt after verification so the result is accurate.
  db.prepare('INSERT INTO login_attempts (ip_address, username, success, created_at) VALUES (?, ?, ?, ?)')
    .run(ip, username.toLowerCase(), user && valid ? 1 : 0, Date.now())

  // Unknown user OR wrong password → one identical 401. Never reveal which of the
  // two failed, and never return a distinct status for a non-existent account.
  if (!user || !valid) {
    // Artificial delay after repeated failures makes brute-force measurably
    // slower without revealing the lockout threshold via an immediate 429.
    if (recentFailures >= 2) await new Promise<void>(r => setTimeout(r, 2000))
    await logEvent('login_failure', { username: user?.username ?? username }, user ? { userId: user.id, username: user.username, ip } : { ip })
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  // Suspension is only revealed AFTER a correct password, so a guesser without the
  // password can no longer distinguish "suspended" (403) from "no such user" (401).
  if (!user.is_active) {
    await logEvent('login_blocked', { reason: 'suspended' }, { userId: user.id, username: user.username, ip })
    return NextResponse.json({ error: 'Account suspended. Contact the site owner.' }, { status: 403 })
  }

  // A session is issued even for force_pw_change accounts so the user can reach
  // /change-password and authenticate the change-password POST. Enforcement of the
  // forced change now lives in the session gate: requireAuth() redirects these
  // accounts to /change-password on every other route (A1-001), and the
  // change-password route uses getSession() so it stays reachable.
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
