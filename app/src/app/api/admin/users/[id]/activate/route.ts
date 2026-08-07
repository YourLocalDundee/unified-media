// POST /api/admin/users/[id]/activate
// Re-enables a previously suspended account. No self-suspension guard needed here
// because the suspend route already prevents an admin from suspending themselves.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { verifyOrigin } from '@/lib/csrf'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  const session = await requireAdmin()
  const { id } = await params
  getDb().prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(id)
  await logEvent('user_activated', { targetId: id }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
