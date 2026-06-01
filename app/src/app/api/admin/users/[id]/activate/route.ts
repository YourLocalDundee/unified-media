import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params
  getDb().prepare('UPDATE users SET is_active = 1 WHERE id = ?').run(id)
  await logEvent('user_activated', { targetId: id }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
