import { getDb } from '@/lib/db/index'
import type { MediaItem, WatchState } from './types'

// --- Media Items ---

export function getItemById(id: string): MediaItem | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined
}

type SortKey = 'title_asc' | 'title_desc' | 'year_desc' | 'year_asc' | 'added_desc' | 'added_asc'

const SORT_CLAUSE: Record<SortKey, string> = {
  title_asc:   'ORDER BY sort_title ASC',
  title_desc:  'ORDER BY sort_title DESC',
  year_desc:   'ORDER BY year DESC NULLS LAST',
  year_asc:    'ORDER BY year ASC NULLS LAST',
  added_desc:  'ORDER BY added_at DESC',
  added_asc:   'ORDER BY added_at ASC',
}

export function getItemsByType(
  type: string,
  limit = 50,
  offset = 0,
  year?: number,
  sort: SortKey = 'title_asc',
): MediaItem[] {
  const db = getDb()
  const order = SORT_CLAUSE[sort] ?? SORT_CLAUSE.title_asc
  if (year) {
    return db
      .prepare(`SELECT * FROM media_items WHERE type = ? AND year = ? ${order} LIMIT ? OFFSET ?`)
      .all(type, year, limit, offset) as MediaItem[]
  }
  return db
    .prepare(`SELECT * FROM media_items WHERE type = ? ${order} LIMIT ? OFFSET ?`)
    .all(type, limit, offset) as MediaItem[]
}

export function searchItems(query: string, limit = 20): MediaItem[] {
  const db = getDb()
  const like = '%' + query + '%'
  return db
    .prepare('SELECT * FROM media_items WHERE title LIKE ? OR sort_title LIKE ? LIMIT ?')
    .all(like, like, limit) as MediaItem[]
}

export function getRecentlyAdded(limit = 16): MediaItem[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT * FROM media_items
       WHERE type IN ('movie','series')
       ORDER BY added_at DESC, title ASC
       LIMIT ?`,
    )
    .all(limit) as MediaItem[]
}

export function getEpisodesForSeries(seriesId: string): MediaItem[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT * FROM media_items
       WHERE series_id = ? AND type = 'episode'
       ORDER BY season_number, episode_number`,
    )
    .all(seriesId) as MediaItem[]
}

export function getTotalCount(): { movies: number; episodes: number; series: number } {
  const db = getDb()
  const movies = (
    db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE type = 'movie'").get() as { n: number }
  ).n
  const episodes = (
    db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE type = 'episode'").get() as {
      n: number
    }
  ).n
  const series = (
    db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE type = 'series'").get() as { n: number }
  ).n
  return { movies, episodes, series }
}

// --- Watch State ---

export function getWatchState(userId: string, mediaId: string): WatchState | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM media_watch_state WHERE user_id = ? AND media_id = ?')
    .get(userId, mediaId) as WatchState | undefined
}

export function upsertWatchState(
  userId: string,
  mediaId: string,
  positionTicks: number,
  played?: boolean,
): void {
  const db = getDb()
  const now = Date.now()

  if (played) {
    // Increment play_count and set last_played when marking played
    db.prepare(
      `INSERT INTO media_watch_state
         (user_id, media_id, position_ticks, played, play_count, last_played, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?)
       ON CONFLICT(user_id, media_id) DO UPDATE SET
         position_ticks = excluded.position_ticks,
         played         = 1,
         play_count     = play_count + 1,
         last_played    = excluded.last_played,
         updated_at     = excluded.updated_at`,
    ).run(userId, mediaId, positionTicks, now, now)
  } else {
    db.prepare(
      `INSERT INTO media_watch_state
         (user_id, media_id, position_ticks, played, play_count, last_played, updated_at)
       VALUES (?, ?, ?, 0, 0, NULL, ?)
       ON CONFLICT(user_id, media_id) DO UPDATE SET
         position_ticks = excluded.position_ticks,
         updated_at     = excluded.updated_at`,
    ).run(userId, mediaId, positionTicks, now)
  }
}

export function getResumeItems(userId: string, limit = 12): MediaItem[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT media_items.*
       FROM media_items
       JOIN media_watch_state ON media_items.id = media_watch_state.media_id
       WHERE media_watch_state.user_id = ?
         AND media_watch_state.played = 0
         AND media_watch_state.position_ticks > 0
         AND media_items.type IN ('movie', 'episode')
       ORDER BY media_watch_state.last_played DESC
       LIMIT ?`,
    )
    .all(userId, limit) as MediaItem[]
}

export function getSimilarItems(id: string, limit = 10): MediaItem[] {
  const db = getDb()
  const item = db
    .prepare('SELECT type, tmdb_id FROM media_items WHERE id = ?')
    .get(id) as { type: string; tmdb_id: number | null } | undefined

  if (!item) return []

  // TODO: implement proper similarity using TMDB recommendations or genre matching
  // For now: return items of same type, excluding the item itself
  return db
    .prepare(
      `SELECT * FROM media_items
       WHERE type = ? AND id != ?
       ORDER BY added_at DESC
       LIMIT ?`
    )
    .all(item.type, id, limit) as MediaItem[]
}

export function getItemsByTmdbIds(tmdbIds: number[]): Record<number, string> {
  if (tmdbIds.length === 0) return {}
  const db = getDb()
  const placeholders = tmdbIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT id, tmdb_id FROM media_items
       WHERE tmdb_id IN (${placeholders}) AND type IN ('movie','series')`
    )
    .all(...tmdbIds) as { id: string; tmdb_id: number }[]
  const map: Record<number, string> = {}
  for (const row of rows) {
    map[row.tmdb_id] = row.id
  }
  return map
}

export function getAvailableFilters(type?: string): {
  genres: string[]
  years: number[]
} {
  const db = getDb()

  // TODO: genres are not yet stored in media_items; return empty until schema adds them
  const years = db
    .prepare(
      type
        ? `SELECT DISTINCT year FROM media_items WHERE type = ? AND year IS NOT NULL ORDER BY year DESC`
        : `SELECT DISTINCT year FROM media_items WHERE year IS NOT NULL ORDER BY year DESC`
    )
    .all(...(type ? [type] : [])) as Array<{ year: number }>

  return {
    genres: [],
    years: years.map((r) => r.year),
  }
}
