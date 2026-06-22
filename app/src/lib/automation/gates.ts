/**
 * Decision gate-chain (feature 1).
 *
 * A release is evaluated in two stages now, mirroring Sonarr/Radarr's design:
 *
 *   1. HARD GATES (this module) — pass/fail conditions that make a release ungrabbable
 *      regardless of quality: it's blocklisted, dead (below the seed floor), a "sample",
 *      or absurdly oversized. A gated release is NEVER auto-grabbed and carries a list of
 *      machine reasons so the UI can say "why didn't this download".
 *   2. SOFT SCORE (grabber.ts / quality.ts) — among the releases that PASS the gates, rank
 *      by quality profile + custom formats + seeds + language preference.
 *
 * Gates run before scoring. The interactive admin picker still lists gated releases (with
 * their reasons) and the admin can override-grab any of them; only the AUTO path excludes them.
 *
 * Gate thresholds are tunable at runtime via app_settings (read each search, no redeploy):
 *   gate_min_seeders        (default 1)
 *   gate_max_size_movie_gb  (default 100)
 *   gate_max_size_tv_gb     (default 200)
 * A threshold of 0 for either max-size disables that cap.
 */

import { getDb } from '@/lib/db/index'
import { getSetting } from '@/lib/settings'
import type { TorznabResult } from '@/lib/indexer/types'
import type { MediaType } from './types'

// Machine-readable gate failure reasons. Order is the evaluation order.
export type GateReason = 'blocklisted' | 'dead' | 'sample' | 'oversize'

// Human labels for the UI — keep in sync with GateReason.
export const GATE_REASON_LABELS: Record<GateReason, string> = {
  blocklisted: 'Blocklisted (previously failed)',
  dead: 'No seeders',
  sample: 'Sample file',
  oversize: 'Exceeds max size',
}

export interface GateConfig {
  minSeeders: number
  // 0 = no size cap
  maxSizeBytes: number
}

const GB = 1024 ** 3
const DEFAULT_MIN_SEEDERS = 1
const DEFAULT_MAX_SIZE_MOVIE_GB = 100
const DEFAULT_MAX_SIZE_TV_GB = 200

function intSetting(key: string, def: number): number {
  const raw = parseInt(getSetting(key, String(def)), 10)
  // Allow 0 (used to disable size caps); reject only NaN / negatives.
  return Number.isFinite(raw) && raw >= 0 ? raw : def
}

export function getGateConfig(type: MediaType): GateConfig {
  const minSeeders = intSetting('gate_min_seeders', DEFAULT_MIN_SEEDERS)
  const maxGb =
    type === 'movie'
      ? intSetting('gate_max_size_movie_gb', DEFAULT_MAX_SIZE_MOVIE_GB)
      : intSetting('gate_max_size_tv_gb', DEFAULT_MAX_SIZE_TV_GB)
  return { minSeeders, maxSizeBytes: maxGb > 0 ? maxGb * GB : 0 }
}

// "sample" as a whole token (delimited by non-letters or string ends) so it matches
// "Movie.2020.SAMPLE.mkv" / "[sample]" but not "Resample" or a group named "EXAMPLE".
const SAMPLE_RE = /(?:^|[^a-z])sample(?:[^a-z]|$)/i

/**
 * Run every hard gate against one release. Returns the list of reasons it failed (empty = passed).
 * `blocked` is a pre-loaded Set of lowercased blocklisted info hashes so the per-candidate check
 * is O(1) and the DB is hit once per search, not once per candidate.
 */
export function evaluateGates(
  result: TorznabResult,
  config: GateConfig,
  blocked: Set<string>,
): GateReason[] {
  const reasons: GateReason[] = []

  if (result.infoHash && blocked.has(result.infoHash.toLowerCase())) reasons.push('blocklisted')
  if ((result.seeders ?? 0) < config.minSeeders) reasons.push('dead')
  if (SAMPLE_RE.test(result.title)) reasons.push('sample')
  if (config.maxSizeBytes > 0 && result.size > 0 && result.size > config.maxSizeBytes) {
    reasons.push('oversize')
  }

  return reasons
}

/** Stable identity for a candidate across the passing/gated split (infoHash, title fallback). */
export function gateKey(r: TorznabResult): string {
  return r.infoHash || r.title
}

/**
 * Split a candidate list into the releases that PASS every hard gate and a map of the rest
 * keyed by gateKey() → their failure reasons. Loads the gate config + blocklist once, so the
 * caller doesn't repeat that work per candidate. `blocked` may be passed to share one load
 * across several partitions in the same request.
 */
export function partitionByGates(
  results: TorznabResult[],
  type: MediaType,
  blocked?: Set<string>,
): { passing: TorznabResult[]; gatesByKey: Map<string, GateReason[]> } {
  const config = getGateConfig(type)
  const block = blocked ?? loadBlocklist()
  const passing: TorznabResult[] = []
  const gatesByKey = new Map<string, GateReason[]>()
  for (const r of results) {
    const reasons = evaluateGates(r, config, block)
    if (reasons.length === 0) passing.push(r)
    else gatesByKey.set(gateKey(r), reasons)
  }
  return { passing, gatesByKey }
}

// ---------------------------------------------------------------------------
// Blocklist — releases that should never be (auto-)grabbed again.
// Populated when a grab demonstrably fails: the metadata reaper removes a dead
// stuck torrent (its claimed seeds never materialised), or an admin blocks a hash.
// ---------------------------------------------------------------------------

export interface BlocklistRow {
  info_hash: string
  title: string | null
  reason: string | null
  blocked_at: number
}

/** All blocklisted hashes, lowercased, for an O(1) per-candidate gate check. */
export function loadBlocklist(): Set<string> {
  const rows = getDb().prepare('SELECT info_hash FROM grab_blocklist').all() as {
    info_hash: string
  }[]
  return new Set(rows.map((r) => r.info_hash.toLowerCase()))
}

export function isBlocklisted(infoHash: string): boolean {
  if (!infoHash) return false
  const row = getDb()
    .prepare('SELECT 1 FROM grab_blocklist WHERE info_hash = ?')
    .get(infoHash.toLowerCase())
  return row !== undefined
}

/** Idempotent — re-blocking an existing hash just refreshes the title/reason/timestamp. */
export function addToBlocklist(infoHash: string, title: string | null, reason: string): void {
  if (!infoHash) return
  getDb()
    .prepare(
      `INSERT INTO grab_blocklist (info_hash, title, reason, blocked_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(info_hash) DO UPDATE SET title = excluded.title, reason = excluded.reason, blocked_at = excluded.blocked_at`,
    )
    .run(infoHash.toLowerCase(), title, reason, Date.now())
}

export function removeFromBlocklist(infoHash: string): boolean {
  const res = getDb()
    .prepare('DELETE FROM grab_blocklist WHERE info_hash = ?')
    .run(infoHash.toLowerCase())
  return res.changes > 0
}

export function getBlocklist(): BlocklistRow[] {
  return getDb()
    .prepare('SELECT info_hash, title, reason, blocked_at FROM grab_blocklist ORDER BY blocked_at DESC')
    .all() as BlocklistRow[]
}
