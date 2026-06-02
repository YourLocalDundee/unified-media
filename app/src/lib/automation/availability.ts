import { getDb } from '@/lib/db/index'
import { updateItem } from './monitor'
import type { MonitoredItem } from './types'

const AUTO_DELETE_MS = 48 * 60 * 60 * 1000

function isInNativeLibrary(item: MonitoredItem): boolean {
  if (item.tmdb_id == null) return false

  const db = getDb()
  const type = item.type === 'movie' ? 'movie' : 'series'

  const row = db
    .prepare('SELECT id FROM media_items WHERE tmdb_id = ? AND type = ?')
    .get(item.tmdb_id, type)

  return row !== undefined
}

export async function checkAvailability(): Promise<number> {
  const db = getDb()
  const grabbed = db
    .prepare("SELECT * FROM monitored_items WHERE status = 'grabbed' AND tmdb_id IS NOT NULL")
    .all() as MonitoredItem[]

  if (grabbed.length === 0) return 0

  let imported = 0

  for (const item of grabbed) {
    if (isInNativeLibrary(item)) {
      updateItem(item.id, { status: 'imported' })

      // Bridge to media_requests: mark available + schedule auto-delete
      const mediaType = item.type === 'movie' ? 'movie' : 'tv'
      const now = Date.now()
      db.prepare(
        `UPDATE media_requests
         SET status = 'available', available_at = ?, auto_delete_at = ?
         WHERE tmdb_id = ? AND media_type = ? AND auto_approved = 1
         AND status = 'approved'`
      ).run(now, now + AUTO_DELETE_MS, item.tmdb_id, mediaType)

      imported++
    }
  }

  return imported
}
