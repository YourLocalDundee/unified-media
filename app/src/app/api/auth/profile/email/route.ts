import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function PATCH(req: NextRequest) {
  const session = await requireAuth()

  let body: { email?: unknown }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const email = body.email
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
  }
  const trimmed = email.trim().toLowerCase()

  const db = getDb()
  const conflict = db.prepare('SELECT id FROM users WHERE LOWER(email) = ? AND id != ?').get(trimmed, session.userId)
  if (conflict) {
    return NextResponse.json({ error: 'That email address is already in use' }, { status: 409 })
  }

  db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
    .run(trimmed, Date.now(), session.userId)

  return NextResponse.json({ ok: true })
}
