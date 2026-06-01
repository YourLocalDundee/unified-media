import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await requireAuth()
  const db = getDb()
  const { searchParams } = req.nextUrl
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const filter = searchParams.get('filter') ?? 'all'
  const limit = 30

  let where = 'WHERE user_id = ?'
  const params: (string | number)[] = [session.userId]

  if (filter === 'movies') { where += ' AND item_type = ?'; params.push('movie') }
  else if (filter === 'episodes') { where += ' AND item_type = ?'; params.push('episode') }
  else if (filter === 'completed') { where += ' AND completed = 1' }

  const total = (db.prepare(`SELECT COUNT(*) as c FROM watch_events ${where}`).get(...params) as { c: number }).c
  const events = db.prepare(
    `SELECT id, item_id, item_title, series_title, item_type, season_num, episode_num,
            progress_pct, watched_sec, duration_sec, completed, started_at, ended_at
     FROM watch_events ${where}
     ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, (page - 1) * limit)

  return NextResponse.json({ events, total, page, pages: Math.ceil(total / limit) })
}
