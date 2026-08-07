/**
 * A6-02 — scope-aware dedup key for monitored_items.
 *
 * monitored_items is uniquely keyed by (tmdb_id, type, scope_key). A bare (tmdb_id, type) key
 * cannot be used because the v0.9.7 season/episode fan-out legitimately creates several rows per
 * (tmdb_id, type) — one per requested season or episode. scope_key collapses identical requests
 * (two users asking for "Season 1") onto one row while keeping genuinely different scopes apart.
 *
 * The key is ALWAYS a non-empty string. That matters: SQLite treats NULLs as distinct in a UNIQUE
 * index, so if we keyed on the raw scope_seasons/scope_episodes columns (NULL for full series and
 * movies — the common case) the index would never dedup them. A computed non-null key fixes that.
 *
 * Determinism, not human-readability, is the contract: the same logical scope must always produce
 * the same string. Inputs may be arrays (createItem call sites) or JSON strings (DB rows), so both
 * are accepted.
 */

function toArray(value: unknown): unknown[] {
  if (value == null) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function computeScopeKey(
  type: 'movie' | 'tv',
  scopeType?: string | null,
  scopeSeasons?: string | number[] | null,
  scopeEpisodes?: string | Array<{ s: number; e: number }> | null,
): string {
  if (type === 'movie') return 'movie'

  const st = scopeType ?? 'full'
  if (st === 'movie') return 'movie'

  if (st === 'seasons') {
    const seasons = toArray(scopeSeasons)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b)
    return 's:' + seasons.join(',')
  }

  if (st === 'episodes') {
    const tokens = toArray(scopeEpisodes)
      .map((e) => {
        const ep = e as { s?: number; e?: number }
        return `${Number(ep.s)}x${Number(ep.e)}`
      })
      .sort()
    return 'e:' + tokens.join(',')
  }

  return 'full'
}
