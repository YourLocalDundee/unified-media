/**
 * CRUD layer for the automation pipeline's two main tables: monitored_items and grab_history.
 *
 * monitored_items — the "want list": what media should be searched for and downloaded.
 * grab_history    — an audit trail of every torrent sent to the download client.
 *
 * All DB access in this file uses the better-sqlite3 singleton from lib/db/index.
 * Calls are synchronous (better-sqlite3 is a blocking API by design).
 *
 * This module is the single write path for item status transitions:
 *   wanted → grabbed (grabber.ts sets this after a successful download client add)
 *   grabbed → imported (availability.ts sets this after finding the item in media_items)
 */

import { getDb } from '@/lib/db/index'
import { computeScopeKey } from './scope-key'
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

// Returns undefined (not null) when the id doesn't exist; caller falls back to a synthetic
// "Any" profile with empty conditions so grabs always proceed even after a profile is deleted.
export function getProfileById(id: number): QualityProfile | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM quality_profiles WHERE id = ?')
    .get(id) as QualityProfile | undefined
}

// ---------------------------------------------------------------------------
// Monitored Items
// ---------------------------------------------------------------------------

// Only items with monitored=1 are eligible for the scheduler's grab loop.
// monitored=0 items are kept in the DB so their history is preserved but are skipped.
export function getWantedItems(): MonitoredItem[] {
  const db = getDb()
  return db
    .prepare(
      "SELECT * FROM monitored_items WHERE status = 'wanted' AND monitored = 1"
    )
    .all() as MonitoredItem[]
}

export function getAllItems(): (MonitoredItem & {
  last_searched_at: number | null
  last_skip_reason: string | null
  last_selected_hash: string | null
})[] {
  const db = getDb()
  return db.prepare(`
    SELECT mi.*,
      gr.searched_at   AS last_searched_at,
      gr.skip_reason   AS last_skip_reason,
      gr.selected_hash AS last_selected_hash
    FROM monitored_items mi
    LEFT JOIN grab_results gr
      ON gr.monitored_item_id = mi.id
      AND gr.searched_at = (
        SELECT MAX(searched_at) FROM grab_results WHERE monitored_item_id = mi.id
      )
    ORDER BY mi.created_at DESC
  `).all() as (MonitoredItem & {
    last_searched_at: number | null
    last_skip_reason: string | null
    last_selected_hash: string | null
  })[]
}

export function getItemById(id: number): MonitoredItem | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM monitored_items WHERE id = ?')
    .get(id) as MonitoredItem | undefined
}

/** All monitored items for a TMDB id (any scope) — used by the season-grab status check. */
export function getItemsByTmdbId(tmdbId: number): MonitoredItem[] {
  return getDb()
    .prepare('SELECT * FROM monitored_items WHERE tmdb_id = ? ORDER BY id')
    .all(tmdbId) as MonitoredItem[]
}

export function createItem(data: {
  type: MediaType
  title: string
  tmdb_id?: number
  tvdb_id?: number
  year?: number
  quality_profile_id?: number
  root_path?: string
  scope_type?: 'full' | 'seasons' | 'episodes' | 'movie' | null
  scope_seasons?: number[] | null
  scope_episodes?: Array<{ s: number; e: number }> | null
  // Human arc/saga label (e.g. "Impel Down") for episode-group grabs; null for plain scopes.
  scope_label?: string | null
  monitor_future?: boolean
  // ISO 639-1 code or 'any' (default). Honored by the grab cron via grabItem.
  language?: string
}): MonitoredItem {
  const db = getDb()
  const now = Date.now()

  const scopeType = data.scope_type ?? (data.type === 'movie' ? 'movie' : 'full')
  const scopeSeasons = data.scope_seasons ?? null
  const scopeEpisodes = data.scope_episodes ?? null
  const scopeKey = computeScopeKey(data.type, scopeType, scopeSeasons, scopeEpisodes)

  const params = {
    type: data.type,
    title: data.title,
    tmdb_id: data.tmdb_id ?? null,
    tvdb_id: data.tvdb_id ?? null,
    year: data.year ?? null,
    // profile id=1 is the default "Any" profile seeded at DB init
    quality_profile_id: data.quality_profile_id ?? 1,
    root_path: data.root_path ?? '',
    scope_type: scopeType,
    scope_seasons: scopeSeasons != null ? JSON.stringify(scopeSeasons) : null,
    scope_episodes: scopeEpisodes != null ? JSON.stringify(scopeEpisodes) : null,
    scope_label: data.scope_label ?? null,
    scope_key: scopeKey,
    monitor_future: data.monitor_future ? 1 : 0,
    language: data.language ?? 'any',
    created_at: now,
    updated_at: now,
  }

  // A6-02: fetch-or-create. The UNIQUE(tmdb_id,type,scope_key) index turns a duplicate insert into
  // a no-op (ON CONFLICT DO NOTHING); we then return the pre-existing row so every caller resolves
  // to the same monitored item. Previously a plain INSERT spawned duplicate rows and the dead
  // "already exists" try/catch guards at the call sites never fired (the string was never thrown),
  // so status transitions and grab-results split across arbitrary rows.
  // New items always start monitored=1, status='wanted' so the next scheduler tick picks them up.
  const result = db
    .prepare(
      `INSERT INTO monitored_items
        (type, title, tmdb_id, tvdb_id, year, quality_profile_id, root_path,
         monitored, status, scope_type, scope_seasons, scope_episodes, scope_label, scope_key, monitor_future,
         language, created_at, updated_at)
       VALUES
        (@type, @title, @tmdb_id, @tvdb_id, @year, @quality_profile_id, @root_path,
         1, 'wanted', @scope_type, @scope_seasons, @scope_episodes, @scope_label, @scope_key, @monitor_future,
         @language, @created_at, @updated_at)
       ON CONFLICT(tmdb_id, type, scope_key) DO NOTHING`
    )
    .run(params)

  if (result.changes === 0) {
    // Conflict: a row with this (tmdb_id, type, scope_key) already exists — return it unchanged.
    const existing = db
      .prepare('SELECT * FROM monitored_items WHERE tmdb_id = ? AND type = ? AND scope_key = ?')
      .get(params.tmdb_id, params.type, params.scope_key) as MonitoredItem | undefined
    if (existing) return existing
  }

  return getItemById(result.lastInsertRowid as number)!
}

// Explicit allowlist prevents injection through dynamic key names.
// The SET clause is built by interpolating key names, so an unfiltered caller-supplied
// key would be a SQL injection vector.
const ITEM_ALLOWED_FIELDS = new Set<string>([
  'title',
  'tmdb_id',
  'tvdb_id',
  'year',
  'quality_profile_id',
  'root_path',
  'monitored',
  'status',
  'scope_type',
  'scope_seasons',
  'scope_episodes',
  'monitor_future',
  'language',
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

  // No-op guard: a bare "UPDATE ... SET WHERE id=?" with no SET clause is a SQL syntax error
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

// Recover a BitTorrent infohash from a magnet link's `xt=urn:btih:` parameter. Matches both the
// 40-char hex (v1) and 32-char base32 forms. magnet/URL adds frequently don't surface the hash any
// other way, and a hashless grab row strands the importer on its slower by-title fallback because it
// can't query qBittorrent by hash (see importer.ts).
const BTIH_RE = /urn:btih:([0-9a-fA-F]{40}|[2-7A-Z]{32})/i

/**
 * Resolve the infohash to persist: prefer an explicit non-empty value, otherwise recover it from a
 * magnet in any of the provided URL sources. Returns '' only when no hash is available anywhere
 * (e.g. a .torrent download-URL whose hash qBittorrent only computes after the add) — those rows are
 * handled by the importer's by-title fallback rather than a hash lookup.
 */
function resolveInfoHash(
  infoHash: string | undefined | null,
  sources: Array<string | undefined | null>,
): string {
  const explicit = (infoHash ?? '').trim()
  if (explicit) return explicit.toLowerCase()
  for (const s of sources) {
    const m = s?.match(BTIH_RE)
    if (m) return m[1].toLowerCase()
  }
  return ''
}

// import_status starts as 'pending'; availability.ts promotes it to 'imported'
// once the media_items table confirms the file made it into the native library.
export function recordGrab(data: {
  item_id: number
  indexer: string
  release_title: string
  info_hash: string
  // Optional magnet/URL sources. When info_hash is empty (magnet/URL adds often don't surface it),
  // the hash is recovered from a magnet's urn:btih here so we never persist a hashless grab row.
  urls?: Array<string | undefined | null>
}): GrabHistory {
  const db = getDb()
  const now = Date.now()
  const info_hash = resolveInfoHash(data.info_hash, data.urls ?? [])

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
      info_hash,
      grabbed_at: now,
    })

  return db
    .prepare('SELECT * FROM grab_history WHERE id = ?')
    .get(result.lastInsertRowid as number) as GrabHistory
}

// Per-item history is unbounded (admin detail view); global history caps at 100 rows
// to keep the admin queue page snappy without requiring pagination.
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
