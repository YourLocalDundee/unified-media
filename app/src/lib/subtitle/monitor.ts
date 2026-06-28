// SQLite CRUD layer for the `subtitle_wants` table in unified.db.
// This module is the source of truth for what subtitles have been requested,
// their current status, and where downloaded .srt files are on disk.
// upsertSubtitleWant uses INSERT OR IGNORE so duplicate wants (same item +
// language + forced + hi) are silently skipped on repeated scans.
import { getDb } from '@/lib/db/index'
import type { SubtitleStatus, SubtitleWant } from './types'

// ISO 639 language tags are 2 or 3 lowercase letters. Anything else is rejected so a
// crafted `language` value can never escape the media directory when it is used to build
// a subtitle filename on disk (path-traversal-on-write guard — audit A-2). Returns the
// normalized tag, or null when the input is not a valid language code.
export function normalizeSubtitleLang(raw: string | null | undefined): string | null {
  const v = (raw ?? '').toLowerCase().trim()
  return /^[a-z]{2,3}$/.test(v) ? v : null
}

export function getWantedSubtitles(): SubtitleWant[] {
  const db = getDb()
  return db
    .prepare(
      "SELECT * FROM subtitle_wants WHERE status = 'wanted' ORDER BY created_at ASC"
    )
    .all() as SubtitleWant[]
}

export function getAllSubtitles(filter?: SubtitleStatus): SubtitleWant[] {
  const db = getDb()
  if (filter === undefined) {
    return db
      .prepare('SELECT * FROM subtitle_wants ORDER BY created_at DESC LIMIT 200')
      .all() as SubtitleWant[]
  }
  return db
    .prepare(
      'SELECT * FROM subtitle_wants WHERE status = ? ORDER BY created_at DESC LIMIT 200'
    )
    .all(filter) as SubtitleWant[]
}

export function getSubtitleById(id: number): SubtitleWant | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM subtitle_wants WHERE id = ?')
    .get(id) as SubtitleWant | undefined
}

export function upsertSubtitleWant(data: {
  media_item_id: string
  media_item_type: string
  title: string
  imdb_id?: string
  media_path?: string
  language: string
  forced?: number
  hi?: number
}): SubtitleWant {
  const db = getDb()
  const now = Date.now()

  db.prepare(
    `INSERT OR IGNORE INTO subtitle_wants
      (media_item_id, media_item_type, title, imdb_id, media_path,
       language, forced, hi, status, created_at, updated_at)
     VALUES
      (@media_item_id, @media_item_type, @title, @imdb_id, @media_path,
       @language, @forced, @hi, 'wanted', @created_at, @updated_at)`
  ).run({
    media_item_id: data.media_item_id,
    media_item_type: data.media_item_type,
    title: data.title,
    imdb_id: data.imdb_id ?? null,
    media_path: data.media_path ?? null,
    language: data.language,
    forced: data.forced ?? 0,
    hi: data.hi ?? 0,
    created_at: now,
    updated_at: now,
  })

  return db
    .prepare(
      `SELECT * FROM subtitle_wants
       WHERE media_item_id = ? AND language = ? AND forced = ? AND hi = ?`
    )
    .get(
      data.media_item_id,
      data.language,
      data.forced ?? 0,
      data.hi ?? 0
    ) as SubtitleWant
}

export function updateSubtitleStatus(
  id: number,
  status: SubtitleStatus,
  extras?: { subtitle_file_id?: number; subtitle_path?: string }
): void {
  const db = getDb()
  const now = Date.now()

  if (extras?.subtitle_file_id !== undefined || extras?.subtitle_path !== undefined) {
    db.prepare(
      `UPDATE subtitle_wants
       SET status = @status, updated_at = @updated_at,
           subtitle_file_id = @subtitle_file_id, subtitle_path = @subtitle_path
       WHERE id = @id`
    ).run({
      id,
      status,
      updated_at: now,
      subtitle_file_id: extras?.subtitle_file_id ?? null,
      subtitle_path: extras?.subtitle_path ?? null,
    })
  } else {
    db.prepare(
      'UPDATE subtitle_wants SET status = @status, updated_at = @updated_at WHERE id = @id'
    ).run({ id, status, updated_at: now })
  }
}

export function markSkipped(media_item_id: string, language: string): void {
  const db = getDb()
  db.prepare(
    `UPDATE subtitle_wants
     SET status = 'skipped', updated_at = ?
     WHERE media_item_id = ? AND language = ?`
  ).run(Date.now(), media_item_id, language)
}

export function deleteSubtitleWant(id: number): boolean {
  const db = getDb()
  const result = db
    .prepare('DELETE FROM subtitle_wants WHERE id = ?')
    .run(id)
  return result.changes > 0
}
