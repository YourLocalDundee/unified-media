// DELETE + PATCH /api/admin/users/[id]
// DELETE: hard-deletes a non-admin user and their sessions/watch history.
// PATCH: applies a safe partial update (role, is_active, force_pw_change) from
//        an allowlist — arbitrary column writes are not accepted.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { getDb } from '@/lib/db/index'
import { verifyOrigin } from '@/lib/csrf'

interface UserRow { role: string; username: string }

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  const session = await requireAdmin()

  const ip = getClientIp(req)
  const rl = checkRateLimit(`admin-users:${ip}`, 30, 10 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const { id } = await params
  // Prevent the acting admin from deleting their own account.
  if (id === session.userId) return NextResponse.json({ error: 'Cannot delete yourself' }, { status: 400 })
  const user = getDb().prepare('SELECT role FROM users WHERE id = ?').get(id) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  // Admins are protected from deletion to prevent accidental lockout.
  if (user.role === 'admin') return NextResponse.json({ error: 'Cannot delete admin accounts' }, { status: 400 })
  const db = getDb()
  // Cascade-delete sessions and watch history before the user row to avoid orphaned data.
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  db.prepare('DELETE FROM watch_events WHERE user_id = ?').run(id)
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  await logEvent('admin_action', { action: 'delete_user', targetId: id, targetUsername: user.username }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  const session = await requireAdmin()

  const ip = getClientIp(req)
  const rl = checkRateLimit(`admin-users:${ip}`, 30, 10 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const { id } = await params
  let body: { role?: string; is_active?: number; force_pw_change?: number }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const user = getDb().prepare('SELECT role, username FROM users WHERE id = ?').get(id) as UserRow | undefined
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  // Guard against an admin accidentally demoting themselves and losing access.
  if (id === session.userId && body.role !== undefined && body.role !== 'admin') {
    return NextResponse.json({ error: 'Cannot demote yourself' }, { status: 400 })
  }

  // Build the SET clause from the allowlist only — never trust raw field names from the client.
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
