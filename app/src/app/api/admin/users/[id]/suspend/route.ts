import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  const { id } = await params
  if (id === session.userId) return NextResponse.json({ error: 'Cannot suspend yourself' }, { status: 400 })
  getDb().prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(id)
  await logEvent('user_suspended', { targetId: id }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
