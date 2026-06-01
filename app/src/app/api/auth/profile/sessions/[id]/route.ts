import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  const { id } = await params

  if (id === session.sessionId) {
    return NextResponse.json({ error: 'Cannot revoke current session' }, { status: 400 })
  }

  const db = getDb()
  const target = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(id, session.userId)
  if (!target) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(id, session.userId)
  return NextResponse.json({ ok: true })
}
