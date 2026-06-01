import { getDb } from '@/lib/db/index'
import { searchMovie, searchTV, tmdbImageUrl } from './tmdb'
import type { MediaItem } from './types'

export async function enrichItem(item: MediaItem): Promise<void> {
  try {
    const db = getDb()
    const now = Date.now()

    if (item.type === 'movie') {
      const movie = await searchMovie(item.title, item.year ?? undefined)
      if (!movie) return

      const releaseYear = movie.release_date
        ? parseInt(movie.release_date.slice(0, 4), 10) || null
        : null

      db.prepare(
        `UPDATE media_items
         SET tmdb_id        = @tmdb_id,
             imdb_id        = @imdb_id,
             overview       = @overview,
             year           = @year,
             runtime_ticks  = @runtime_ticks,
             poster_path    = @poster_path,
             backdrop_path  = @backdrop_path,
             updated_at     = @updated_at
         WHERE id = @id`,
      ).run({
        id: item.id,
        tmdb_id: movie.id,
        imdb_id: movie.imdb_id ?? null,
        overview: movie.overview ?? null,
        year: releaseYear,
        runtime_ticks: movie.runtime ? movie.runtime * 600_000_000 : null,
        poster_path: tmdbImageUrl(movie.poster_path, 'w342'),
        backdrop_path: tmdbImageUrl(movie.backdrop_path, 'w780'),
        updated_at: now,
      })
      return
    }

    if (item.type === 'episode' || item.type === 'series') {
      const show = await searchTV(item.title, item.year ?? undefined)
      if (!show) return

      const airYear = show.first_air_date
        ? parseInt(show.first_air_date.slice(0, 4), 10) || null
        : null

      db.prepare(
        `UPDATE media_items
         SET tmdb_id    = @tmdb_id,
             tvdb_id    = @tvdb_id,
             overview   = @overview,
             year       = @year,
             poster_path = @poster_path,
             updated_at = @updated_at
         WHERE id = @id`,
      ).run({
        id: item.id,
        tmdb_id: show.id,
        tvdb_id: show.external_ids?.tvdb_id ?? null,
        overview: show.overview ?? null,
        year: airYear,
        poster_path: tmdbImageUrl(show.poster_path, 'w342'),
        updated_at: now,
      })
    }
  } catch (err) {
    console.error(`[enricher] enrichItem failed for item ${item.id} (${item.title}):`, err)
  }
}

export async function enrichAll(): Promise<{ enriched: number; failed: number }> {
  const db = getDb()
  const items = db
    .prepare(
      `SELECT * FROM media_items
       WHERE tmdb_id IS NULL
         AND type IN ('movie','series')`,
    )
    .all() as MediaItem[]

  let enriched = 0
  let failed = 0

  for (const item of items) {
    const before = db.prepare('SELECT tmdb_id FROM media_items WHERE id = ?').get(item.id) as
      | { tmdb_id: number | null }
      | undefined

    await enrichItem(item)

    const after = db.prepare('SELECT tmdb_id FROM media_items WHERE id = ?').get(item.id) as
      | { tmdb_id: number | null }
      | undefined

    if (after?.tmdb_id != null && before?.tmdb_id == null) {
      enriched++
    } else if (after?.tmdb_id == null) {
      failed++
    }

    // Respect TMDB rate limits — 250ms between calls
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  return { enriched, failed }
}
