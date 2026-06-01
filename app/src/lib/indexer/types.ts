export interface Indexer {
  id: number
  name: string
  torznab_url: string
  api_key: string
  enabled: number  // 0 | 1 (SQLite boolean)
  last_health_check: number | null  // Unix ms
  health_status: string | null  // 'ok' | 'error' | null
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
}
