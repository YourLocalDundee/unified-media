import 'server-only'
import { getDb } from '@/lib/db/index'
import { getRequestById, updateRequestStatus } from './monitor'
import { createItem } from '@/lib/automation/monitor'

const LIMITS = { movie: 1, tv: 2 } as const

export function getActiveAutoApprovedCount(userId: string, mediaType: 'movie' | 'tv'): number {
  // Count requests where: user_id = userId, media_type = mediaType,
  // auto_approved = 1, status IN ('approved', 'available')
  const row = getDb().prepare(
    `SELECT COUNT(*) as cnt FROM media_requests
     WHERE user_id = ? AND media_type = ? AND auto_approved = 1
     AND status IN ('approved', 'available')`
  ).get(userId, mediaType) as { cnt: number }
  return row.cnt
}

export function tryAutoApprove(requestId: number): boolean {
  const request = getRequestById(requestId)
  if (!request) return false

  const mediaType = request.media_type as 'movie' | 'tv'
  const currentYear = new Date().getFullYear()

  // Must have a known year strictly before current year
  if (!request.year || request.year >= currentYear) return false

  // Check concurrent limit
  const active = getActiveAutoApprovedCount(request.user_id, mediaType)
  const limit = LIMITS[mediaType]
  if (active >= limit) return false

  // Auto-approve
  try {
    createItem({
      tmdb_id: request.tmdb_id,
      tvdb_id: undefined,
      type: mediaType === 'movie' ? 'movie' : 'tv',
      title: request.title,
      year: request.year ?? undefined,
      quality_profile_id: 1,
      root_path: '',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!msg.toLowerCase().includes('already exists')) return false
    // Already in queue is fine — still mark approved
  }

  updateRequestStatus(requestId, 'approved')
  getDb().prepare('UPDATE media_requests SET auto_approved = 1 WHERE id = ?').run(requestId)

  return true
}
