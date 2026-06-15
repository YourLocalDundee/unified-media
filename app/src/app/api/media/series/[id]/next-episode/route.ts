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
  const session = await requireAuth()
  const { id } = await params

  const current = getItemById(id)
  if (!current || current.type !== 'episode' || !current.series_id) {
    return NextResponse.json(null)
  }

  const db = getDb()
  // The next *unwatched* episode after the current one (A3-05): keep the
  // sequential (season, episode) ordering and season-boundary crossing, but skip
  // episodes the user already finished so autoplay-next never replays a seen one.
  const next = db
    .prepare(
      `SELECT mi.* FROM media_items mi
       LEFT JOIN media_watch_state mws
         ON mws.media_id = mi.id AND mws.user_id = ?
       WHERE mi.series_id = ? AND mi.type = 'episode'
         AND COALESCE(mws.played, 0) = 0
         AND (
           mi.season_number > ?
           OR (mi.season_number = ? AND mi.episode_number > ?)
         )
       ORDER BY mi.season_number ASC, mi.episode_number ASC
       LIMIT 1`
    )
    .get(
      session.userId,
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
