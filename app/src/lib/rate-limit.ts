/**
 * Durable fixed-window rate limiter, backed by the `rate_limits` SQLite table.
 *
 * Previously this was a per-process `Map` that reset on every restart/deploy and was
 * never shared across instances (A1-005) — so a deploy wiped every active limit and the
 * advertised "10/15min" brute-force protection was soft. Buckets now persist in SQLite,
 * so the window survives restarts and (with WAL) is shared by any instance on the same
 * DB. The signature is unchanged, so every call site is untouched. better-sqlite3 is
 * synchronous, so this stays synchronous too.
 */
import { getDb } from './db/index'

interface BucketRow { count: number; reset_at: number }
type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number }

// Expired buckets are swept opportunistically and throttled, so we don't scan the
// table on every single call.
let lastCleanup = 0
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const db = getDb()
  const now = Date.now()

  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = now
    try { db.prepare('DELETE FROM rate_limits WHERE reset_at < ?').run(now) } catch { /* best effort */ }
  }

  // Read-modify-write inside a transaction so two writers can't both decide the
  // window is fresh and reset each other's count.
  const apply = db.transaction((): RateLimitResult => {
    const row = db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').get(key) as BucketRow | undefined

    // No bucket yet, or the previous window has elapsed → start a fresh window.
    if (!row || row.reset_at < now) {
      const resetAt = now + windowMs
      db.prepare(
        `INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, reset_at = excluded.reset_at`
      ).run(key, resetAt)
      return { allowed: true, remaining: max - 1, resetAt }
    }

    const count = row.count + 1
    db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').run(count, key)
    return { allowed: count <= max, remaining: Math.max(0, max - count), resetAt: row.reset_at }
  })

  return apply()
}
