import { getDb } from '@/lib/db/index'
import { createItem } from './monitor'
import type { MonitoredItem } from './types'
import type { NativeRequest } from '@/lib/requests/types'
import { getMovie, getTV } from '@/lib/media-server/tmdb'

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export function findItemForRequest(
  tmdbId: number,
  mediaType: 'movie' | 'tv'
): MonitoredItem | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM monitored_items WHERE tmdb_id = ? AND type = ? LIMIT 1')
    .get(tmdbId, mediaType) as MonitoredItem | undefined
}

// ---------------------------------------------------------------------------
// Title enrichment
// ---------------------------------------------------------------------------

export async function extractTitle(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<string> {
  try {
    if (mediaType === 'movie') {
      const detail = await getMovie(tmdbId)
      return detail.title
    } else {
      const detail = await getTV(tmdbId)
      return detail.name
    }
  } catch {
    return 'Unknown'
  }
}

// ---------------------------------------------------------------------------
// Bridge: native request → monitored_items
// ---------------------------------------------------------------------------

export async function onRequestApproved(
  request: NativeRequest,
  title?: string
): Promise<MonitoredItem | null> {
  try {
    const tmdbId = request.tmdb_id
    const type = request.media_type
    const resolvedTitle = title ?? request.title ?? await extractTitle(tmdbId, type)

    const existing = findItemForRequest(tmdbId, type)
    if (existing) {
      return existing
    }

    return createItem({
      type,
      title: resolvedTitle,
      tmdb_id: tmdbId,
      tvdb_id: undefined,
      year: request.year ?? undefined,
    })
  } catch (err) {
    console.error('[bridge] onRequestApproved error:', err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function findAllBridgedItems(): Array<{ item: MonitoredItem; tmdb_id: number }> {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM monitored_items WHERE tmdb_id IS NOT NULL ORDER BY created_at DESC'
    )
    .all() as MonitoredItem[]

  return rows.map((item) => ({ item, tmdb_id: item.tmdb_id as number }))
}
