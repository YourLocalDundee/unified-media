// Subtitle downloader for the native subtitle system (Independence Build Phase 4).
// Processes all 'wanted' rows from the subtitle_wants table one at a time,
// with a 1-second delay between downloads to respect OpenSubtitles rate limits.
// The daily download quota is plan-dependent (5/day free, 1000/day VIP) — skipping
// (no results found) does not consume a quota slot, but a successful getDownloadLink
// call does.
import fs from 'fs/promises'
import path from 'path'
import { getWantedSubtitles, updateSubtitleStatus, normalizeSubtitleLang } from './monitor'
import { searchSubtitles, getDownloadLink, pickBestSubtitle } from './opensubtitles'
import type { SubtitleWant } from './types'

function buildSearchParams(want: SubtitleWant) {
  return {
    imdb_id: want.imdb_id ?? undefined,
    languages: want.language,
    type: (want.media_item_type === 'Episode' ? 'episode' : 'movie') as 'movie' | 'episode',
    hearing_impaired: (want.hi === 1 ? 'only' : 'include') as 'only' | 'include',
  }
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

async function processOnePending(want: SubtitleWant): Promise<'downloaded' | 'skipped' | 'failed'> {
  try {
    const results = await searchSubtitles(buildSearchParams(want))
    if (!results || results.length === 0) {
      await updateSubtitleStatus(want.id, 'skipped')
      return 'skipped'
    }

    const best = pickBestSubtitle(results, want.hi === 1)
    if (!best) {
      await updateSubtitleStatus(want.id, 'skipped')
      return 'skipped'
    }

    const file = best.attributes.files[0]

    let downloadResponse
    try {
      downloadResponse = await getDownloadLink(file.file_id)
      if (!downloadResponse?.link) {
        await updateSubtitleStatus(want.id, 'failed')
        return 'failed'
      }
    } catch {
      await updateSubtitleStatus(want.id, 'failed')
      return 'failed'
    }

    const dlRes = await fetch(downloadResponse.link)
    if (!dlRes.ok) {
      console.error(`[subtitle] Download link returned HTTP ${dlRes.status}`)
      await updateSubtitleStatus(want.id, 'failed')
      return 'failed'
    }
    const content = await dlRes.text()

    const outPath = await writeSrtFile(want, content)

    await updateSubtitleStatus(want.id, 'downloaded', {
      subtitle_file_id: file.file_id,
      subtitle_path: outPath ?? undefined,
    })

    return 'downloaded'
  } catch (err) {
    console.error('[subtitle] processOnePending error:', err)
    await updateSubtitleStatus(want.id, 'failed')
    return 'failed'
  }
}

async function downloadPendingSubtitles(): Promise<{ downloaded: number; skipped: number; failed: number }> {
  if (!process.env.OPENSUBTITLES_API_KEY) {
    console.warn('[subtitle] OPENSUBTITLES_API_KEY not set — subtitle downloads skipped')
    return { downloaded: 0, skipped: 0, failed: 0 }
  }

  const wants = await getWantedSubtitles()

  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const want of wants) {
    const result = await processOnePending(want)
    if (result === 'downloaded') downloaded++
    else if (result === 'skipped') skipped++
    else failed++

    // 1-second pause between downloads to avoid hammering OpenSubtitles and
    // to stay well within the free tier's burst rate limit.
    await new Promise(r => setTimeout(r, 1000))
  }

  return { downloaded, skipped, failed }
}

export { downloadPendingSubtitles, processOnePending, writeSrtFile }
