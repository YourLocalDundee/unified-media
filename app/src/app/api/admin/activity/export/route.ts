// GET /api/admin/activity/export
// Streams the full untruncated watch_events table as a CSV download.
// No pagination — this is intentionally a full dump for offline analysis.

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

interface WatchRow {
  username: string; item_title: string; item_type: string; series_title: string | null;
  season_num: number | null; episode_num: number | null; progress_pct: number | null;
  watched_sec: number | null; duration_sec: number | null; completed: number; started_at: number
}

export const dynamic = 'force-dynamic'

// A21/A9-04: neutralize CSV formula injection. A cell whose first char is = + - @
// (or a leading tab/CR) is run as a formula by Excel/Sheets. Prefix with a single
// quote so it stays literal text. Applied before JSON.stringify (which only handles
// quoting/commas, not formula prefixes — a JSON-quoted "=cmd" is still a formula once
// the spreadsheet strips the surrounding quotes).
function csvSafe(value: unknown): string {
  const str = String(value)
  return /^[=+\-@\t\r]/.test(str) ? "'" + str : str
}

export async function GET() {
  await requireAdmin()
  const rows = getDb().prepare(
    `SELECT u.username, we.item_title, we.item_type, we.series_title, we.season_num,
            we.episode_num, we.progress_pct, we.watched_sec, we.duration_sec,
            we.completed, we.started_at
     FROM watch_events we JOIN users u ON we.user_id = u.id
     ORDER BY started_at DESC`
  ).all() as WatchRow[]

  const header = 'username,title,type,series,season,episode,progress_pct,watched_sec,duration_sec,completed,started_at\n'
  // Each cell is formula-neutralized then JSON.stringify'd to handle commas/quotes safely.
  const body = rows.map(r =>
    [r.username, r.item_title, r.item_type, r.series_title ?? '', r.season_num ?? '', r.episode_num ?? '',
     r.progress_pct ?? '', r.watched_sec ?? '', r.duration_sec ?? '', r.completed,
     new Date(r.started_at).toISOString()].map(v => JSON.stringify(csvSafe(v))).join(',')
  ).join('\n')

  return new NextResponse(header + body, {
    headers: {
      'Content-Type': 'text/csv',
      // Content-Disposition triggers browser "Save As" dialog with a default filename.
      'Content-Disposition': 'attachment; filename="watch-activity.csv"',
    },
  })
}
