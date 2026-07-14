import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/media-server/library'
import { searchSubtitles } from '@/lib/subtitle/opensubtitles'
import { searchEpisodeSubtitles, type EpisodeSearchBase } from '@/lib/subtitle/numbering'
import type { OSSubtitle } from '@/lib/subtitle/types'

export const dynamic = 'force-dynamic'

// Candidate shape sent to the player. Trimmed from the OpenSubtitles response so
// the browser never sees uploader internals it can't use.
export interface SubtitleCandidate {
  fileId: number
  language: string
  release: string
  fileName: string
  hi: boolean
  fromTrusted: boolean
  downloadCount: number
  format: string
  uploader: string
}

// On-demand OpenSubtitles search for the item currently open in the player.
// The IMDB id is resolved server-side from the media id so it never has to travel
// to (or be trusted from) the browser. Any authenticated viewer can search —
// search does not consume the OpenSubtitles daily *download* quota; only the grab
// route does.
export async function GET(req: NextRequest) {
  await requireAuth()

  const mediaId = req.nextUrl.searchParams.get('mediaId')
  const language = (req.nextUrl.searchParams.get('language') || 'en').trim()
  const hi = req.nextUrl.searchParams.get('hi') === '1'

  if (!mediaId) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 })
  }

  if (!process.env.OPENSUBTITLES_API_KEY) {
    return NextResponse.json(
      { error: 'Subtitle search is not configured (OPENSUBTITLES_API_KEY unset).' },
      { status: 503 }
    )
  }

  const item = getItemById(mediaId)
  if (!item) {
    return NextResponse.json({ error: 'Media item not found' }, { status: 404 })
  }

  const strip = (id: string) => id.replace(/^tt/i, '')

  // For an episode, the best OpenSubtitles match comes from the SERIES imdb id plus the
  // season/episode numbers — a per-episode imdb_id is usually missing and, even when present,
  // gives weaker results than parent + S/E. Resolve the parent series row for those fields.
  // searchEpisodeSubtitles additionally handles shows whose "seasons" don't match
  // OpenSubtitles' own catalog (arc-based vs. absolute episode numbering) — see numbering.ts.
  let results: OSSubtitle[]
  let hasImdb: boolean
  if (item.type === 'episode') {
    const series = item.series_id ? getItemById(item.series_id) : undefined
    const parentImdb = series?.imdb_id ? strip(series.imdb_id) : undefined
    const ownImdb = item.imdb_id ? strip(item.imdb_id) : undefined
    const base: EpisodeSearchBase = parentImdb
      ? { parent_imdb_id: parentImdb }
      : ownImdb
        ? { imdb_id: ownImdb }
        : { query: series?.title ?? item.title }

    hasImdb = !!(parentImdb || ownImdb)
    results = await searchEpisodeSubtitles({
      base,
      seriesId: item.series_id,
      seasonNumber: item.season_number,
      episodeNumber: item.episode_number,
      absoluteEpisodeNumber: item.absolute_episode_number,
      languages: language,
      hearingImpaired: hi ? 'only' : 'include',
    })
  } else {
    const imdb_id = item.imdb_id ? strip(item.imdb_id) : undefined
    hasImdb = !!imdb_id
    results = await searchSubtitles({
      imdb_id,
      query: imdb_id ? undefined : item.title,
      languages: language,
      type: 'movie',
      hearing_impaired: hi ? 'only' : 'include',
    })
  }

  const candidates: SubtitleCandidate[] = results
    .map((sub) => {
      const file = sub.attributes.files[0]
      if (!file) return null
      const attrs = sub.attributes
      return {
        fileId: file.file_id,
        language: attrs.language,
        release: attrs.release || file.file_name || 'Unknown release',
        fileName: file.file_name || '',
        hi: !!attrs.hearing_impaired,
        fromTrusted: !!attrs.from_trusted,
        downloadCount: attrs.download_count ?? 0,
        format: attrs.format ?? 'srt',
        uploader: attrs.uploader?.name ?? '',
      }
    })
    .filter((c): c is SubtitleCandidate => c !== null)

  return NextResponse.json({ candidates, hasImdb })
}
