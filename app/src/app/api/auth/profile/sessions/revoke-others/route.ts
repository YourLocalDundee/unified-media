import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function POST() {
  const session = await requireAuth()
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .run(session.userId, session.sessionId)
  return NextResponse.json({ ok: true })
}
