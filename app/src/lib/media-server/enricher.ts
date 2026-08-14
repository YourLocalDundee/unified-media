import { getDb } from '@/lib/db/index'
import { searchMovie, searchTV, getMovie, getTV, getSeasonEpisodeDetails } from './tmdb'
import type { MediaItem } from './types'

export async function enrichItem(item: MediaItem): Promise<void> {
  try {
    const db = getDb()
    const now = Date.now()

    if (item.type === 'movie') {
      const match = await searchMovie(item.title, item.year ?? undefined)
      if (!match) return

      // /search/movie returns a THIN record: no imdb_id, no runtime, no genres — TMDB only sends
      // those from /movie/{id}. The UPDATE below has always written all three, so they silently
      // resolved to null on every enrichment (measured 2026-08-14: 0 of 9 movies had any of them).
      // Search to identify, then fetch details to populate. Falls back to the thin record so a
      // detail-call failure degrades to the old behaviour instead of losing the match entirely.
      const movie = await getMovie(match.id).catch((err) => {
        console.error(`[enricher] getMovie(${match.id}) failed, using search result:`, err)
        return match
      })

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
             genres         = @genres,
             popularity     = @popularity,
             vote_average   = @vote_average,
             vote_count     = @vote_count,
             updated_at     = @updated_at
         WHERE id = @id`,
      ).run({
        id: item.id,
        tmdb_id: movie.id,
        imdb_id: movie.imdb_id ?? null,
        overview: movie.overview ?? null,
        year: releaseYear,
        runtime_ticks: movie.runtime ? movie.runtime * 600_000_000 : null,
        // Bare TMDB path fragment (e.g. "/abc.jpg") — every consumer (dashboard, browse/[id],
        // library/[id], RequestsTable) prepends its own size-specific base URL via
        // tmdbImageUrl()/inline template. Storing a full URL here double-prefixes it downstream.
        poster_path: movie.poster_path ?? null,
        backdrop_path: movie.backdrop_path ?? null,
        genres: JSON.stringify(movie.genres?.map(g => g.name) ?? []),
        popularity: movie.popularity ?? null,
        vote_average: movie.vote_average ?? null,
        vote_count: movie.vote_count ?? null,
        updated_at: now,
      })
      return
    }

    if (item.type === 'episode' || item.type === 'series') {
      const match = await searchTV(item.title, item.year ?? undefined)
      if (!match) return

      // Same thin-result trap as movies, and the reason tvdb_id was NULL for every series despite
      // the UPDATE below writing it: external_ids and genres only come from /tv/{id}, and getTV
      // appends external_ids for exactly this purpose. tvdb_id matters beyond metadata — TheTVDB
      // is the only source of real absolute episode numbers, which anime needs (see
      // docs/incomplete/EPISODE_NUMBERING_PLAN.md).
      const show = await getTV(match.id).catch((err) => {
        console.error(`[enricher] getTV(${match.id}) failed, using search result:`, err)
        return match
      })

      const airYear = show.first_air_date
        ? parseInt(show.first_air_date.slice(0, 4), 10) || null
        : null

      db.prepare(
        `UPDATE media_items
         SET tmdb_id      = @tmdb_id,
             tvdb_id      = @tvdb_id,
             overview     = @overview,
             year         = @year,
             poster_path  = @poster_path,
             backdrop_path = @backdrop_path,
             genres       = @genres,
             popularity   = @popularity,
             vote_average = @vote_average,
             vote_count   = @vote_count,
             updated_at   = @updated_at
         WHERE id = @id`,
      ).run({
        id: item.id,
        tmdb_id: show.id,
        tvdb_id: show.external_ids?.tvdb_id ?? null,
        overview: show.overview ?? null,
        year: airYear,
        poster_path: show.poster_path ?? null,
        backdrop_path: show.backdrop_path ?? null,
        genres: JSON.stringify(show.genres?.map(g => g.name) ?? []),
        popularity: show.popularity ?? null,
        vote_average: show.vote_average ?? null,
        vote_count: show.vote_count ?? null,
        updated_at: now,
      })
    }
  } catch (err) {
    console.error(`[enricher] enrichItem failed for item ${item.id} (${item.title}):`, err)
  }
}

// Per-episode still images/titles/overviews for library episodes whose parent series has a
// resolved tmdb_id. Batched by season (one TMDB call covers every episode in that season)
// rather than one call per episode. Never overwrites an existing episode_title — some shows
// (e.g. old dubs the filename parser already extracted a title for) may have a more accurate
// title than TMDB's own entry; COALESCE only fills genuinely missing fields.
export async function enrichEpisodeStills(): Promise<{ enriched: number; failed: number }> {
  const db = getDb()
  const seriesRows = db
    .prepare(`SELECT id, tmdb_id FROM media_items WHERE type = 'series' AND tmdb_id IS NOT NULL`)
    .all() as { id: string; tmdb_id: number }[]

  let enriched = 0
  let failed = 0

  for (const series of seriesRows) {
    const episodes = db
      .prepare(
        `SELECT id, season_number, episode_number FROM media_items
         WHERE series_id = ? AND type = 'episode' AND season_number IS NOT NULL AND episode_number IS NOT NULL
           AND (poster_path IS NULL OR episode_title IS NULL OR overview IS NULL)`,
      )
      .all(series.id) as { id: string; season_number: number; episode_number: number }[]
    if (episodes.length === 0) continue

    const seasonNumbers = [...new Set(episodes.map((e) => e.season_number))]
    const update = db.prepare(
      `UPDATE media_items SET
         poster_path   = COALESCE(poster_path, @poster_path),
         episode_title = COALESCE(episode_title, @episode_title),
         overview      = COALESCE(overview, @overview),
         updated_at    = @updated_at
       WHERE id = @id`,
    )

    for (const seasonNumber of seasonNumbers) {
      const seasonEpisodes = episodes.filter((e) => e.season_number === seasonNumber)
      try {
        const details = await getSeasonEpisodeDetails(series.tmdb_id, seasonNumber)
        const byEpNum = new Map(details.map((d) => [d.episodeNumber, d]))
        for (const ep of seasonEpisodes) {
          const match = byEpNum.get(ep.episode_number)
          if (!match) { failed++; continue }
          update.run({
            id: ep.id,
            poster_path: match.stillPath,
            episode_title: match.name,
            overview: match.overview,
            updated_at: Date.now(),
          })
          enriched++
        }
      } catch (err) {
        console.error(`[enricher] enrichEpisodeStills failed for series ${series.id} season ${seasonNumber}:`, err)
        failed += seasonEpisodes.length
      }
      // One call per season already — 250ms is plenty conservative against TMDB's rate limits.
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  return { enriched, failed }
}

export async function enrichAll(): Promise<{ enriched: number; failed: number }> {
  const db = getDb()
  const items = db
    .prepare(
      `SELECT * FROM media_items
       WHERE (tmdb_id IS NULL OR poster_path IS NULL)
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
