/**
 * deleteRequestWithCascade — Regression 3.
 *
 * A bare `DELETE FROM media_requests` left two leaks: the request's monitored_items kept grabbing
 * every 5 min (orphaned 'wanted' rows), and the associated torrents stayed in the download client
 * forever. There is NO FK linking media_requests to monitored_items (they share only tmdb_id), so
 * this cascades by (tmdb_id, media_type) with a co-owner guard.
 *
 * Scoping: media_requests has UNIQUE(user_id, tmdb_id, media_type), so a single user has at most one
 * request row per show, and monitored_items are deduped/shared (keyed by tmdb_id+type+scope_key), not
 * user-scoped. To avoid yanking content another owner still wants, we cascade the monitored_items /
 * grab_history / torrents ONLY when the deleted request is the SOLE media_requests row for that
 * (tmdb_id, media_type). If any other request still references the show, we delete only the request
 * row. Edge: a monitored_item added directly via admin automation (no request) for the same show,
 * with no other request present, would also be swept — acceptable in a single household.
 *
 * Torrents are removed torrent-only (deleteFiles=false) so already-imported media on disk is never
 * deleted. 'server-only' keeps the download client out of any client bundle.
 */

import 'server-only'
import { getDb } from '@/lib/db/index'
import { getClient } from '@/lib/download-client/registry'
import { getRequestById, deleteRequest } from './monitor'

export interface RequestDeleteSummary {
  deleted: boolean
  cascaded: boolean          // true when monitored_items/torrents were also removed
  monitoredItemsDeleted: number
  torrentsDeleted: number
  skippedReason?: 'no_tmdb_id' | 'co_owned'  // why the cascade was skipped (request row still deleted)
}

const NONE: RequestDeleteSummary = { deleted: false, cascaded: false, monitoredItemsDeleted: 0, torrentsDeleted: 0 }

export async function deleteRequestWithCascade(id: number): Promise<RequestDeleteSummary> {
  const db = getDb()
  const request = getRequestById(id)
  if (!request) return NONE

  const tmdbId = request.tmdb_id
  const mediaType = request.media_type // 'movie' | 'tv' — matches monitored_items.type

  // Co-owner guard: any OTHER request for the same show means the shared items/torrents are still
  // wanted, so cascade only the request row.
  const others =
    tmdbId == null
      ? 0
      : (db
          .prepare('SELECT COUNT(*) AS n FROM media_requests WHERE tmdb_id = ? AND media_type = ? AND id != ?')
          .get(tmdbId, mediaType, id) as { n: number }).n

  if (tmdbId == null || others > 0) {
    const deleted = deleteRequest(id)
    return { ...NONE, deleted, skippedReason: tmdbId == null ? 'no_tmdb_id' : 'co_owned' }
  }

  // Resolve torrent hashes for this show's monitored items BEFORE deleting any rows.
  const hashes = (
    db
      .prepare(
        `SELECT DISTINCT gh.info_hash FROM grab_history gh
         JOIN monitored_items mi ON mi.id = gh.item_id
         WHERE mi.tmdb_id = ? AND mi.type = ?`,
      )
      .all(tmdbId, mediaType) as { info_hash: string }[]
  )
    .map((h) => h.info_hash)
    .filter(Boolean)

  // Best-effort torrent removal (torrent-only, keep files): don't abort the DB cleanup on a qBit error.
  let torrentsDeleted = 0
  if (hashes.length > 0) {
    try {
      await getClient().deleteTorrents(hashes, false)
      torrentsDeleted = hashes.length
    } catch (err) {
      process.stderr.write(
        `[request-delete] torrent cleanup failed for tmdb ${tmdbId}: ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }

  // DB cascade in one transaction: grab_results + grab_history per item, then monitored_items, then
  // the request row itself.
  let monitoredItemsDeleted = 0
  const tx = db.transaction(() => {
    const miIds = db
      .prepare('SELECT id FROM monitored_items WHERE tmdb_id = ? AND type = ?')
      .all(tmdbId, mediaType) as { id: number }[]
    for (const m of miIds) {
      db.prepare('DELETE FROM grab_results WHERE monitored_item_id = ?').run(m.id)
      db.prepare('DELETE FROM grab_history WHERE item_id = ?').run(m.id)
    }
    monitoredItemsDeleted = db
      .prepare('DELETE FROM monitored_items WHERE tmdb_id = ? AND type = ?')
      .run(tmdbId, mediaType).changes
    db.prepare('DELETE FROM media_requests WHERE id = ?').run(id)
  })
  tx()

  return { deleted: true, cascaded: true, monitoredItemsDeleted, torrentsDeleted }
}
