import { getDb } from '@/lib/db/index'
import { upsertSubtitleWant } from './monitor'
import type { MediaItem } from '@/lib/media-server/types'

interface SubtitleWantRow {
  id: number
}

function pad(n: number | null | undefined): string {
  return String(n ?? 0).padStart(2, '0')
}

export function getTargetLanguages(): string[] {
  return (process.env.SUBTITLE_LANGUAGES ?? 'en')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function hasExistingSubtitle(mediaId: string, language: string): boolean {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT id FROM subtitle_wants
       WHERE jellyfin_item_id = ? AND language = ? AND status != 'failed'`
    )
    .get(mediaId, language) as SubtitleWantRow | undefined
  return row !== undefined
}

export async function scanLibrary(): Promise<{ scanned: number; created: number }> {
  const db = getDb()
  const languages = getTargetLanguages()

  const items = db
    .prepare(
      `SELECT * FROM media_items WHERE type IN ('movie', 'episode') AND file_path IS NOT NULL`
    )
    .all() as MediaItem[]

  let scanned = 0
  let created = 0

  for (const item of items) {
    for (const language of languages) {
      if (hasExistingSubtitle(item.id, language)) {
        continue
      }

      let title: string
      if (item.type === 'episode') {
        let seriesTitle = 'Unknown Series'
        if (item.series_id) {
          const series = db
            .prepare('SELECT title FROM media_items WHERE id = ?')
            .get(item.series_id) as { title: string } | undefined
          if (series) seriesTitle = series.title
        }
        title = `${seriesTitle} S${pad(item.season_number)}E${pad(item.episode_number)} - ${item.title}`
      } else {
        title = `${item.title} (${item.year ?? '?'})`
      }

      const rawImdb = item.imdb_id
      const imdb_id = rawImdb ? rawImdb.replace(/^tt/i, '') : undefined

      const existing = upsertSubtitleWant({
        jellyfin_item_id: item.id,
        jellyfin_item_type: item.type === 'movie' ? 'Movie' : 'Episode',
        title,
        imdb_id,
        media_path: item.file_path ?? undefined,
        language,
      })

      if (existing.created_at === existing.updated_at) {
        created++
      }
    }

    scanned++
  }

  return { scanned, created }
}
