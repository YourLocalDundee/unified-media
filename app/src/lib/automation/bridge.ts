/**
 * Bridge: admin UI data layer for the automation pipeline.
 *
 * This file was originally intended as the central connection point between the request
 * system and the automation pipeline. In practice, both approval paths call createItem()
 * directly and no longer route through onRequestApproved():
 *
 *   - Admin approval:   src/app/api/requests/[id]/approve/route.ts
 *   - Auto-approval:    src/lib/requests/auto-approve.ts
 *
 * Both paths now also fire an immediate grab after createItem(), falling back to the
 * 15-minute cron on failure. onRequestApproved() is intentionally NOT called by either path.
 *
 * What this file IS still used for:
 *   - findAllBridgedItems() — powers the admin bridge page at /admin/automation/bridge,
 *     which lists all monitored items that arrived via a request (have a tmdb_id) rather
 *     than being added manually through the admin automation UI.
 *   - findItemForRequest() — idempotency check utility (available to any future callers).
 *   - extractTitle()       — TMDB title lookup fallback (available to any future callers).
 *   - onRequestApproved()  — kept as a utility in case it's needed in future refactors;
 *                            currently dead code (nothing calls it).
 *
 * This is Phase 3 of the independence build — it replaces the Seerr→Sonarr/Radarr link.
 * Previously, Seerr would push an approved request to the *arr stack; now it goes here.
 */

import { getDb } from '@/lib/db/index'
import { createItem } from './monitor'
import type { MonitoredItem } from './types'
import type { NativeRequest } from '@/lib/requests/types'
import { getMovie, getTV } from '@/lib/media-server/tmdb'

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

// Idempotency check — prevents duplicate monitored_items rows if a request
// is approved more than once (e.g. re-approval after decline, webhook retry).
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

// Fetches the canonical title from TMDB when the request row doesn't include one.
// Falls back to 'Unknown' rather than throwing so a TMDB outage doesn't block approval.
// Movies use .title; TV shows use .name — different TMDB API field names.
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

// NOTE: onRequestApproved is NOT called by the approval routes. Both paths (admin approve
// and auto-approve) call createItem() directly and fire their own immediate grab. This
// function is retained as a utility for possible future use but is currently dead code.
//
// The optional title param avoids an extra TMDB round-trip when the caller already has it.
// Returns the existing monitored item (idempotent) or the newly created one, or null on error.
export async function onRequestApproved(
  request: NativeRequest,
  title?: string
): Promise<MonitoredItem | null> {
  try {
    const tmdbId = request.tmdb_id
    const type = request.media_type
    // Title resolution priority: explicit param > request.title > TMDB API lookup
    const resolvedTitle = title ?? request.title ?? await extractTitle(tmdbId, type)

    // Don't create a duplicate if a prior approval already created the monitored item
    const existing = findItemForRequest(tmdbId, type)
    if (existing) {
      return existing
    }

    // tvdb_id is not stored on NativeRequest — it could be fetched from TMDB but isn't
    // needed for the grab flow (Torznab searches by title + category, not by DB id)
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

// "Bridged" items = monitored items that have a tmdb_id, meaning they arrived via request
// approval rather than being added manually through the admin automation page.
// The tmdb_id field in the return shape is redundant with item.tmdb_id but makes it explicit
// that callers should use it as the TMDB identifier.
export function findAllBridgedItems(): Array<{ item: MonitoredItem; tmdb_id: number }> {
  const db = getDb()
  const rows = db
    .prepare(
      'SELECT * FROM monitored_items WHERE tmdb_id IS NOT NULL ORDER BY created_at DESC'
    )
    .all() as MonitoredItem[]

  return rows.map((item) => ({ item, tmdb_id: item.tmdb_id as number }))
}
