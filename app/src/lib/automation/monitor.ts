import { getDb } from '@/lib/db/index'
import type {
  GrabHistory,
  ImportStatus,
  ItemStatus,
  MediaType,
  MonitoredItem,
  QualityProfile,
} from './types'

// ---------------------------------------------------------------------------
// Quality Profiles
// ---------------------------------------------------------------------------

export function getAllProfiles(): QualityProfile[] {
  const db = getDb()
  return db.prepare('SELECT * FROM quality_profiles').all() as QualityProfile[]
}

export function getProfileById(id: number): QualityProfile | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM quality_profiles WHERE id = ?')
    .get(id) as QualityProfile | undefined
}

// ---------------------------------------------------------------------------
// Monitored Items
// ---------------------------------------------------------------------------

export function getWantedItems(): MonitoredItem[] {
  const db = getDb()
  return db
    .prepare(
      "SELECT * FROM monitored_items WHERE status = 'wanted' AND monitored = 1"
    )
    .all() as MonitoredItem[]
}

export function getAllItems(): MonitoredItem[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM monitored_items ORDER BY created_at DESC')
    .all() as MonitoredItem[]
}

export function getItemById(id: number): MonitoredItem | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM monitored_items WHERE id = ?')
    .get(id) as MonitoredItem | undefined
}

export function createItem(data: {
  type: MediaType
  title: string
  tmdb_id?: number
  tvdb_id?: number
  year?: number
  quality_profile_id?: number
  root_path?: string
}): MonitoredItem {
  const db = getDb()
  const now = Date.now()

  const result = db
    .prepare(
      `INSERT INTO monitored_items
        (type, title, tmdb_id, tvdb_id, year, quality_profile_id, root_path,
         monitored, status, created_at, updated_at)
       VALUES
        (@type, @title, @tmdb_id, @tvdb_id, @year, @quality_profile_id, @root_path,
         1, 'wanted', @created_at, @updated_at)`
    )
    .run({
      type: data.type,
      title: data.title,
      tmdb_id: data.tmdb_id ?? null,
      tvdb_id: data.tvdb_id ?? null,
      year: data.year ?? null,
      quality_profile_id: data.quality_profile_id ?? 1,
      root_path: data.root_path ?? '',
      created_at: now,
      updated_at: now,
    })

  return getItemById(result.lastInsertRowid as number)!
}

// Explicit allowlist prevents injection through dynamic key names
const ITEM_ALLOWED_FIELDS = new Set<string>([
  'title',
  'tmdb_id',
  'tvdb_id',
  'year',
  'quality_profile_id',
  'root_path',
  'monitored',
  'status',
])

export function updateItem(
  id: number,
  data: Partial<{
    title: string
    tmdb_id: number | null
    tvdb_id: number | null
    year: number | null
    quality_profile_id: number
    root_path: string
    monitored: number
    status: ItemStatus
  }>
): MonitoredItem | undefined {
  const db = getDb()

  const safeEntries = Object.entries(data).filter(([key]) =>
    ITEM_ALLOWED_FIELDS.has(key)
  )

  if (safeEntries.length === 0) {
    return getItemById(id)
  }

  const setClauses = safeEntries
    .map(([key]) => `${key} = @${key}`)
    .join(', ')

  const params: Record<string, unknown> = { id, updated_at: Date.now() }
  for (const [key, value] of safeEntries) {
    params[key] = value
  }

  db.prepare(
    `UPDATE monitored_items SET ${setClauses}, updated_at = @updated_at WHERE id = @id`
  ).run(params)

  return getItemById(id)
}

export function deleteItem(id: number): boolean {
  const db = getDb()
  const result = db
    .prepare('DELETE FROM monitored_items WHERE id = ?')
    .run(id)
  return result.changes > 0
}

// ---------------------------------------------------------------------------
// Grab History
// ---------------------------------------------------------------------------

export function recordGrab(data: {
  item_id: number
  indexer: string
  release_title: string
  info_hash: string
}): GrabHistory {
  const db = getDb()
  const now = Date.now()

  const result = db
    .prepare(
      `INSERT INTO grab_history
        (item_id, indexer, release_title, info_hash, grabbed_at, import_status)
       VALUES
        (@item_id, @indexer, @release_title, @info_hash, @grabbed_at, 'pending')`
    )
    .run({
      item_id: data.item_id,
      indexer: data.indexer,
      release_title: data.release_title,
      info_hash: data.info_hash,
      grabbed_at: now,
    })

  return db
    .prepare('SELECT * FROM grab_history WHERE id = ?')
    .get(result.lastInsertRowid as number) as GrabHistory
}

export function getGrabHistory(itemId?: number): GrabHistory[] {
  const db = getDb()

  if (itemId !== undefined) {
    return db
      .prepare(
        'SELECT * FROM grab_history WHERE item_id = ? ORDER BY grabbed_at DESC'
      )
      .all(itemId) as GrabHistory[]
  }

  return db
    .prepare('SELECT * FROM grab_history ORDER BY grabbed_at DESC LIMIT 100')
    .all() as GrabHistory[]
}

export function updateImportStatus(id: number, status: ImportStatus): void {
  const db = getDb()
  db.prepare('UPDATE grab_history SET import_status = ? WHERE id = ?').run(
    status,
    id
  )
}
