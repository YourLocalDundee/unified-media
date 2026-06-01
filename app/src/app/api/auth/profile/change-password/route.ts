import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, logEvent } from '@/lib/dal'
import { verifyPassword, validatePassword, hashPassword } from '@/lib/password'
import { getDb } from '@/lib/db/index'
import { checkRateLimit } from '@/lib/rate-limit'

interface UserRow { password_hash: string }

export async function POST(req: NextRequest) {
  const session = await requireAuth()

  const rl = checkRateLimit(`change-password:${session.userId}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 })
  }

  let body: { currentPassword?: unknown; newPassword?: unknown; confirmPassword?: unknown }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const { currentPassword, newPassword, confirmPassword } = body
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmPassword !== 'string') {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }
  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: 'New passwords do not match' }, { status: 400 })
  }

  const db = getDb()
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.userId) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const currentValid = await verifyPassword(currentPassword, user.password_hash)
  if (!currentValid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
  }

  const pwResult = validatePassword(newPassword, session.username)
  if (!pwResult.valid) {
    return NextResponse.json({ errors: pwResult.errors }, { status: 400 })
  }

  const hash = await hashPassword(newPassword)
  db.prepare('UPDATE users SET password_hash = ?, force_pw_change = 0, updated_at = ? WHERE id = ?')
    .run(hash, Date.now(), session.userId)
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .run(session.userId, session.sessionId)

  await logEvent('password_changed', {}, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
