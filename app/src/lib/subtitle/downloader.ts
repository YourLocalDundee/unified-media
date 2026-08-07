// Subtitle downloader for the native subtitle system (Independence Build Phase 4).
// Processes all 'wanted' rows from the subtitle_wants table one at a time,
// with a 1-second delay between downloads to respect OpenSubtitles rate limits.
// The daily download quota is plan-dependent (5/day free, 1000/day VIP) — skipping
// (no results found) does not consume a quota slot, but a successful getDownloadLink
// call does.
import fsSync from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { getDb } from '@/lib/db/index'
import { getWantedSubtitles, updateSubtitleStatus, normalizeSubtitleLang } from './monitor'
import { searchSubtitles, getDownloadLink, getUserInfo, pickBestSubtitle } from './opensubtitles'
import { searchEpisodeSubtitles } from './numbering'
import type { OSSubtitle, SubtitleWant } from './types'

interface MediaMetaRow {
  title: string
  tmdb_id: number | null
  season_number: number | null
  episode_number: number | null
  series_id: string | null
  absolute_episode_number: number | null
}

interface SeriesMetaRow {
  title: string
  tmdb_id: number | null
}

// `subtitle_wants` doesn't carry tmdb_id/season/episode itself, so this joins back to
// media_items at download time. Kept separate from the scanner so a later TMDB match
// (or a corrected filename parse) is picked up automatically on the next retry — no
// need to re-scan or migrate subtitle_wants.
function lookupMediaMeta(mediaItemId: string): MediaMetaRow | undefined {
  const db = getDb()
  return db
    .prepare(
      'SELECT title, tmdb_id, season_number, episode_number, series_id, absolute_episode_number FROM media_items WHERE id = ?'
    )
    .get(mediaItemId) as MediaMetaRow | undefined
}

function lookupSeriesMeta(seriesId: string): SeriesMetaRow | undefined {
  const db = getDb()
  return db
    .prepare('SELECT title, tmdb_id FROM media_items WHERE id = ?')
    .get(seriesId) as SeriesMetaRow | undefined
}

// Was: only ever sent `imdb_id`, which is null on every item in this library (the TMDB
// enricher never populates it) — every search came back HTTP 400 (no identifying params),
// swallowed by searchSubtitles()'s catch as "no results", so every want landed on 'skipped'.
// Priority per type mirrors what OpenSubtitles' own search actually resolves against
// (verified against the live API): imdb_id > tmdb_id (+ season/episode for episodes) >
// title query fallback for items with no metadata match at all. Episode season/episode
// numbers are additionally run through searchEpisodeSubtitles() (numbering.ts), which
// handles shows whose "seasons" don't match OpenSubtitles' own catalog.
async function searchForWant(want: SubtitleWant): Promise<OSSubtitle[]> {
  const hearing_impaired = (want.hi === 1 ? 'only' : 'include') as 'only' | 'include'
  const meta = lookupMediaMeta(want.media_item_id)

  if (want.media_item_type === 'Episode') {
    const series = meta?.series_id ? lookupSeriesMeta(meta.series_id) : undefined
    const base = want.imdb_id
      ? { parent_imdb_id: want.imdb_id }
      : series?.tmdb_id != null
        ? { tmdb_id: series.tmdb_id }
        : { query: series?.title ?? want.title }

    return searchEpisodeSubtitles({
      base,
      seriesId: meta?.series_id ?? null,
      seasonNumber: meta?.season_number ?? null,
      episodeNumber: meta?.episode_number ?? null,
      absoluteEpisodeNumber: meta?.absolute_episode_number ?? null,
      languages: want.language,
      hearingImpaired: hearing_impaired,
    })
  }

  // Movie
  const base = {
    languages: want.language,
    type: 'movie' as const,
    hearing_impaired,
  }
  if (want.imdb_id) {
    return searchSubtitles({ ...base, imdb_id: want.imdb_id })
  }
  if (meta?.tmdb_id != null) {
    return searchSubtitles({ ...base, tmdb_id: meta.tmdb_id })
  }
  return searchSubtitles({ ...base, query: meta?.title ?? want.title })
}

async function writeSrtFile(want: SubtitleWant, content: string): Promise<string | null> {
  const mediaRoot = process.env.SUBTITLE_MEDIA_ROOT
  if (!mediaRoot) {
    console.warn('[subtitle] SUBTITLE_MEDIA_ROOT is not set — subtitle will not be written to disk')
    return null
  }

  if (!want.media_path) {
    return null
  }

  // Reject obvious non-SRT content (A15-M4): valid SRT files begin with a numeric counter line.
  const trimmed = content.trimStart()
  if (!trimmed || !/^\d/.test(trimmed)) {
    console.error('[subtitle] Downloaded content does not look like an SRT file — discarding')
    return null
  }

  // Defensive guard: the language is used as a filename segment, so reject anything that
  // is not a clean ISO 639 tag rather than letting `../` escape the media directory.
  // Want rows are validated on insert, but this also covers any legacy/unsanitized row.
  const safeLang = normalizeSubtitleLang(want.language)
  if (!safeLang) {
    console.error(`[subtitle] Refusing to write subtitle with invalid language tag: ${JSON.stringify(want.language)}`)
    return null
  }

  try {
    const ext = path.extname(want.media_path)
    const base = want.media_path.slice(0, want.media_path.length - ext.length)
    const outPath = `${base}.${safeLang}.srt`
    // Atomic write: write to a temp file then rename so a crash mid-write
    // cannot corrupt an existing subtitle file (A15-M4).
    const tmpPath = `${outPath}.${process.pid}.tmp`
    await fs.writeFile(tmpPath, content, 'utf-8')
    await fs.rename(tmpPath, outPath)
    return outPath
  } catch (err) {
    console.error('[subtitle] Failed to write srt file:', err)
    return null
  }
}

interface ProcessResult {
  status: 'downloaded' | 'skipped' | 'failed'
  remaining?: number
}

async function processOnePending(want: SubtitleWant): Promise<ProcessResult> {
  try {
    // Cheap pre-flight, no quota cost: media_items rows aren't stable across a
    // rename/reorganize (a moved file gets a fresh row+id on rescan), which orphans the
    // subtitle_wants row's cached media_path. The scanner prunes these on its nightly
    // pass, but this guard catches anything that slips through between scans — without
    // it, search can still "succeed" via the title-query fallback and spend a real
    // download against content that can never be written to disk.
    if (want.media_path && !fsSync.existsSync(want.media_path)) {
      console.warn(`[subtitle] media_path no longer exists, skipping without spending quota: ${want.media_path}`)
      await updateSubtitleStatus(want.id, 'skipped')
      return { status: 'skipped' }
    }

    const results = await searchForWant(want)
    if (!results || results.length === 0) {
      await updateSubtitleStatus(want.id, 'skipped')
      return { status: 'skipped' }
    }

    const best = pickBestSubtitle(results, want.hi === 1)
    if (!best) {
      await updateSubtitleStatus(want.id, 'skipped')
      return { status: 'skipped' }
    }

    const file = best.attributes.files[0]

    let downloadResponse
    try {
      downloadResponse = await getDownloadLink(file.file_id)
      if (!downloadResponse?.link) {
        await updateSubtitleStatus(want.id, 'failed')
        return { status: 'failed' }
      }
    } catch {
      await updateSubtitleStatus(want.id, 'failed')
      return { status: 'failed' }
    }

    const dlRes = await fetch(downloadResponse.link)
    if (!dlRes.ok) {
      console.error(`[subtitle] Download link returned HTTP ${dlRes.status}`)
      await updateSubtitleStatus(want.id, 'failed')
      return { status: 'failed' }
    }
    const content = await dlRes.text()

    const outPath = await writeSrtFile(want, content)

    await updateSubtitleStatus(want.id, 'downloaded', {
      subtitle_file_id: file.file_id,
      subtitle_path: outPath ?? undefined,
    })

    return { status: 'downloaded', remaining: downloadResponse.remaining }
  } catch (err) {
    console.error('[subtitle] processOnePending error:', err)
    await updateSubtitleStatus(want.id, 'failed')
    return { status: 'failed' }
  }
}

async function downloadPendingSubtitles(): Promise<{
  downloaded: number
  skipped: number
  failed: number
  quotaExhausted: boolean
}> {
  if (!process.env.OPENSUBTITLES_API_KEY) {
    console.warn('[subtitle] OPENSUBTITLES_API_KEY not set — subtitle downloads skipped')
    return { downloaded: 0, skipped: 0, failed: 0, quotaExhausted: false }
  }

  // Check the live quota up front so a backfill that can't possibly finish today stops
  // before spending anything, rather than discovering the ceiling mid-run via a failed
  // getDownloadLink() call (which would otherwise mark that row 'failed' — and 'failed'
  // rows never get recreated by the scanner's INSERT OR IGNORE, so they'd be stuck).
  const userInfo = await getUserInfo()
  let remaining = userInfo?.remaining_downloads ?? Infinity

  const wants = await getWantedSubtitles()

  let downloaded = 0
  let skipped = 0
  let failed = 0
  let quotaExhausted = false

  for (const want of wants) {
    if (remaining <= 0) {
      quotaExhausted = true
      break
    }

    const result = await processOnePending(want)
    if (result.status === 'downloaded') {
      downloaded++
      if (result.remaining != null) remaining = result.remaining
    } else if (result.status === 'skipped') {
      skipped++
    } else {
      failed++
    }

    // 1-second pause between downloads to avoid hammering OpenSubtitles and
    // to stay well within the free tier's burst rate limit.
    await new Promise(r => setTimeout(r, 1000))
  }

  if (quotaExhausted) {
    console.warn('[subtitle] Daily download quota exhausted — remaining wants left as \'wanted\' for tomorrow')
  }

  return { downloaded, skipped, failed, quotaExhausted }
}

export { downloadPendingSubtitles, processOnePending, writeSrtFile }
