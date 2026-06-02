import { getDb } from '@/lib/db/index'
import type { NativeRequest, NativeRequestWithUser, RequestStatus, RequestMediaType } from './types'

const JOIN_USERS = `
  SELECT r.*, u.username
  FROM media_requests r
  JOIN users u ON r.user_id = u.id
`

export function getAllRequests(opts?: { status?: RequestStatus }): NativeRequestWithUser[] {
  const db = getDb()
  if (opts?.status) {
    return db.prepare(`${JOIN_USERS} WHERE r.status = ? ORDER BY r.created_at DESC`)
      .all(opts.status) as NativeRequestWithUser[]
  }
  return db.prepare(`${JOIN_USERS} ORDER BY r.created_at DESC`)
    .all() as NativeRequestWithUser[]
}

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
}): NativeRequest {
  const db = getDb()
  const now = Date.now()
  const seasonsJson = data.seasons != null ? JSON.stringify(data.seasons) : null

  try {
    const result = db.prepare(`
      INSERT INTO media_requests
        (user_id, tmdb_id, media_type, title, year, poster_path, overview, seasons, status, created_at, updated_at)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      data.userId,
      data.tmdbId,
      data.mediaType,
      data.title,
      data.year ?? null,
      data.posterPath ?? null,
      data.overview ?? null,
      seasonsJson,
      now,
      now
    )

    return db.prepare('SELECT * FROM media_requests WHERE id = ?')
      .get(result.lastInsertRowid) as NativeRequest
  } catch (err: unknown) {
    // UNIQUE constraint: user_id + tmdb_id + media_type
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

export function deleteRequest(id: number): boolean {
  const db = getDb()
  const result = db.prepare('DELETE FROM media_requests WHERE id = ?').run(id)
  return result.changes > 0
}

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
