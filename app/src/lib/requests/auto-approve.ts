// Auto-approval logic for 'quick' requests (Phase 7 independence build).
// A quick request is approved without admin intervention if three conditions are met:
//   1. The content's release year is strictly before the current year (not current-year releases).
//   2. The user hasn't hit the per-media-type concurrent quick limit (1 movie, 2 TV shows).
//   3. The downstream automation system accepts the item (or it already exists there).
// Marked 'server-only' because it writes to the DB and calls internal automation — never expose client-side.

import 'server-only'
import { getDb } from '@/lib/db/index'
import { getRequestById, updateRequestStatus } from './monitor'
import { createItem, getItemsByTmdbId } from '@/lib/automation/monitor'

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

// Attempts to auto-approve a newly created quick request. Returns the created monitored_item's id
// if approved (the grab-confirmation flow opens against it), or null otherwise. The caller
// (POST /api/requests) is responsible for deleting the row if this returns null.
//
// Does NOT grab — it only creates the 'wanted' item and marks the request approved. Grabbing used
// to fire immediately from here (fire-and-forget); that's now the user's job via the grab
// confirmation modal (GET /api/grab/candidates + POST /api/grab/confirm), which reuses the exact
// same search/score/gate pipeline. If the user cancels, the item just stays 'wanted' and the
// 5-minute cron picks it up later — identical to today's behavior when a grab attempt finds nothing.
export function tryAutoApprove(requestId: number): number | null {
  const request = getRequestById(requestId)
  if (!request) return null

  const mediaType = request.media_type as 'movie' | 'tv'

  // Only quick+auto-pick requests auto-approve; anything else goes to admin queue.
  if (request.request_type !== 'quick') return null
  if (request.request_method !== 'auto-pick') return null

  const currentYear = new Date().getFullYear()

  // Current-year content is excluded — those titles are still in active release windows
  // and auto-approving them could create rights/availability issues.
  if (!request.year || request.year >= currentYear) return null

  // Check concurrent limit
  const active = getActiveAutoApprovedCount(request.user_id, mediaType)
  const limit = LIMITS[mediaType]
  if (active >= limit) return null

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

  let itemId: number
  try {
    const item = createItem({
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
      audio_mode: request.audio_mode ?? 'any',
    })
    itemId = item.id
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 'already exists' means a previous request already queued it — not an error, but we still
    // need the existing item's id for the confirmation modal to open against.
    if (!msg.toLowerCase().includes('already exists')) return null
    const existing = getItemsByTmdbId(request.tmdb_id ?? -1).find(i => i.type === mediaType)
    if (!existing) return null
    itemId = existing.id
  }

  updateRequestStatus(requestId, 'approved')
  // auto_approved flag is stored separately from status so the UI can show "auto" vs "admin" badge.
  getDb().prepare('UPDATE media_requests SET auto_approved = 1 WHERE id = ?').run(requestId)

  // Prefetch alt/AKA titles in the background (non-fatal, no grab) so the AKA fallback is ready
  // whenever the grab actually happens — either the user confirming now, or the cron retrying
  // later if they cancel. Fire-and-forget: enrichment only, never blocks the response.
  const grabTmdbId = request.tmdb_id
  const grabMediaType = mediaType
  void (async () => {
    try {
      const { getItemById, storeAltTitles } = await import('@/lib/automation/monitor')
      const item = getItemById(itemId)
      if (!item || item.alternative_titles || !grabTmdbId) return
      const { getAlternativeTitles } = await import('@/lib/media-server/tmdb')
      const altTitles = await getAlternativeTitles(grabTmdbId, grabMediaType)
      if (altTitles.length > 0) storeAltTitles(itemId, altTitles)
    } catch (err) {
      console.warn('[auto-approve] Alt-title prefetch failed (non-fatal):', err)
    }
  })()

  return itemId
}
