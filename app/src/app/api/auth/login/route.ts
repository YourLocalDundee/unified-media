import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { verifyPassword } from '@/lib/password'
import { checkRateLimit } from '@/lib/rate-limit'
import { createSession, logEvent } from '@/lib/dal'
import { cookies } from 'next/headers'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_COOKIE = 'unified-session'

interface UserRow {
  id: string; username: string; password_hash: string; role: string
  is_active: number; force_pw_change: number
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? '127.0.0.1'
}

export async function POST(req: NextRequest) {
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
  const user = db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)').get(username) as UserRow | undefined

  if (!user) {
    await logEvent('login_failure', { username }, { ip })
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  if (!user.is_active) {
    return NextResponse.json({ error: 'Account suspended. Contact the site owner.' }, { status: 403 })
  }

  const recentFailures = (db.prepare(
    'SELECT COUNT(*) as c FROM login_attempts WHERE LOWER(username) = LOWER(?) AND success = 0 AND created_at > ?'
  ).get(username, Date.now() - 5 * 60 * 1000) as { c: number }).c

  const valid = await verifyPassword(password, user.password_hash)

  db.prepare('INSERT INTO login_attempts (ip_address, username, success, created_at) VALUES (?, ?, ?, ?)')
    .run(ip, username.toLowerCase(), valid ? 1 : 0, Date.now())

  if (!valid) {
    if (recentFailures >= 2) await new Promise<void>(r => setTimeout(r, 2000))
    await logEvent('login_failure', { username: user.username }, { userId: user.id, username: user.username, ip })
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  if (user.force_pw_change) {
    return NextResponse.json({ requiresPasswordChange: true })
  }

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

  return NextResponse.json({ username: user.username, role: user.role })
}
