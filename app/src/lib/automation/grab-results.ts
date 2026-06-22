import { getDb } from '@/lib/db/index'
import type { TorznabResult } from '@/lib/indexer/types'
import type { MonitoredItem } from './types'
import type { GateReason } from './gates'

// A candidate result with its computed quality score attached
export interface ScoredCandidate {
  result: TorznabResult
  score: number        // from scoreRelease(); 0 if 'Any' profile; null is converted to -1
  selected: boolean    // true only for the result that was sent to qBittorrent
  // Hard-gate failures (feature 1). Empty/absent = passed all gates and is auto-grabbable.
  // A non-empty list means auto-pick skipped it; the interactive picker still lists it with
  // these reasons so the admin can see "why didn't this download" and override-grab anyway.
  gates?: GateReason[]
}

export type SkipReason =
  | 'no_results'        // indexers returned zero hits
  | 'scope_mismatch'    // hits found, none matched the scope filter (S01E05, season pack)
  | 'language_mismatch' // (legacy) scope-matched hits exist, none passed the language constraint
  | 'quality_reject'    // (legacy) language passed, none survived the quality profile conditions
  | 'no_seeders'        // scope-matched hits exist but every one is dead (0 seeds) — auto won't grab
  | 'gated'             // scope-matched hits exist but every one failed a hard gate (sample/oversize/blocklist/dead)
  | 'degenerate_scope'  // scope columns empty/malformed — bailed before querying indexers

export interface GrabResultRow {
  id: number
  monitored_item_id: number
  searched_at: number
  candidates: ScoredCandidate[]  // parsed from JSON
  selected_hash: string | null
  total_found: number
  skip_reason: SkipReason | null  // null = successful grab
}

export function recordGrabResults(
  monitoredItemId: number,
  candidates: ScoredCandidate[],
  selectedHash: string | null,
  skipReason?: SkipReason,
): number {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO grab_results (monitored_item_id, searched_at, candidates, selected_hash, total_found, skip_reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    monitoredItemId,
    Date.now(),
    JSON.stringify(candidates),
    selectedHash,
    candidates.length,
    skipReason ?? null,
  )
  return Number(result.lastInsertRowid)
}

export function getLatestGrabResults(monitoredItemId: number): GrabResultRow | undefined {
  const row = getDb().prepare(`
    SELECT * FROM grab_results
    WHERE monitored_item_id = ?
    ORDER BY searched_at DESC
    LIMIT 1
  `).get(monitoredItemId) as Omit<GrabResultRow, 'candidates'> & { candidates: string } | undefined
  if (!row) return undefined
  return {
    ...row,
    candidates: JSON.parse(row.candidates) as ScoredCandidate[],
  }
}

// Resolve the single most relevant monitored_item for a request.
//
// A TV request can fan out to many monitored_items: a leftover 'full'-scope series container
// (often left 'imported' from an earlier full-series grab) PLUS one episode row per episode of
// an arc grab. The old "ORDER BY id ASC LIMIT 1" returned the oldest row — almost always that
// stale 'full' container, whose grab_results come from a title-only "One Piece" search with no
// episode or year constraint (311 candidates, every score tied, the newest episode auto-picked).
//
// Rank instead by (status, scope) so an actively-wanted, narrowly-scoped row wins:
//   status: wanted > grabbing > grabbed > imported > ignored
//   scope:  episodes > seasons > full/movie
// This makes the displayed candidates and the re-search target reflect what was actually
// requested (e.g. the arc's episode 422), not a stale whole-series pool. Used by BOTH the
// grab-results display route and the /grab re-search route so they never disagree.
const STATUS_RANK: Record<string, number> = { wanted: 0, grabbing: 1, grabbed: 2, imported: 3, ignored: 4 }
const SCOPE_RANK: Record<string, number> = { episodes: 0, seasons: 1, full: 2, movie: 2 }

export function resolveMonitoredItemForRequest(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): MonitoredItem | undefined {
  const items = getDb().prepare(
    `SELECT * FROM monitored_items WHERE tmdb_id = ? AND type = ?`
  ).all(tmdbId, mediaType === 'tv' ? 'tv' : 'movie') as MonitoredItem[]
  if (items.length === 0) return undefined

  return [...items].sort((a, b) => {
    const sa = STATUS_RANK[a.status] ?? 9
    const sb = STATUS_RANK[b.status] ?? 9
    if (sa !== sb) return sa - sb
    const ca = SCOPE_RANK[a.scope_type ?? 'full'] ?? 9
    const cb = SCOPE_RANK[b.scope_type ?? 'full'] ?? 9
    if (ca !== cb) return ca - cb
    return a.id - b.id // stable tie-break: oldest of the equally-ranked rows
  })[0]
}

// Get the monitored_item_id for a request — thin wrapper over resolveMonitoredItemForRequest
// so the grab-results display and the re-search route resolve to the same item.
export function getMonitoredItemIdForRequest(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): number | null {
  return resolveMonitoredItemForRequest(tmdbId, mediaType)?.id ?? null
}
