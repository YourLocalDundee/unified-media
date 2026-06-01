export type MediaType = 'movie' | 'tv'
export type ItemStatus = 'wanted' | 'grabbed' | 'imported' | 'ignored'
export type ImportStatus = 'pending' | 'imported' | 'failed'

export interface MonitoredItem {
  id: number
  tmdb_id: number | null
  tvdb_id: number | null
  type: MediaType
  title: string
  year: number | null
  quality_profile_id: number
  root_path: string
  monitored: number   // 0 | 1
  status: ItemStatus
  created_at: number  // Unix ms
  updated_at: number
}

export interface QualityProfile {
  id: number
  name: string
  conditions: string  // JSON-encoded QualityCondition[]
}

export interface QualityCondition {
  type: 'resolution' | 'codec' | 'source'
  value: string
  required: boolean
}

export interface GrabHistory {
  id: number
  item_id: number
  indexer: string
  release_title: string
  info_hash: string
  grabbed_at: number  // Unix ms
  import_status: ImportStatus
}

export interface ReleaseMeta {
  resolution: string | null   // '2160p' | '1080p' | '720p' | '480p'
  codec: string | null        // 'x264' | 'x265' | 'HEVC' | 'AVC'
  source: string | null       // 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'REMUX'
  group: string | null
  season: number | null
  episode: number | null
  year: number | null
  parsedTitle: string | null  // cleaned title portion from filename
}
