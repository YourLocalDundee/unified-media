import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { validatePassword, hashPassword } from '@/lib/password'
import { checkRateLimit } from '@/lib/rate-limit'
import { sendEmail, buildVerificationEmail } from '@/lib/email'

function makeId(size = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const array = new Uint8Array(size)
  crypto.getRandomValues(array)
  for (const byte of array) result += chars[byte % chars.length]
  return result
}

function makeCode(): string {
  const array = new Uint8Array(6)
  crypto.getRandomValues(array)
  return Array.from(array).map(b => b % 10).join('')
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = checkRateLimit(`register:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many registration attempts. Try again later.' }, { status: 429 })
  }

  let body: {
    username?: string; email?: string; password?: string; confirmPassword?: string
    firstName?: string; lastName?: string; bio?: string; location?: string
  }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const { username, email, password, confirmPassword, firstName, lastName, bio, location } = body

  if (!username || !email || !password || !confirmPassword) {
    return NextResponse.json({ error: 'All required fields must be provided.' }, { status: 400 })
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json({ error: 'Username must be 3–20 characters (letters, numbers, underscores).' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 })
  }
  const pwResult = validatePassword(password, username)
  if (!pwResult.valid) return NextResponse.json({ errors: pwResult.errors }, { status: 400 })
  if (password !== confirmPassword) {
    return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 })
  }

  const db = getDb()
  if (db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)) {
    return NextResponse.json({ error: 'Username already taken.' }, { status: 400 })
  }
  if (db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email)) {
    return NextResponse.json({ error: 'An account with that email already exists.' }, { status: 400 })
  }

  const now = Date.now()
  db.prepare('DELETE FROM pending_registrations WHERE LOWER(email) = ? OR expires_at < ?').run(email.toLowerCase(), now)

  const hash = await hashPassword(password)
  const pendingId = makeId(32)
  const code = makeCode()

  db.prepare(
    `INSERT INTO pending_registrations (id, email, username, password_hash, code, first_name, last_name, bio, location, attempts, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    pendingId, email.toLowerCase(), username, hash, code,
    firstName?.trim() || null, lastName?.trim() || null,
    bio?.trim() || null, location?.trim() || null,
    now + 10 * 60 * 1000, now
  )

  const emailPayload = buildVerificationEmail(code, username)
  emailPayload.to = email
  await sendEmail(emailPayload)

  return NextResponse.json({ pendingId })
}
