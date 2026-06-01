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
  }>
): Indexer | undefined {
  const allowed = ['name', 'torznab_url', 'api_key', 'enabled'] as const
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
