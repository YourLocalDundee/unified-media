// Library scanner for the subtitle system (Independence Build Phase 4).
// Walks all movie and episode rows in unified.db that have a file_path and
// creates a 'wanted' subtitle row for each missing language combination.
// Intended to run nightly via the scheduler; calling it more often is safe
// because upsertSubtitleWant uses INSERT OR IGNORE.
import { getDb } from '@/lib/db/index'
import { upsertSubtitleWant, pruneOrphanedWants } from './monitor'
import { computeAbsoluteEpisodeNumbers } from './numbering'
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
       WHERE media_item_id = ? AND language = ? AND status != 'failed'`
    )
    .get(mediaId, language) as SubtitleWantRow | undefined
  return row !== undefined
}

export async function scanLibrary(): Promise<{ scanned: number; created: number; pruned: number }> {
  const db = getDb()
  const languages = getTargetLanguages()

  // Drop wants left behind by media_items rows that no longer exist (renamed/reorganized
  // files get a fresh row+id on rescan rather than updating in place).
  const pruned = pruneOrphanedWants()

  // Keep absolute_episode_number current for every series — cheap (one ORDER BY per series)
  // and needs to run before the download pass can use it for the numbering-scheme fallback.
  const seriesIds = db.prepare("SELECT id FROM media_items WHERE type = 'series'").all() as { id: string }[]
  for (const { id } of seriesIds) {
    computeAbsoluteEpisodeNumbers(id)
  }

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

      // OpenSubtitles requires the numeric IMDB ID without the "tt" prefix.
      const rawImdb = item.imdb_id
      const imdb_id = rawImdb ? rawImdb.replace(/^tt/i, '') : undefined

      const existing = upsertSubtitleWant({
        media_item_id: item.id,
        media_item_type: item.type === 'movie' ? 'Movie' : 'Episode',
        title,
        imdb_id,
        media_path: item.file_path ?? undefined,
        language,
      })

      // INSERT OR IGNORE sets both created_at and updated_at to the same value;
      // an existing row will have different timestamps if it was ever updated.
      if (existing.created_at === existing.updated_at) {
        created++
      }
    }

    scanned++
  }

  return { scanned, created, pruned }
}
