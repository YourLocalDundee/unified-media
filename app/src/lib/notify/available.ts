/**
 * Centralized "a request just became available" notification capture.
 *
 * Several independent code paths flip media_requests to 'available': the availability cron
 * (automation/availability.ts), the importer's three import routes (automation/importer.ts), and the
 * Seerr MEDIA_AVAILABLE webhook. Routing all of them through this one helper keeps the notification
 * behavior identical and dedupes naturally — whichever path flips a row first changes it; the others
 * match 0 rows here and notify no one.
 *
 * Usage is two-step so a slow webhook never holds the SQLite write path open:
 *   1. const payloads = collectAvailableNotifications(tmdbId, mediaType, [...fromStatuses])  // BEFORE the UPDATE
 *   2. ...run the UPDATE that sets status='available'...
 *   3. await notifyAll(payloads)                                                             // AFTER (or void it)
 *
 * collectAvailableNotifications must be called BEFORE the UPDATE: it reads the rows in their
 * pre-transition status, so calling it after they are already 'available' would capture nothing.
 * The read is synchronous (better-sqlite3), so there is no await between capture and update.
 */

import { getDb } from '@/lib/db/index'
import { notifyMediaAvailable, type MediaAvailablePayload } from './index'

export function collectAvailableNotifications(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  fromStatuses: readonly string[] = ['approved'],
): MediaAvailablePayload[] {
  if (fromStatuses.length === 0) return []
  const db = getDb()
  const placeholders = fromStatuses.map(() => '?').join(',')
  type Row = {
    title: string
    year: number | null
    poster_path: string | null
    username: string | null
    display_name: string | null
  }
  const rows = db
    .prepare(
      `SELECT mr.title, mr.year, mr.poster_path, u.username, u.display_name
         FROM media_requests mr
         LEFT JOIN users u ON u.id = mr.user_id
        WHERE mr.tmdb_id = ? AND mr.media_type = ? AND mr.status IN (${placeholders})`,
    )
    .all(tmdbId, mediaType, ...fromStatuses) as Row[]

  return rows.map((r) => ({
    title: r.title,
    year: r.year,
    mediaType,
    tmdbId,
    posterPath: r.poster_path,
    requestedBy: r.display_name || r.username || null,
  }))
}

export async function notifyAll(payloads: MediaAvailablePayload[]): Promise<void> {
  if (payloads.length === 0) return
  await Promise.allSettled(payloads.map((p) => notifyMediaAvailable(p)))
}
