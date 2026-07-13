// Types for the native indexer system (Independence Build Phase 1).
// Indexers are stored in the local SQLite DB (unified.db, `indexers` table)
// and queried via the Torznab XML protocol — not through Prowlarr's REST API.
// This allows the app to operate independently of Prowlarr if needed.

export interface Indexer {
  id: number
  name: string
  torznab_url: string
  api_key: string
  enabled: number  // 0 | 1 (SQLite boolean)
  last_health_check: number | null  // Unix ms
  health_status: string | null  // 'ok' | 'error' | null
  // new fields (added in indexer auto-discovery migration)
  requires_auth: number              // 0 | 1
  requires_flaresolverr: number      // 0 | 1
  search_type: string                // 'torznab' | 'yts' | 'eztv' | 'nyaa'
  description: string | null
  pending_credentials: string | null // JSON: { fieldName: label }
  base_url: string | null
  // health/backoff (config.ts: recordIndexerResult / getSearchableIndexers)
  consecutive_failures: number       // failures in a row; 0 after any success
  disabled_until: number | null      // Unix ms; in active backoff while > now (NULL = searchable)
  // per-indexer request-rate cap (searches/min) — account safety. 0 = unlimited.
  rate_limit_per_min: number
  // persistent daily limits (queries and grabs). 0 = unlimited.
  rate_limit_queries_per_day: number
  rate_limit_grabs_per_day: number
  // rolling counters reset each UTC day by checkAndResetDailyStats in config.ts.
  daily_query_count: number
  daily_grab_count: number
  daily_stats_date: string
  // capabilities (Torznab t=caps probe, run as part of testIndexer). JSON: IndexerCategory[].
  // null = never probed, or the indexer's search_type doesn't support caps (yts/eztv/nyaa).
  caps_categories: string | null
  caps_checked_at: number | null // Unix ms
}

// A category (or top-level category with subcats) reported by an indexer's Torznab
// `t=caps` response, e.g. { id: '2000', name: 'Movies', subcats: [{ id: '2010', name: 'Movies/Foreign' }] }.
export interface IndexerCategory {
  id: string
  name: string
  subcats?: { id: string; name: string }[]
}

export interface IndexerDefinition {
  name: string
  description: string
  search_type: string   // 'torznab' or an adapterRegistry key (index.ts) — e.g. 'yts', 'eztv', 'nyaa', 'sukebei'
  base_url: string
  torznab_url: string   // empty string for non-Torznab types
  api_key: string       // empty string if not needed
  requires_auth: boolean
  requires_flaresolverr: boolean
  pending_credentials: Record<string, string> | null  // null = no auth needed
}

export interface TorznabResult {
  title: string
  infoHash: string
  magnetUrl: string
  downloadUrl: string
  size: number       // bytes
  seeders: number
  leechers: number
  indexerName: string
  publishDate: string
  categories: string[]
  imdbId?: string
}

// At least one of q/cats/imdbid should be provided. Torznab ignores params it
// doesn't recognize, so extra fields are safe but wasted network bytes.
export interface TorznabSearchParams {
  q?: string
  cats?: string   // comma-separated Torznab category IDs, e.g. "2000,5000"
  imdbid?: string // e.g. "tt1234567"
  season?: string
  ep?: string
}

export interface IndexerHealth {
  status: 'ok' | 'error'
  responseTimeMs: number
  resultCount?: number
  errorMessage?: string
  categories?: IndexerCategory[]  // parsed from a torznab t=caps response, when available
}
