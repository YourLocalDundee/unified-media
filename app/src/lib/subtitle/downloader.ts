import fs from 'fs/promises'
import path from 'path'
import { getWantedSubtitles, updateSubtitleStatus } from './monitor'
import { searchSubtitles, getDownloadLink, pickBestSubtitle } from './opensubtitles'
import type { SubtitleWant } from './types'

function buildSearchParams(want: SubtitleWant) {
  return {
    imdb_id: want.imdb_id ?? undefined,
    languages: want.language,
    type: (want.jellyfin_item_type === 'Episode' ? 'episode' : 'movie') as 'movie' | 'episode',
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

  try {
    const ext = path.extname(want.media_path)
    const base = want.media_path.slice(0, want.media_path.length - ext.length)
    const outPath = `${base}.${want.language}.srt`

    await fs.writeFile(outPath, content, 'utf-8')
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

    const content = await fetch(downloadResponse.link).then(r => r.text())

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
  const wants = await getWantedSubtitles()

  let downloaded = 0
  let skipped = 0
  let failed = 0

  for (const want of wants) {
    const result = await processOnePending(want)
    if (result === 'downloaded') downloaded++
    else if (result === 'skipped') skipped++
    else failed++

    await new Promise(r => setTimeout(r, 1000))
  }

  return { downloaded, skipped, failed }
}

export { downloadPendingSubtitles, processOnePending, writeSrtFile }
