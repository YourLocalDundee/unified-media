import { getDb } from '@/lib/db/index'
import type { TorznabResult } from '@/lib/indexer/types'

// A candidate result with its computed quality score attached
export interface ScoredCandidate {
  result: TorznabResult
  score: number        // from scoreRelease(); 0 if 'Any' profile; null is converted to -1
  selected: boolean    // true only for the result that was sent to qBittorrent
}

export interface GrabResultRow {
  id: number
  monitored_item_id: number
  searched_at: number
  candidates: ScoredCandidate[]  // parsed from JSON
  selected_hash: string | null
  total_found: number
}

export function recordGrabResults(
  monitoredItemId: number,
  candidates: ScoredCandidate[],
  selectedHash: string | null,
): number {
  const db = getDb()
  const result = db.prepare(`
    INSERT INTO grab_results (monitored_item_id, searched_at, candidates, selected_hash, total_found)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    monitoredItemId,
    Date.now(),
    JSON.stringify(candidates),
    selectedHash,
    candidates.length,
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

// Get the monitored_item_id for a request by joining through tmdb_id + type.
// Returns null if no monitored_item exists for this request.
// A6-10: ORDER BY id makes the pick deterministic. With the A6-02 unique index there is at most
// one row per (tmdb_id, type, scope_key); multiple scopes can still exist for one tmdb_id (e.g. a
// full-series item plus episode fan-out rows), so the oldest row (the one created when the request
// was first made) is the stable choice rather than an arbitrary LIMIT 1.
export function getMonitoredItemIdForRequest(
  tmdbId: number,
  mediaType: 'movie' | 'tv',
): number | null {
  const row = getDb().prepare(
    `SELECT id FROM monitored_items WHERE tmdb_id = ? AND type = ? ORDER BY id ASC LIMIT 1`
  ).get(tmdbId, mediaType === 'tv' ? 'tv' : 'movie') as { id: number } | undefined
  return row?.id ?? null
}
