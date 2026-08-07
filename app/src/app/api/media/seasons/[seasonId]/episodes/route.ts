import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

interface EpisodeRow {
  id: string
  title: string
  episode_number: number | null
  season_number: number | null
  overview: string | null
  runtime_ticks: number | null
  poster_path: string | null
  series_id: string | null
  series_poster_path: string | null
  position_ticks: number
  played: number
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  const session = await requireAuth()
  const { seasonId } = await params
  const db = getDb()

  // Look up the season record to get series_id and season_number
  const season = db
    .prepare(
      `SELECT id, series_id, season_number FROM media_items
       WHERE id = ? AND type = 'season'`
    )
    .get(seasonId) as { id: string; series_id: string | null; season_number: number | null } | undefined

  if (!season?.series_id) {
    return NextResponse.json([], { status: 200 })
  }

  const episodes = db
    .prepare(
      `SELECT
         mi.id, mi.title, mi.episode_number, mi.season_number,
         mi.overview, mi.runtime_ticks, mi.poster_path, mi.series_id,
         s.poster_path AS series_poster_path,
         COALESCE(mws.position_ticks, 0) AS position_ticks,
         COALESCE(mws.played, 0) AS played
       FROM media_items mi
       LEFT JOIN media_items s ON mi.series_id = s.id
       LEFT JOIN media_watch_state mws
         ON mi.id = mws.media_id AND mws.user_id = ?
       WHERE mi.series_id = ?
         AND mi.season_number = ?
         AND mi.type = 'episode'
       ORDER BY mi.episode_number ASC`
    )
    .all(session.userId, season.series_id, season.season_number) as EpisodeRow[]

  return NextResponse.json(episodes)
}
