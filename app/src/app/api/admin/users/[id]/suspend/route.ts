// POST /api/admin/users/[id]/suspend
// Sets is_active = 0 which blocks login for the user. The self-suspension guard
// is a safety net — existing sessions are not invalidated here (admins must do
// that separately via the sessions tab).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { verifyOrigin } from '@/lib/csrf'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  const session = await requireAdmin()
  const { id } = await params
  // Prevent an admin from locking themselves out.
  if (id === session.userId) return NextResponse.json({ error: 'Cannot suspend yourself' }, { status: 400 })
  getDb().prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id)
  await logEvent('user_suspended', { targetId: id }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
