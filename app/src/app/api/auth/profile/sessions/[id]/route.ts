/**
 * DELETE /api/auth/profile/sessions/[id] — revokes a single session by ID.
 *
 * Guards:
 * 1. The current session cannot be revoked via this route (use logout instead).
 * 2. The target session must belong to the authenticated user — the WHERE clause
 *    includes user_id so one user cannot revoke another user's sessions.
 *
 * Both checks prevent IDOR and accidental self-lockout from the sessions UI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  const { id } = await params

  // Prevent accidental self-lockout; the current session must be terminated via logout.
  if (id === session.sessionId) {
    return NextResponse.json({ error: 'Cannot revoke current session' }, { status: 400 })
  }

  const db = getDb()
  // user_id check prevents IDOR: user A cannot delete user B's session by guessing its ID.
  const target = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(id, session.userId)
  if (!target) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, session.userId)
  return NextResponse.json({ ok: true })
}
