import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

interface UserRow { role: string; username: string }

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params
  if (id === session.userId) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })
  const user = getDb().prepare('SELECT role FROM users WHERE id = ?').get(id) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (user.role === 'admin') return NextResponse.json({ error: 'Cannot delete admin accounts' }, { status: 400 })
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  db.prepare('DELETE FROM watch_events WHERE user_id = ?').run(id)
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  await logEvent('admin_action', { action: 'delete_user', targetId: id, targetUsername: user.username }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params
  let body: { role?: string; is_active?: number; force_pw_change?: number }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const user = getDb().prepare('SELECT role, username FROM users WHERE id = ?').get(id) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (id === session.userId && body.role !== undefined && body.role !== 'admin') {
    return NextResponse.json({ error: 'Cannot demote yourself' }, { status: 400 })
  }

  const fields: string[] = []
  const values: (string | number)[] = []
  if (body.role !== undefined && ['admin', 'user'].includes(body.role)) {
    fields.push('role = ?'); values.push(body.role)
  }
  if (body.is_active !== undefined) {
    fields.push('is_active = ?'); values.push(body.is_active ? 1 : 0)
  }
  if (body.force_pw_change !== undefined) {
    fields.push('force_pw_change = ?'); values.push(body.force_pw_change ? 1 : 0)
  }
  if (!fields.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  fields.push('updated_at = ?'); values.push(Date.now())
  getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
  await logEvent('admin_action', { action: 'patch_user', targetId: id, changes: body }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
