// SQLite CRUD layer for the `indexers` table in unified.db.
// Indexers are configured via the /admin/indexers UI and stored locally —
// they are not synced from Prowlarr. enabled is stored as 0|1 (SQLite boolean).
import { getDb } from '@/lib/db/index'
import type { Indexer } from './types'

export function getAllIndexers(): Indexer[] {
  return getDb()
    .prepare('SELECT * FROM indexers ORDER BY name')
    .all() as Indexer[]
}

export function getEnabledIndexers(): Indexer[] {
  return getDb()
    .prepare('SELECT * FROM indexers WHERE enabled = 1 ORDER BY name')
    .all() as Indexer[]
}

export function getIndexerById(id: number): Indexer | undefined {
  return getDb()
    .prepare('SELECT * FROM indexers WHERE id = ?')
    .get(id) as Indexer | undefined
}

export function createIndexer(data: {
  name: string
  torznab_url: string
  api_key: string
}): Indexer {
  const db = getDb()
  const result = db
    .prepare(
      'INSERT INTO indexers (name, torznab_url, api_key) VALUES (?, ?, ?)'
    )
    .run(data.name, data.torznab_url, data.api_key)
  return db
    .prepare('SELECT * FROM indexers WHERE id = ?')
    .get(result.lastInsertRowid) as Indexer
}

export function updateIndexer(
  id: number,
  data: Partial<{
    name: string
    torznab_url: string
    api_key: string
    enabled: number
    description: string
    base_url: string
    requires_auth: number
    requires_flaresolverr: number
    search_type: string
    pending_credentials: string
  }>
): Indexer | undefined {
  // Allowlist prevents arbitrary column injection through the dynamic SET clause.
  const allowed = ['name', 'torznab_url', 'api_key', 'enabled', 'description', 'base_url', 'requires_auth', 'requires_flaresolverr', 'search_type', 'pending_credentials'] as const
  const keys = (Object.keys(data) as (keyof typeof data)[]).filter(k =>
    allowed.includes(k as (typeof allowed)[number])
  )
  if (keys.length === 0) return getIndexerById(id)

  const setClauses = keys.map(k => `${k} = ?`).join(', ')
  const values = keys.map(k => data[k])

  getDb()
    .prepare(`UPDATE indexers SET ${setClauses} WHERE id = ?`)
    .run(...values, id)

  return getIndexerById(id)
}

export function deleteIndexer(id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM indexers WHERE id = ?')
    .run(id)
  return result.changes > 0
}

export function updateIndexerHealth(
  id: number,
  status: 'ok' | 'error',
  responseTimeMs: number
): void {
  getDb()
    .prepare(
      'UPDATE indexers SET last_health_check = ?, health_status = ? WHERE id = ?'
    )
    .run(Date.now(), status, id)
}

export function getPendingIndexers(): Indexer[] {
  return getDb()
    .prepare('SELECT * FROM indexers WHERE requires_auth = 1 AND enabled = 0 ORDER BY name')
    .all() as Indexer[]
}

export function activateIndexer(id: number, torznab_url: string, api_key: string): void {
  getDb()
    .prepare('UPDATE indexers SET torznab_url = ?, api_key = ?, enabled = 1 WHERE id = ?')
    .run(torznab_url, api_key, id)
}
