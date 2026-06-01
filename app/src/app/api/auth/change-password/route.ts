import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, logEvent } from '@/lib/dal'
import { validatePassword, verifyPassword, hashPassword } from '@/lib/password'
import { getDb } from '@/lib/db/index'

interface UserRow { password_hash: string }

export async function POST(req: NextRequest) {
  const session = await requireAuth()

  let body: { currentPassword?: string; newPassword?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const { currentPassword, newPassword } = body
  if (!currentPassword || !newPassword) return NextResponse.json({ error: 'All fields are required' }, { status: 400 })

  const db = getDb()
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.userId) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const valid = await verifyPassword(currentPassword, user.password_hash)
  if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

  const pwResult = validatePassword(newPassword, session.username)
  if (!pwResult.valid) return NextResponse.json({ errors: pwResult.errors }, { status: 400 })

  const hash = await hashPassword(newPassword)
  db.prepare('UPDATE users SET password_hash = ?, force_pw_change = 0, updated_at = ? WHERE id = ?')
    .run(hash, Date.now(), session.userId)
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(session.userId, session.sessionId)

  await logEvent('password_changed', {}, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
