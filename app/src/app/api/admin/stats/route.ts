import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

interface StatRow { c: number }

export async function GET() {
  await requireAdmin()
  const db = getDb()
  const now = Date.now()
  const dayMs = 86400000

  return NextResponse.json({
    totalUsers: (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('user') as StatRow).c,
    activeToday: (db.prepare('SELECT COUNT(DISTINCT user_id) as c FROM sessions WHERE last_seen > ?').get(now - dayMs) as StatRow).c,
    totalWatchHours: Math.round(((db.prepare('SELECT COALESCE(SUM(watched_sec), 0) as c FROM watch_events').get() as StatRow).c) / 3600),
  })
}
