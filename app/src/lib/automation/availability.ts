/**
 * Availability checker: polls the media_items table to detect when a grabbed torrent has
 * been imported into the native media library.
 *
 * Run on a 30-minute cron by scheduler.ts. Also exposed as a manual trigger via
 * POST /api/automation/sync for the admin bridge page.
 *
 * When an item is confirmed available, two things happen atomically:
 *   1. monitored_items.status → 'imported'
 *   2. media_requests row (if any) is marked 'available' and auto_delete_at is set for quick requests
 *
 * auto_delete_at = download_completed_at + 48h (not library scan time).
 * download_completed_at is set by markCompletedDownloads() which polls qBit for seeding torrents.
 *
 * This is the only place that writes to media_requests from the automation pipeline.
 */

import { getDb } from '@/lib/db/index'
import { updateItem } from './monitor'
import type { MonitoredItem } from './types'

// Quick requests auto-delete 48 hours after DOWNLOAD COMPLETION (not library scan time)
const AUTO_DELETE_MS = 48 * 60 * 60 * 1000

// qBit states that indicate a torrent has finished downloading and is now seeding
const SEEDING_STATES = new Set([
  'uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'pausedUP', 'checkingUP',
  'stoppedUP',   // qBit v5+
])

/**
 * Cross-references grab_history (which has info_hash) against qBittorrent's torrent list.
 * For each grabbed torrent that is now seeding, sets download_completed_at on the
 * corresponding monitored_item (once only — never overwritten once set).
 */
export async function markCompletedDownloads(): Promise<void> {
  const db = getDb()

  // Grab all items that are in 'grabbed' state and haven't been marked complete yet
  type GrabRow = { item_id: number; info_hash: string }
  const pending = db.prepare(`
    SELECT gh.item_id, gh.info_hash
    FROM grab_history gh
    JOIN monitored_items mi ON mi.id = gh.item_id
    WHERE mi.status = 'grabbed' AND mi.download_completed_at IS NULL
  `).all() as GrabRow[]

  if (pending.length === 0) return

  let qbitTorrents: Array<{ hash: string; state: string }> = []
  try {
    const { qbitFetch } = await import('@/lib/qbittorrent/session')
    qbitTorrents = await qbitFetch<Array<{ hash: string; state: string }>>('/api/v2/torrents/info')
  } catch {
    // qBit unavailable — skip; will retry on next cron run
    return
  }

  const seedingHashes = new Set(
    qbitTorrents
      .filter(t => SEEDING_STATES.has(t.state))
      .map(t => t.hash.toLowerCase())
  )

  const now = Date.now()
  for (const row of pending) {
    if (seedingHashes.has(row.info_hash.toLowerCase())) {
      db.prepare(
        'UPDATE monitored_items SET download_completed_at = ? WHERE id = ? AND download_completed_at IS NULL'
      ).run(now, row.item_id)
    }
  }
}

// Checks whether a grabbed item's media now appears in the native media_items table.
// Uses tmdb_id + type because that's what the media scanner uses as its identifier.
// Items without a tmdb_id can't be matched — they remain in 'grabbed' status indefinitely.
function isInNativeLibrary(item: MonitoredItem): boolean {
  if (item.tmdb_id == null) return false

  const db = getDb()
  // TV series are stored as type='series' in media_items, not 'tv'
  const type = item.type === 'movie' ? 'movie' : 'series'

  const row = db
    .prepare('SELECT id FROM media_items WHERE tmdb_id = ? AND type = ?')
    .get(item.tmdb_id, type)

  return row !== undefined
}

// Returns the count of items that transitioned to 'imported' during this run.
export async function checkAvailability(): Promise<number> {
  const db = getDb()

  // Mark downloads that have finished seeding in qBit (sets download_completed_at)
  // This must run before the availability scan so the timestamp is ready.
  await markCompletedDownloads().catch(() => { /* qBit down — not fatal */ })

  // Only check 'grabbed' items; 'wanted' items haven't been sent to the download client yet
  type GrabbedItem = MonitoredItem & { download_completed_at: number | null }
  const grabbed = db
    .prepare("SELECT * FROM monitored_items WHERE status = 'grabbed' AND tmdb_id IS NOT NULL")
    .all() as GrabbedItem[]

  if (grabbed.length === 0) return 0

  let imported = 0

  for (const item of grabbed) {
    if (isInNativeLibrary(item)) {
      updateItem(item.id, { status: 'imported' })

      // 48h timer starts from download completion time, not library scan time.
      // Falls back to now if qBit completion wasn't captured (avoids null auto_delete_at).
      const completedAt = item.download_completed_at ?? Date.now()
      const autoDeleteAt = completedAt + AUTO_DELETE_MS

      const mediaType = item.type === 'movie' ? 'movie' : 'tv'
      const now = Date.now()
      db.prepare(
        `UPDATE media_requests
         SET status = 'available', available_at = ?,
             auto_delete_at = CASE WHEN request_type = 'quick' THEN ? ELSE NULL END
         WHERE tmdb_id = ? AND media_type = ? AND status = 'approved'`
      ).run(now, autoDeleteAt, item.tmdb_id, mediaType)

      imported++
    }
  }

  return imported
}
