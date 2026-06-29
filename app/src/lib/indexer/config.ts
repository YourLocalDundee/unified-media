// SQLite CRUD layer for the `indexers` table in unified.db.
// Indexers are configured via the /admin/indexers UI and stored locally —
// they are not synced from Prowlarr. enabled is stored as 0|1 (SQLite boolean).
import { getDb } from '@/lib/db/index'
import type { Indexer } from './types'

// S4: the `api_key` is a private-tracker passkey and must never reach the browser. Server-side
// callers (the search fan-out in index.ts, the test/activate routes) read the un-redacted getters
// below; anything returned to a client must go through redactIndexer first. The admin UI only needs
// to know whether a key is set (has_api_key), not its value.
export type RedactedIndexer = Omit<Indexer, 'api_key'> & { has_api_key: boolean }

export function redactIndexer(indexer: Indexer): RedactedIndexer {
  const { api_key, ...rest } = indexer
  return { ...rest, has_api_key: typeof api_key === 'string' && api_key.length > 0 }
}

export function getAllIndexers(): Indexer[] {
  return getDb()
    .prepare('SELECT * FROM indexers ORDER BY name')
    .all() as Indexer[]
}

export function getEnabledIndexers(): Indexer[] {
  return getDb()
    .prepare('SELECT * FROM indexers WHERE enabled = 1 ORDER BY name')
    .all() as Indexer[]
}

// ── Health / backoff ──────────────────────────────────────────────────────────
// One flaky tracker should not degrade every search, so a torznab indexer that fails
// HEALTH_FAILURE_THRESHOLD searches in a row enters exponential backoff and is skipped by the
// search fan-out until disabled_until passes. Any success resets it immediately. The admin
// `enabled` flag is independent — backoff is an automatic, self-healing layer on top of it.
const HEALTH_FAILURE_THRESHOLD = 3
const HEALTH_BASE_BACKOFF_MS = 10 * 60 * 1000        // 10 min after the threshold is hit
const HEALTH_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000     // capped at 6 h

// Per-indexer request-rate limiting (account safety). An in-memory token bucket per indexer id, refilled
// at rate_limit_per_min tokens/min (burst = one minute's worth). 0 = unlimited. This is a soft local cap
// to avoid tripping a private tracker's hourly query limit; a throttled search just skips that indexer for
// the tick (not a failure → no backoff). In-memory is fine: the cap is per-process and resets on restart.
interface RateBucket { tokens: number; lastRefill: number }
const rateBuckets = new Map<number, RateBucket>()

export function tryConsumeIndexerToken(id: number, perMin: number): boolean {
  if (!perMin || perMin <= 0) return true // unlimited
  const now = Date.now()
  let b = rateBuckets.get(id)
  if (!b) {
    b = { tokens: perMin, lastRefill: now }
    rateBuckets.set(id, b)
  } else {
    const refill = ((now - b.lastRefill) / 60_000) * perMin
    if (refill > 0) {
      b.tokens = Math.min(perMin, b.tokens + refill)
      b.lastRefill = now
    }
  }
  if (b.tokens >= 1) {
    b.tokens -= 1
    return true
  }
  return false
}

/** Enabled indexers that are not currently in backoff — the set the search fan-out queries. */
export function getSearchableIndexers(): Indexer[] {
  return getDb()
    .prepare('SELECT * FROM indexers WHERE enabled = 1 AND (disabled_until IS NULL OR disabled_until <= ?) ORDER BY name')
    .all(Date.now()) as Indexer[]
}

/**
 * Record the outcome of a search against an indexer. A success clears the failure count and any
 * backoff; a failure increments the count and, at/after the threshold, sets an exponentially growing
 * backoff window (capped). Also updates health_status/last_health_check so the admin UI reflects it.
 */
export function recordIndexerResult(id: number, ok: boolean): void {
  const db = getDb()
  if (ok) {
    db.prepare(
      'UPDATE indexers SET consecutive_failures = 0, disabled_until = NULL, health_status = ?, last_health_check = ? WHERE id = ?',
    ).run('ok', Date.now(), id)
    return
  }
  const row = db.prepare('SELECT consecutive_failures FROM indexers WHERE id = ?').get(id) as
    | { consecutive_failures: number }
    | undefined
  const failures = (row?.consecutive_failures ?? 0) + 1
  let disabledUntil: number | null = null
  if (failures >= HEALTH_FAILURE_THRESHOLD) {
    const backoff = Math.min(
      HEALTH_BASE_BACKOFF_MS * 2 ** (failures - HEALTH_FAILURE_THRESHOLD),
      HEALTH_MAX_BACKOFF_MS,
    )
    disabledUntil = Date.now() + backoff
  }
  db.prepare(
    'UPDATE indexers SET consecutive_failures = ?, disabled_until = ?, health_status = ?, last_health_check = ? WHERE id = ?',
  ).run(failures, disabledUntil, 'error', Date.now(), id)
}

export function getIndexerById(id: number): Indexer | undefined {
  return getDb()
    .prepare('SELECT * FROM indexers WHERE id = ?')
    .get(id) as Indexer | undefined
}

// ── Daily query/grab counters ─────────────────────────────────────────────────

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

export function checkAndResetDailyStats(id: number): void {
  const db = getDb()
  const row = db.prepare('SELECT daily_stats_date FROM indexers WHERE id = ?').get(id) as { daily_stats_date: string } | undefined
  if (!row || row.daily_stats_date === getTodayUtc()) return
  db.prepare('UPDATE indexers SET daily_query_count = 0, daily_grab_count = 0, daily_stats_date = ? WHERE id = ?').run(getTodayUtc(), id)
}

export function checkQueryLimit(id: number): boolean {
  checkAndResetDailyStats(id)
  const row = getDb().prepare('SELECT rate_limit_queries_per_day, daily_query_count FROM indexers WHERE id = ?').get(id) as { rate_limit_queries_per_day: number; daily_query_count: number } | undefined
  if (!row) return true
  return row.rate_limit_queries_per_day === 0 || row.daily_query_count < row.rate_limit_queries_per_day
}

export function incrementDailyQueryCount(id: number): void {
  getDb().prepare('UPDATE indexers SET daily_query_count = daily_query_count + 1 WHERE id = ?').run(id)
}

export function incrementDailyGrabCount(id: number): void {
  getDb().prepare('UPDATE indexers SET daily_grab_count = daily_grab_count + 1 WHERE id = ?').run(id)
}

export function checkGrabLimit(id: number): boolean {
  checkAndResetDailyStats(id)
  const row = getDb().prepare('SELECT rate_limit_grabs_per_day, daily_grab_count FROM indexers WHERE id = ?').get(id) as { rate_limit_grabs_per_day: number; daily_grab_count: number } | undefined
  if (!row) return true
  return row.rate_limit_grabs_per_day === 0 || row.daily_grab_count < row.rate_limit_grabs_per_day
}

export function createIndexer(data: {
  name: string
  torznab_url: string
  api_key: string
}): Indexer {
  const db = getDb()
  const result = db
    .prepare(
      'INSERT INTO indexers (name, torznab_url, api_key) VALUES (?, ?, ?)'
    )
    .run(data.name, data.torznab_url, data.api_key)
  return db
    .prepare('SELECT * FROM indexers WHERE id = ?')
    .get(result.lastInsertRowid) as Indexer
}

export function updateIndexer(
  id: number,
  data: Partial<{
    name: string
    torznab_url: string
    api_key: string
    enabled: number
    description: string
    base_url: string
    requires_auth: number
    requires_flaresolverr: number
    search_type: string
    pending_credentials: string
    rate_limit_per_min: number
    rate_limit_queries_per_day: number
    rate_limit_grabs_per_day: number
  }>
): Indexer | undefined {
  // Allowlist prevents arbitrary column injection through the dynamic SET clause.
  const allowed = ['name', 'torznab_url', 'api_key', 'enabled', 'description', 'base_url', 'requires_auth', 'requires_flaresolverr', 'search_type', 'pending_credentials', 'rate_limit_per_min', 'rate_limit_queries_per_day', 'rate_limit_grabs_per_day'] as const
  const keys = (Object.keys(data) as (keyof typeof data)[]).filter(k =>
    allowed.includes(k as (typeof allowed)[number])
  )
  if (keys.length === 0) return getIndexerById(id)

  const setClauses = keys.map(k => `${k} = ?`).join(', ')
  const values = keys.map(k => data[k])

  getDb()
    .prepare(`UPDATE indexers SET ${setClauses} WHERE id = ?`)
    .run(...values, id)

  return getIndexerById(id)
}

export function deleteIndexer(id: number): boolean {
  const result = getDb()
    .prepare('DELETE FROM indexers WHERE id = ?')
    .run(id)
  return result.changes > 0
}

export function updateIndexerHealth(
  id: number,
  status: 'ok' | 'error',
  responseTimeMs: number
): void {
  getDb()
    .prepare(
      'UPDATE indexers SET last_health_check = ?, health_status = ? WHERE id = ?'
    )
    .run(Date.now(), status, id)
}

export function getPendingIndexers(): Indexer[] {
  return getDb()
    .prepare('SELECT * FROM indexers WHERE requires_auth = 1 AND enabled = 0 ORDER BY name')
    .all() as Indexer[]
}

export function activateIndexer(id: number, torznab_url: string, api_key: string): void {
  getDb()
    .prepare('UPDATE indexers SET torznab_url = ?, api_key = ?, enabled = 1 WHERE id = ?')
    .run(torznab_url, api_key, id)
}
