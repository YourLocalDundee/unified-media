/**
 * POST /api/auth/verify-email — Step 2 of the two-step registration flow.
 *
 * Accepts { pendingId, code } and on correct code creates the user + session
 * in a single synchronous block (SQLite serialized writes = implicit transaction).
 * The pending_registrations row is deleted atomically with user creation so
 * duplicate submissions cannot create two accounts from one verification.
 *
 * Guards: TTL expiry → delete + error. 5+ wrong attempts → delete + error.
 * Both guards delete the pending row so the user must restart registration.
 *
 * Race condition: username/email uniqueness is re-checked immediately before
 * INSERT in case another registration completed while this one was pending.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { createSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'
import { verifyOrigin } from '@/lib/csrf'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// 8-byte base62 ID gives ~47 bits of entropy — enough for a small user table.
// User IDs are not secret (they appear in audit logs) so collision resistance
// matters more than unpredictability; 47 bits is sufficient for that purpose.
function makeUserId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

interface PendingRow {
  id: string; email: string; username: string; password_hash: string; code: string
  first_name: string | null; last_name: string | null; bio: string | null; location: string | null
  attempts: number; expires_at: number
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const ip = getClientIp(req)
  const rl = checkRateLimit(`verify-email:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many verification attempts. Try again later.' }, { status: 429 })
  }

  let body: { pendingId?: string; code?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }) }

  const { pendingId, code } = body
  if (!pendingId || !code) {
    return NextResponse.json({ error: 'Missing pendingId or code.' }, { status: 400 })
  }

  const db = getDb()
  const pending = db.prepare('SELECT * FROM pending_registrations WHERE id = ?').get(pendingId) as PendingRow | undefined

  if (!pending) {
    return NextResponse.json({ error: 'Verification session not found or expired. Please register again.' }, { status: 400 })
  }

  if (Date.now() > pending.expires_at) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pendingId)
    return NextResponse.json({ error: 'Verification code expired. Please register again.' }, { status: 400 })
  }

  // Check attempt count before comparing codes to prevent timing-based inference
  // of remaining guesses. Deleting the row on exhaustion forces a fresh start.
  if (pending.attempts >= 5) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pendingId)
    return NextResponse.json({ error: 'Too many incorrect attempts. Please register again.' }, { status: 400 })
  }

  if (code.trim() !== pending.code) {
    db.prepare('UPDATE pending_registrations SET attempts = attempts + 1 WHERE id = ?').run(pendingId)
    // remaining is shown to the user; computed from stored attempts (before increment)
    const remaining = 4 - pending.attempts
    return NextResponse.json({ error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` }, { status: 400 })
  }

  // Code correct — create the user. SQLite single-writer model means these
  // three statements are effectively atomic from the app's perspective.
  const now = Date.now()

  // Re-check uniqueness: another user could have registered with the same
  // username or email between Step 1 and now.
  // pending.email was stored lowercased; compare the bare UNIQUE-indexed users.email column (C-1).
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(pending.email)) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pendingId)
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 400 })
  }
  if (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(pending.username)) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pendingId)
    return NextResponse.json({ error: 'That username was taken while you were registering. Please try again.' }, { status: 400 })
  }

  const userId = makeUserId()
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, role, first_name, last_name, bio, location, created_at, updated_at, is_active)
     VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?, ?, ?, 1)`
  ).run(userId, pending.username, pending.email, pending.password_hash,
    pending.first_name, pending.last_name, pending.bio, pending.location, now, now)

  db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pendingId)

  await logEvent('user_created', { username: pending.username, email: pending.email }, { userId, username: pending.username, ip })

  const sessionId = await createSession(userId, ip, req.headers.get('user-agent') ?? undefined)
  const cookieStore = await cookies()
  cookieStore.set('unified-session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })

  return NextResponse.json({ username: pending.username, role: 'user' })
}
