import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import { getDb } from '@/lib/db/index'
import type { MediaItem } from '@/lib/media-server/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await params

  const current = getItemById(id)
  if (!current || current.type !== 'episode' || !current.series_id) {
    return NextResponse.json(null)
  }

  const db = getDb()
  const next = db
    .prepare(
      `SELECT * FROM media_items
       WHERE series_id = ? AND type = 'episode'
         AND (
           season_number > ?
           OR (season_number = ? AND episode_number > ?)
         )
       ORDER BY season_number ASC, episode_number ASC
       LIMIT 1`
    )
    .get(
      current.series_id,
      current.season_number ?? 0,
      current.season_number ?? 0,
      current.episode_number ?? 0
    ) as MediaItem | undefined

  if (!next) return NextResponse.json(null)

  const seasonEpisode =
    next.season_number != null && next.episode_number != null
      ? `S${String(next.season_number).padStart(2, '0')} E${String(next.episode_number).padStart(2, '0')}`
      : undefined

  return NextResponse.json({ id: next.id, title: next.title, seasonEpisode })
}
