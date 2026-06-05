// Continue-watching feed for the home page dashboard.
// Reads from the native media server's media_watch_state table (Phase 5) rather
// than calling Jellyfin directly, so it reflects the independence-build playback state.
// Returns at most 10 items: one episode per series (most recent) plus all in-progress movies.
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

interface ContinueWatchingItem {
  id: string
  seriesId?: string
  title: string
  subtitle?: string
  type: 'Episode' | 'Movie'
  imageId: string
  progress: number
  lastPlayed: string
}

interface ResumeRow {
  id: string
  type: string
  title: string
  series_id: string | null
  season_number: number | null
  episode_number: number | null
  poster_path: string | null
  backdrop_path: string | null
  runtime_ticks: number | null
  position_ticks: number
  last_played: number | null
  series_title: string | null
  series_poster_path: string | null
}

export async function GET() {
  try {
    const session = await requireAuth()
    const db = getDb()

    const rows = db
      .prepare(
        `SELECT
           mi.id, mi.type, mi.title,
           mi.series_id, mi.season_number, mi.episode_number,
           mi.poster_path, mi.backdrop_path, mi.runtime_ticks,
           mws.position_ticks, mws.last_played,
           s.title AS series_title,
           s.poster_path AS series_poster_path
         FROM media_items mi
         JOIN media_watch_state mws ON mi.id = mws.media_id
         LEFT JOIN media_items s ON mi.series_id = s.id
         WHERE mws.user_id = ?
           AND mws.played = 0
           AND mws.position_ticks > 0
           AND mi.type IN ('movie', 'episode')
         ORDER BY mws.last_played DESC
         LIMIT 50`
      )
      .all(session.userId) as ResumeRow[]

    // Show only the most recently watched episode per series rather than one row
    // per episode — the home page card links to that episode, so duplicates are noise.
    const seriesMap = new Map<string, ResumeRow>()
    const movies: ResumeRow[] = []

    for (const row of rows) {
      if (row.type === 'episode' && row.series_id) {
        const existing = seriesMap.get(row.series_id)
        if (!existing || (row.last_played ?? 0) > (existing.last_played ?? 0)) {
          seriesMap.set(row.series_id, row)
        }
      } else if (row.type === 'movie') {
        movies.push(row)
      }
    }

    const all: ContinueWatchingItem[] = []

    for (const ep of seriesMap.values()) {
      const s = ep.season_number
      const e = ep.episode_number
      const subtitle =
        s != null && e != null
          ? `S${s} E${e} · ${ep.title}`
          : ep.title

      all.push({
        id: ep.id,
        seriesId: ep.series_id ?? undefined,
        title: ep.series_title ?? ep.title,
        subtitle,
        type: 'Episode',
        // Use series poster for the card image; fall back to episode thumb if orphaned.
        imageId: ep.series_id ?? ep.id,
        progress:
          ep.runtime_ticks && ep.runtime_ticks > 0
            ? ep.position_ticks / ep.runtime_ticks
            : 0,
        lastPlayed: ep.last_played ? new Date(ep.last_played).toISOString() : '',
      })
    }

    for (const movie of movies) {
      all.push({
        id: movie.id,
        title: movie.title,
        type: 'Movie',
        imageId: movie.id,
        progress:
          movie.runtime_ticks && movie.runtime_ticks > 0
            ? movie.position_ticks / movie.runtime_ticks
            : 0,
        lastPlayed: movie.last_played ? new Date(movie.last_played).toISOString() : '',
      })
    }

    const items = all
      .sort((a, b) => b.lastPlayed.localeCompare(a.lastPlayed))
      .slice(0, 10)

    return NextResponse.json(items)
  } catch {
    // Return empty array on any error so the home page still renders — this is a
    // non-critical widget and a thrown error should not break the whole dashboard.
    return NextResponse.json([], { status: 200 })
  }
}
