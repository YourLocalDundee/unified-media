// GET /api/admin/activity
// Returns a paginated slice of all watch_events joined with usernames.
// The JOIN is intentional — watch_events stores user_id, not username, so denormalizing
// at read time keeps the write path simple and the DB normalized.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAdmin()
  const { searchParams } = req.nextUrl
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const limit = 50
  const db = getDb()
  const total = (db.prepare('SELECT COUNT(*) as c FROM watch_events').get() as { c: number }).c
  const events = db.prepare(
    `SELECT we.*, u.username FROM watch_events we JOIN users u ON we.user_id = u.id
     ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(limit, (page - 1) * limit)
  return NextResponse.json({ events, total, page, pages: Math.ceil(total / limit) })
}
