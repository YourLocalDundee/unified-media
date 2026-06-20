// Auto-approval logic for 'quick' requests (Phase 7 independence build).
// A quick request is approved without admin intervention if three conditions are met:
//   1. The content's release year is strictly before the current year (not current-year releases).
//   2. The user hasn't hit the per-media-type concurrent quick limit (1 movie, 2 TV shows).
//   3. The downstream automation system accepts the item (or it already exists there).
// Marked 'server-only' because it writes to the DB and calls internal automation — never expose client-side.

import 'server-only'
import { getDb } from '@/lib/db/index'
import { getRequestById, updateRequestStatus } from './monitor'
import { createItem } from '@/lib/automation/monitor'

// Hard limits for concurrent auto-approved quick requests per user, per media type.
// TV gets 2 because multi-season requests are common and shouldn't block each other.
const LIMITS = { movie: 1, tv: 2 } as const

// Counts requests that are currently consuming a quick slot (approved but not yet expired/declined).
// 'available' is included because the item is still occupying that slot until the 48h window closes.
export function getActiveAutoApprovedCount(userId: string, mediaType: 'movie' | 'tv'): number {
  const row = getDb().prepare(
    `SELECT COUNT(*) as cnt FROM media_requests
     WHERE user_id = ? AND media_type = ? AND request_type = 'quick'
     AND status IN ('approved', 'available')`
  ).get(userId, mediaType) as { cnt: number }
  return row.cnt
}

// Attempts to auto-approve a newly created quick request. Returns true if approved, false otherwise.
// The caller (POST /api/requests) is responsible for deleting the row if this returns false.
export function tryAutoApprove(requestId: number): boolean {
  const request = getRequestById(requestId)
  if (!request) return false

  const mediaType = request.media_type as 'movie' | 'tv'

  // Only quick+auto-pick requests grab immediately; anything else goes to admin queue.
  if (request.request_type !== 'quick') return false
  if (request.request_method !== 'auto-pick') return false

  const currentYear = new Date().getFullYear()

  // Current-year content is excluded — those titles are still in active release windows
  // and auto-approving them could create rights/availability issues.
  if (!request.year || request.year >= currentYear) return false

  // Check concurrent limit
  const active = getActiveAutoApprovedCount(request.user_id, mediaType)
  const limit = LIMITS[mediaType]
  if (active >= limit) return false

  // Push the item to the automation layer (Radarr/Sonarr equivalent).
  // Scope fields are forwarded from the request so the grabber targets exactly what the user requested.
  const raw = request as unknown as Record<string, unknown>
  const scopeType = raw.scope_type as string | undefined
  const scopeSeasonsRaw = raw.scope_seasons as string | null | undefined
  const scopeEpisodesRaw = raw.scope_episodes as string | null | undefined
  const monitorFuture = raw.monitor_future as number | undefined
  // Use the quality profile the user chose; fall back to the default (1 = "Any").
  const qualityProfileId = typeof raw.quality_profile_id === 'number' && raw.quality_profile_id > 0
    ? raw.quality_profile_id as number
    : 1

  try {
    createItem({
      tmdb_id: request.tmdb_id,
      tvdb_id: undefined,
      type: mediaType === 'movie' ? 'movie' : 'tv',
      title: request.title,
      year: request.year ?? undefined,
      quality_profile_id: qualityProfileId,
      root_path: '',
      scope_type: (scopeType as 'full' | 'seasons' | 'episodes' | 'movie' | null) ?? null,
      scope_seasons: scopeSeasonsRaw ? (JSON.parse(scopeSeasonsRaw) as number[]) : null,
      scope_episodes: scopeEpisodesRaw ? (JSON.parse(scopeEpisodesRaw) as Array<{s:number;e:number}>) : null,
      monitor_future: Boolean(monitorFuture),
      language: request.language ?? 'any',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 'already exists' means a previous request already queued it — not an error.
    // Any other failure is unexpected; bail out so the request isn't falsely marked approved.
    if (!msg.toLowerCase().includes('already exists')) return false
  }

  updateRequestStatus(requestId, 'approved')
  // auto_approved flag is stored separately from status so the UI can show "auto" vs "admin" badge.
  getDb().prepare('UPDATE media_requests SET auto_approved = 1 WHERE id = ?').run(requestId)

  // Fire immediate grab — non-blocking, cron retries on failure.
  // Capture language here so the IIFE doesn't close over a mutable variable.
  const grabLanguage = request.language ?? 'any'
  void (async () => {
    try {
      const { getAllItems } = await import('@/lib/automation/monitor')
      const { grabItem } = await import('@/lib/automation/grabber')
      const items = getAllItems()
      const item = items.find(
        i => i.tmdb_id === request.tmdb_id && i.type === (request.media_type === 'movie' ? 'movie' : 'tv')
      )
      if (item && item.status === 'wanted') {
        const result = await grabItem(item, { language: grabLanguage })
        console.log(`[auto-approve] Immediate grab for "${item.title}": ${result}`)
      }
    } catch (err) {
      console.warn('[auto-approve] Immediate grab failed (cron will retry):', err)
    }
  })()

  return true
}
