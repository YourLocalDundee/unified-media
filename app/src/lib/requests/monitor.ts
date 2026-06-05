// Data-access layer for the media_requests table (Phase 7 native request system).
// All queries join the users table via JOIN_USERS so callers always get NativeRequestWithUser
// without needing a separate lookup. Functions are synchronous (better-sqlite3 is blocking).

import { getDb } from '@/lib/db/index'
import type { NativeRequest, NativeRequestWithUser, RequestStatus, RequestMediaType, RequestType } from './types'

// Reused base query — always joins users so username is available on every row.
const JOIN_USERS = `
  SELECT r.*, u.username
  FROM media_requests r
  JOIN users u ON r.user_id = u.id
`

// Admin-only: returns all users' requests.
export function getAllRequests(opts?: { status?: RequestStatus }): NativeRequestWithUser[] {
  const db = getDb()
  if (opts?.status) {
    return db.prepare(`${JOIN_USERS} WHERE r.status = ? ORDER BY r.created_at DESC`)
      .all(opts.status) as NativeRequestWithUser[]
  }
  return db.prepare(`${JOIN_USERS} ORDER BY r.created_at DESC`)
    .all() as NativeRequestWithUser[]
}

// User-scoped: only returns requests belonging to the given userId.
export function getUserRequests(userId: string, opts?: { status?: RequestStatus }): NativeRequestWithUser[] {
  const db = getDb()
  if (opts?.status) {
    return db.prepare(`${JOIN_USERS} WHERE r.user_id = ? AND r.status = ? ORDER BY r.created_at DESC`)
      .all(userId, opts.status) as NativeRequestWithUser[]
  }
  return db.prepare(`${JOIN_USERS} WHERE r.user_id = ? ORDER BY r.created_at DESC`)
    .all(userId) as NativeRequestWithUser[]
}

export function getRequestById(id: number): NativeRequestWithUser | undefined {
  const db = getDb()
  return db.prepare(`${JOIN_USERS} WHERE r.id = ?`)
    .get(id) as NativeRequestWithUser | undefined
}

// Scoped to (userId, tmdbId, mediaType) — a user can only have one active request per title.
// Expired requests are excluded from uniqueness checks at the API layer so they can be re-requested.
export function getRequestByTmdb(
  userId: string,
  tmdbId: number,
  mediaType: RequestMediaType
): NativeRequest | undefined {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM media_requests WHERE user_id = ? AND tmdb_id = ? AND media_type = ?'
  ).get(userId, tmdbId, mediaType) as NativeRequest | undefined
}

export function createRequest(data: {
  userId: string
  tmdbId: number
  mediaType: RequestMediaType
  title: string
  year?: number | null
  posterPath?: string | null
  overview?: string | null
  seasons?: number[] | null
  requestType?: RequestType
  scopeType?: 'full' | 'seasons' | 'episodes' | 'movie' | null
  scopeSeasons?: number[] | null
  scopeEpisodes?: Array<{ s: number; e: number }> | null
  monitorFuture?: boolean
}): NativeRequest {
  const db = getDb()
  const now = Date.now()
  // seasons is stored as JSON text; SQLite has no array type.
  const seasonsJson = data.seasons != null ? JSON.stringify(data.seasons) : null
  const scopeSeasonsJson = data.scopeSeasons != null ? JSON.stringify(data.scopeSeasons) : null
  const scopeEpisodesJson = data.scopeEpisodes != null ? JSON.stringify(data.scopeEpisodes) : null
  const resolvedScopeType = data.scopeType ?? (data.mediaType === 'movie' ? 'movie' : 'full')

  try {
    const result = db.prepare(`
      INSERT INTO media_requests
        (user_id, tmdb_id, media_type, title, year, poster_path, overview, seasons, status, request_type,
         scope_type, scope_seasons, scope_episodes, monitor_future,
         created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?,
         ?, ?, ?, ?,
         ?, ?)
    `).run(
      data.userId,
      data.tmdbId,
      data.mediaType,
      data.title,
      data.year ?? null,
      data.posterPath ?? null,
      data.overview ?? null,
      seasonsJson,
      data.requestType ?? 'longterm',
      resolvedScopeType,
      scopeSeasonsJson,
      scopeEpisodesJson,
      data.monitorFuture ? 1 : 0,
      now,
      now
    )

    // Re-fetch with the generated id so the caller gets a complete typed row.
    return db.prepare('SELECT * FROM media_requests WHERE id = ?')
      .get(result.lastInsertRowid) as NativeRequest
  } catch (err: unknown) {
    // UNIQUE constraint: user_id + tmdb_id + media_type
    // The API layer pre-checks with getRequestByTmdb, but this catches any race.
    if (
      err instanceof Error &&
      err.message.includes('UNIQUE constraint failed')
    ) {
      throw new Error(`Request already exists for this title`)
    }
    throw err
  }
}

export function updateRequestStatus(id: number, status: RequestStatus): void {
  const db = getDb()
  db.prepare('UPDATE media_requests SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, Date.now(), id)
}

// Returns false if the row didn't exist (e.g. already deleted by a concurrent request).
export function deleteRequest(id: number): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM media_requests WHERE id = ?').run(id)
  return result.changes > 0
}

// Counts are fetched in a single GROUP BY query to avoid N+1 round-trips.
// Any status not present in the DB simply stays at 0 via the initializer.
export function getRequestCounts(): {
  pending: number
  approved: number
  declined: number
  available: number
  expired: number
  total: number
} {
  const db = getDb()
  const rows = db.prepare(
    `SELECT status, COUNT(*) as count FROM media_requests GROUP BY status`
  ).all() as { status: string; count: number }[]

  const counts = { pending: 0, approved: 0, declined: 0, available: 0, expired: 0, total: 0 }
  for (const row of rows) {
    const s = row.status as RequestStatus
    if (s in counts) counts[s] = row.count
    counts.total += row.count
  }
  return counts
}
