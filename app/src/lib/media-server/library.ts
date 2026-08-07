/**
 * SQLite data-access layer for the native media server.
 * All reads and writes for `media_items` and `media_watch_state` live here.
 * Callers should never query these tables directly — go through these functions
 * so query changes only need to happen in one place.
 */

import { getDb } from '@/lib/db/index'
import type { MediaItem, WatchState } from './types'

// --- Media Items ---

export function getItemById(id: string): MediaItem | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as MediaItem | undefined
}

type SortKey = 'title_asc' | 'title_desc' | 'year_desc' | 'year_asc' | 'added_desc' | 'added_asc'

// Pre-built ORDER BY clauses — kept as a lookup to prevent SQL injection via the sort param
// COALESCE(sort_title, title) COLLATE NOCASE so case and NULL sort_title don't
// produce blank-keyed rows at the head and the order matches everywhere (A3-09).
const SORT_CLAUSE: Record<SortKey, string> = {
  title_asc:   'ORDER BY COALESCE(sort_title, title) COLLATE NOCASE ASC',
  title_desc:  'ORDER BY COALESCE(sort_title, title) COLLATE NOCASE DESC',
  year_desc:   'ORDER BY year DESC NULLS LAST',
  year_asc:    'ORDER BY year ASC NULLS LAST',
  added_desc:  'ORDER BY added_at DESC',
  added_asc:   'ORDER BY added_at ASC',
}

// `type` may be a concrete type ('movie'/'series'/...) or the pseudo-type 'all',
// which spans the two owned top-level types. Kept here (not inlined) so the
// matching getCountByType stays in lockstep.
function typeWhere(type: string): { clause: string; params: string[] } {
  return type === 'all'
    ? { clause: `type IN ('movie','series')`, params: [] }
    : { clause: `type = ?`, params: [type] }
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
  const { clause, params } = typeWhere(type)
  if (year) {
    return db
      .prepare(`SELECT * FROM media_items WHERE ${clause} AND year = ? ${order} LIMIT ? OFFSET ?`)
      .all(...params, year, limit, offset) as MediaItem[]
  }
  return db
    .prepare(`SELECT * FROM media_items WHERE ${clause} ${order} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as MediaItem[]
}

// Count for the same predicate getItemsByType uses, so pagination totals stay
// correct for the 'all' tab and year-filtered views (A3-08, A3-11).
export function getCountByType(type: string, year?: number): number {
  const db = getDb()
  const { clause, params } = typeWhere(type)
  const where = year ? `WHERE ${clause} AND year = ?` : `WHERE ${clause}`
  const queryParams = year ? [...params, year] : params
  return (db.prepare(`SELECT COUNT(*) AS n FROM media_items ${where}`).get(...queryParams) as { n: number }).n
}

export function searchItems(query: string, limit = 20): MediaItem[] {
  const db = getDb()
  // Escape LIKE wildcards so a literal % or _ in the query doesn't match everything,
  // and restrict to top-level owned types so raw episode rows don't leak into a
  // movie/series search context (A3-13).
  const escaped = query.replace(/[\\%_]/g, (c) => '\\' + c)
  const like = '%' + escaped + '%'
  return db
    .prepare(
      `SELECT * FROM media_items
       WHERE type IN ('movie','series')
         AND (title LIKE ? ESCAPE '\\' OR sort_title LIKE ? ESCAPE '\\')
       ${SORT_CLAUSE.title_asc}
       LIMIT ?`
    )
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

const TICKS_PER_SECOND = 10_000_000

// Record/refresh the user's watch_events row for this media (A3-01). watch_events
// is what /history and the admin "Watches"/activity views read, but nothing ever
// wrote it — only media_watch_state was updated, so the whole history feature was
// permanently empty. One row per (user, item) via the unique index, upserted so a
// periodic progress beacon refreshes the row rather than flooding the log.
// watched_sec/completed are kept monotonic so a backward scrub can't shrink the
// recorded progress. Best-effort: history logging must never disrupt playback.
export function recordWatchEvent(
  userId: string,
  mediaId: string,
  positionTicks: number,
  played: boolean,
): void {
  try {
    const db = getDb()
    const item = db
      .prepare(
        `SELECT type, title, series_id, season_number, episode_number, runtime_ticks
         FROM media_items WHERE id = ?`,
      )
      .get(mediaId) as
      | { type: string; title: string; series_id: string | null; season_number: number | null; episode_number: number | null; runtime_ticks: number | null }
      | undefined
    if (!item) return

    const now = Date.now()
    const runtimeTicks = item.runtime_ticks ?? 0
    const watchedSec = Math.round(positionTicks / TICKS_PER_SECOND)
    const durationSec = runtimeTicks > 0 ? Math.round(runtimeTicks / TICKS_PER_SECOND) : null
    const progressPct = runtimeTicks > 0 ? Math.min(100, (positionTicks / runtimeTicks) * 100) : null

    // Episodes log the parent series title alongside the episode title.
    let seriesTitle: string | null = null
    if (item.type === 'episode' && item.series_id) {
      const s = db.prepare('SELECT title FROM media_items WHERE id = ?').get(item.series_id) as { title: string } | undefined
      seriesTitle = s?.title ?? null
    }

    db.prepare(
      `INSERT INTO watch_events
         (user_id, item_id, item_title, series_title, item_type, season_num, episode_num,
          progress_pct, duration_sec, watched_sec, completed, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, item_id) DO UPDATE SET
         progress_pct = excluded.progress_pct,
         duration_sec = excluded.duration_sec,
         watched_sec  = MAX(watched_sec, excluded.watched_sec),
         completed    = MAX(completed, excluded.completed),
         ended_at     = excluded.ended_at`,
    ).run(
      userId, mediaId, item.title, seriesTitle, item.type,
      item.season_number ?? null, item.episode_number ?? null,
      progressPct, durationSec, watchedSec, played ? 1 : 0, now, now,
    )
  } catch { /* best-effort history logging — never disrupt playback */ }
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
       ORDER BY media_watch_state.updated_at DESC
       LIMIT ?`,
    )
    .all(userId, limit) as MediaItem[]
}

// Resolve the "Watch Now" target for a series (A3-06). Prefer an in-progress
// episode (most recently touched); otherwise the first UNWATCHED episode by
// (season, episode); return undefined only when every episode is played, so the
// caller's episodes[0] fallback means "rewatch from the start".
export function getSeriesResumeEpisode(userId: string, seriesId: string): MediaItem | undefined {
  const db = getDb()

  const inProgress = db
    .prepare(
      `SELECT media_items.*
       FROM media_items
       JOIN media_watch_state ON media_items.id = media_watch_state.media_id
       WHERE media_watch_state.user_id = ?
         AND media_items.series_id = ?
         AND media_items.type = 'episode'
         AND media_watch_state.played = 0
         AND media_watch_state.position_ticks > 0
       ORDER BY media_watch_state.updated_at DESC
       LIMIT 1`,
    )
    .get(userId, seriesId) as MediaItem | undefined
  if (inProgress) return inProgress

  return db
    .prepare(
      `SELECT media_items.*
       FROM media_items
       LEFT JOIN media_watch_state
         ON media_watch_state.media_id = media_items.id
        AND media_watch_state.user_id = ?
       WHERE media_items.series_id = ?
         AND media_items.type = 'episode'
         AND COALESCE(media_watch_state.played, 0) = 0
       ORDER BY media_items.season_number, media_items.episode_number
       LIMIT 1`,
    )
    .get(userId, seriesId) as MediaItem | undefined
}

export function getSimilarItems(id: string, limit = 10): MediaItem[] {
  const db = getDb()
  const item = db
    .prepare('SELECT type, genres FROM media_items WHERE id = ?')
    .get(id) as { type: string; genres: string | null } | undefined

  if (!item) return []

  // Parse the subject item's genres
  let subjectGenres: string[] = []
  if (item.genres) {
    try { subjectGenres = JSON.parse(item.genres) as string[] } catch { /* malformed — treat as empty */ }
  }

  // Fetch candidates of the same type that have genre data, ordered by recency
  const candidates = db
    .prepare(
      `SELECT * FROM media_items WHERE type = ? AND id != ?
       AND genres IS NOT NULL AND genres != '[]'
       ORDER BY year DESC LIMIT ?`
    )
    .all(item.type, id, limit * 4) as MediaItem[]

  if (subjectGenres.length > 0) {
    // Filter to items sharing at least one genre with the subject.
    // genres is stored as JSON text in SQLite; cast through unknown before parsing.
    const matched = candidates.filter(row => {
      let rowGenres: string[] = []
      const raw = row.genres as unknown as string | null
      try { rowGenres = JSON.parse(raw ?? '[]') as string[] } catch { return false }
      return rowGenres.some(g => subjectGenres.includes(g))
    })

    const result = matched.slice(0, limit)

    // Pad with other same-type items if genre filter left fewer than limit
    if (result.length < limit) {
      const existing = new Set(result.map(r => r.id))
      const pad = db
        .prepare(
          `SELECT * FROM media_items WHERE type = ? AND id != ?
           ORDER BY year DESC LIMIT ?`
        )
        .all(item.type, id, limit * 2) as MediaItem[]
      for (const r of pad) {
        if (!existing.has(r.id)) {
          result.push(r)
          if (result.length >= limit) break
        }
      }
    }

    return result
  }

  // No genre data on subject — fall back to same-type items by year
  return db
    .prepare(
      `SELECT * FROM media_items WHERE type = ? AND id != ?
       ORDER BY year DESC LIMIT ?`
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

  // Collect distinct genre values by parsing the JSON text column
  const genreRows = db
    .prepare(
      type
        ? `SELECT DISTINCT genres FROM media_items WHERE type = ? AND genres IS NOT NULL`
        : `SELECT DISTINCT genres FROM media_items WHERE genres IS NOT NULL`
    )
    .all(...(type ? [type] : [])) as Array<{ genres: string }>

  const genreSet = new Set<string>()
  for (const row of genreRows) {
    try {
      const parsed = JSON.parse(row.genres) as string[]
      for (const g of parsed) if (g) genreSet.add(g)
    } catch { /* skip malformed rows */ }
  }
  const genres = Array.from(genreSet).sort()

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
