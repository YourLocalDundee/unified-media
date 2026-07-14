// Episode-numbering resolution for the subtitle system.
//
// Long-running anime often get "seasons" from story-arc boundaries (our scanner assigns
// season_number/episode_number this way) that don't match OpenSubtitles' own catalog, which
// files some shows (confirmed live: Naruto Shippuden, Hunter x Hunter (2011), Dragon Ball Kai)
// under a single season with absolute, cross-season episode numbers instead. A search using our
// arc-based season/episode returns zero results for those shows even with a correct TMDB id.
//
// This module tracks both numbering schemes per episode (absolute_episode_number, computed by
// ordering a series' episodes by season+episode) and auto-detects + caches which scheme actually
// matches on OpenSubtitles per series (media_items.subtitle_numbering), so only one "probe"
// episode per series ever pays for two searches. Admins can also force a mode via
// PATCH /api/media/series/[id]/subtitle-numbering (surfaced on /admin/subtitles) for shows the
// auto-probe gets wrong or hasn't reached yet.
import { getDb } from '@/lib/db/index'
import { searchSubtitles } from './opensubtitles'
import type { OSSubtitle, SubtitleSearchParams } from './types'

export type SubtitleNumberingMode = 'season' | 'absolute'

// Ordering a series' episodes by (season_number, episode_number) and numbering them 1..N
// reproduces OpenSubtitles' absolute numbering without needing an external absolute-episode
// data source — our arc-based seasons are already in the show's correct broadcast order.
export function computeAbsoluteEpisodeNumbers(seriesId: string): void {
  const db = getDb()
  const episodes = db
    .prepare(
      `SELECT id FROM media_items
       WHERE series_id = ? AND type = 'episode' AND season_number IS NOT NULL AND episode_number IS NOT NULL
       ORDER BY season_number ASC, episode_number ASC`
    )
    .all(seriesId) as { id: string }[]

  const update = db.prepare('UPDATE media_items SET absolute_episode_number = ? WHERE id = ?')
  episodes.forEach((ep, i) => update.run(i + 1, ep.id))
}

export function getSeriesNumberingMode(seriesId: string): SubtitleNumberingMode | null {
  const db = getDb()
  const row = db
    .prepare("SELECT subtitle_numbering FROM media_items WHERE id = ? AND type = 'series'")
    .get(seriesId) as { subtitle_numbering: string | null } | undefined
  return row?.subtitle_numbering === 'season' || row?.subtitle_numbering === 'absolute' ? row.subtitle_numbering : null
}

export function setSeriesNumberingMode(seriesId: string, mode: SubtitleNumberingMode | null): void {
  const db = getDb()
  db.prepare("UPDATE media_items SET subtitle_numbering = ? WHERE id = ? AND type = 'series'").run(mode, seriesId)
}

// The part of the search identity that doesn't change between the season/absolute trial —
// tmdb_id, parent_imdb_id/imdb_id, or a title query, whichever the caller already resolved.
export interface EpisodeSearchBase {
  tmdb_id?: number
  parent_imdb_id?: string
  imdb_id?: string
  query?: string
}

export interface EpisodeSearchInput {
  base: EpisodeSearchBase
  seriesId: string | null
  seasonNumber: number | null
  episodeNumber: number | null
  absoluteEpisodeNumber: number | null
  languages: string
  hearingImpaired: 'include' | 'exclude' | 'only'
}

function withSeasonEp(
  base: EpisodeSearchBase,
  common: { languages: string; type: 'episode'; hearing_impaired: 'include' | 'exclude' | 'only' },
  season: number,
  episode: number
): SubtitleSearchParams {
  return { ...base, ...common, season_number: season, episode_number: episode }
}

export async function searchEpisodeSubtitles(input: EpisodeSearchInput): Promise<OSSubtitle[]> {
  const common = {
    languages: input.languages,
    type: 'episode' as const,
    hearing_impaired: input.hearingImpaired,
  }

  if (input.seasonNumber == null || input.episodeNumber == null) {
    // Nothing parsed to disambiguate — search on identity alone (matches the pre-existing
    // title-only fallback behavior for items with no season/episode at all).
    return searchSubtitles({ ...input.base, ...common })
  }

  const seasonParams = withSeasonEp(input.base, common, input.seasonNumber, input.episodeNumber)
  const absoluteParams =
    input.absoluteEpisodeNumber != null ? withSeasonEp(input.base, common, 1, input.absoluteEpisodeNumber) : null

  const cached = input.seriesId ? getSeriesNumberingMode(input.seriesId) : null
  if (cached === 'season' || !absoluteParams) {
    return searchSubtitles(seasonParams)
  }
  if (cached === 'absolute') {
    return searchSubtitles(absoluteParams)
  }

  // Undetermined. Season 1 can't distinguish the two schemes — absolute numbering equals
  // season numbering there by construction — so only a season>=2 episode is worth the trial
  // (and worth caching a decision from). Season-1-only episodes just search normally.
  const isDistinguishing = input.seasonNumber !== 1 || input.episodeNumber !== input.absoluteEpisodeNumber
  if (!isDistinguishing) {
    return searchSubtitles(seasonParams)
  }

  const seasonResults = await searchSubtitles(seasonParams)
  if (seasonResults.length > 0) {
    if (input.seriesId) setSeriesNumberingMode(input.seriesId, 'season')
    return seasonResults
  }

  const absoluteResults = await searchSubtitles(absoluteParams)
  if (absoluteResults.length > 0 && input.seriesId) {
    setSeriesNumberingMode(input.seriesId, 'absolute')
  }
  return absoluteResults
}
