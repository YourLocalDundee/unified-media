import { getDb } from '@/lib/db/index'
import { updateItem } from './monitor'
import type { MonitoredItem } from './types'

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
  const grabbed = getDb()
    .prepare("SELECT * FROM monitored_items WHERE status = 'grabbed' AND tmdb_id IS NOT NULL")
    .all() as MonitoredItem[]

  if (grabbed.length === 0) return 0

  let imported = 0

  for (const item of grabbed) {
    if (isInNativeLibrary(item)) {
      updateItem(item.id, { status: 'imported' })
      imported++
    }
  }

  return imported
}
