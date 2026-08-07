/**
 * Monitored collections — watch a TMDB collection (franchise) as a unit.
 *
 * Every film in the collection is auto-added to monitored_items (via createItem). A per-collection
 * ledger (collection_items, UNIQUE(collection_id, tmdb_id)) prevents duplicate adds on re-sync:
 * once a film is in the ledger it will never be re-added, even if later removed from the library.
 *
 * Sync runs every 24h from scheduler.ts and can be triggered manually per-collection from the admin
 * API (/api/admin/collections/[id]/sync). New collection entries discovered on a future re-sync
 * (e.g. a sequel released after the collection was first added) are auto-added too.
 *
 * AUTO-DELETE SAFETY: every add goes through createItem → status='wanted', long-term monitored path.
 * The 48h auto-delete timer never applies (that's for quick requests only).
 */

import { getDb } from '@/lib/db/index'
import { createItem } from './monitor'
import { getCollection } from '@/lib/media-server/tmdb'

// ── Types ────────────────────────────────────────────────────────────────────

export interface MonitoredCollection {
  id: number
  tmdb_collection_id: number
  name: string
  quality_profile_id: number
  enabled: number
  last_sync_at: number | null
  last_error: string | null
  added_count: number
  created_at: number
}

export interface CollectionSyncResult {
  added: number
  error?: string
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function getAllCollections(): MonitoredCollection[] {
  return getDb().prepare('SELECT * FROM monitored_collections ORDER BY name').all() as MonitoredCollection[]
}

export function getCollectionById(id: number): MonitoredCollection | undefined {
  return getDb()
    .prepare('SELECT * FROM monitored_collections WHERE id = ?')
    .get(id) as MonitoredCollection | undefined
}

export function createCollection(data: {
  tmdb_collection_id: number
  name: string
  quality_profile_id?: number
}): MonitoredCollection {
  const db = getDb()
  const r = db
    .prepare(
      `INSERT INTO monitored_collections
         (tmdb_collection_id, name, quality_profile_id, enabled, added_count, created_at)
       VALUES (?, ?, ?, 1, 0, ?)`,
    )
    .run(data.tmdb_collection_id, data.name, data.quality_profile_id ?? 1, Date.now())
  return getCollectionById(r.lastInsertRowid as number)!
}

export function updateCollection(
  id: number,
  data: Partial<{ enabled: number; quality_profile_id: number }>,
): MonitoredCollection | undefined {
  const allowed = ['enabled', 'quality_profile_id'] as const
  const keys = (Object.keys(data) as (keyof typeof data)[]).filter((k) =>
    allowed.includes(k as (typeof allowed)[number]),
  )
  if (keys.length === 0) return getCollectionById(id)
  const setClause = keys.map((k) => `${k} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE monitored_collections SET ${setClause} WHERE id = ?`)
    .run(...keys.map((k) => data[k]), id)
  return getCollectionById(id)
}

export function deleteCollection(id: number): boolean {
  const db = getDb()
  // collection_items rows are removed via ON DELETE CASCADE
  return db.prepare('DELETE FROM monitored_collections WHERE id = ?').run(id).changes > 0
}

// ── Sync ────────────────────────────────────────────────────────────────────

export async function syncCollection(col: MonitoredCollection): Promise<CollectionSyncResult> {
  const db = getDb()

  const data = await getCollection(col.tmdb_collection_id)
  if (!data) {
    const error = `TMDB collection ${col.tmdb_collection_id} not found or request failed`
    db.prepare('UPDATE monitored_collections SET last_sync_at = ?, last_error = ? WHERE id = ?').run(
      Date.now(),
      error,
      col.id,
    )
    return { added: 0, error }
  }

  const ledgerHas = db.prepare('SELECT 1 FROM collection_items WHERE collection_id = ? AND tmdb_id = ?')
  const ledgerAdd = db.prepare(
    'INSERT OR IGNORE INTO collection_items (collection_id, tmdb_id, added_at) VALUES (?, ?, ?)',
  )

  let added = 0
  for (const part of data.parts) {
    if (ledgerHas.get(col.id, part.id)) continue // already processed for this collection

    const year = part.release_date ? parseInt(part.release_date.slice(0, 4), 10) : undefined

    // Long-term monitored movie item — never auto-deleted.
    createItem({
      type: 'movie',
      title: part.title,
      tmdb_id: part.id,
      year: Number.isFinite(year) ? year : undefined,
      quality_profile_id: col.quality_profile_id,
    })
    ledgerAdd.run(col.id, part.id, Date.now())
    added++
  }

  db.prepare(
    'UPDATE monitored_collections SET last_sync_at = ?, last_error = NULL, added_count = added_count + ? WHERE id = ?',
  ).run(Date.now(), added, col.id)

  if (added > 0) {
    console.log(`[collections] "${col.name}": added ${added} new film(s) (${data.parts.length} total in collection)`)
  }
  return { added }
}

/** Sync every enabled collection. Returns the total number of items added. */
export async function syncAllCollections(): Promise<number> {
  const cols = getDb()
    .prepare('SELECT * FROM monitored_collections WHERE enabled = 1')
    .all() as MonitoredCollection[]
  let total = 0
  for (const col of cols) {
    try {
      const r = await syncCollection(col)
      total += r.added
    } catch (err) {
      process.stderr.write(`[collections] sync error for "${col.name}": ${err}\n`)
    }
  }
  return total
}
