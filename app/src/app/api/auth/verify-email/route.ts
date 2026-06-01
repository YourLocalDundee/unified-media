import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { checkRateLimit } from '@/lib/rate-limit'
import { createSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function makeUserId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(8)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

interface PendingRow {
  id: string; email: string; username: string; password_hash: string; code: string
  first_name: string | null; last_name: string | null; bio: string | null; location: string | null
  attempts: number; expires_at: number
}

export async function POST(req: NextRequest) {
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

  if (pending.attempts >= 5) {
    db.prepare('DELETE FROM pending_registrations WHERE id = ?').run(pendingId)
    return NextResponse.json({ error: 'Too many incorrect attempts. Please register again.' }, { status: 400 })
  }

  if (code.trim() !== pending.code) {
    db.prepare('UPDATE pending_registrations SET attempts = attempts + 1 WHERE id = ?').run(pendingId)
    const remaining = 4 - pending.attempts
    return NextResponse.json({ error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` }, { status: 400 })
  }

  // Code correct — create the user
  const now = Date.now()

  // Guard against race conditions / duplicate email from another path
  if (db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(pending.email)) {
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
