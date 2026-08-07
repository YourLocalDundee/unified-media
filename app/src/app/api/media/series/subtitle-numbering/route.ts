import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export interface SeriesNumberingRow {
  id: string
  title: string
  tmdb_id: number | null
  subtitle_numbering: 'season' | 'absolute' | null
  skipped_count: number
  total_count: number
}

// Lists series worth showing on the subtitle-numbering panel: ones with at least one
// 'skipped' episode subtitle (candidates for the season/absolute mismatch) or a mode
// already resolved (auto-detected or manually set), so admins can see + override it.
export async function GET() {
  await requireAdmin()
  const db = getDb()

  const rows = db
    .prepare(
      `SELECT
         s.id, s.title, s.tmdb_id, s.subtitle_numbering,
         (SELECT COUNT(*) FROM subtitle_wants sw
            JOIN media_items e ON e.id = sw.media_item_id
            WHERE e.series_id = s.id AND sw.status = 'skipped') AS skipped_count,
         (SELECT COUNT(*) FROM subtitle_wants sw
            JOIN media_items e ON e.id = sw.media_item_id
            WHERE e.series_id = s.id) AS total_count
       FROM media_items s
       WHERE s.type = 'series'
       HAVING skipped_count > 0 OR subtitle_numbering IS NOT NULL
       ORDER BY skipped_count DESC`
    )
    .all() as SeriesNumberingRow[]

  return NextResponse.json(rows)
}
