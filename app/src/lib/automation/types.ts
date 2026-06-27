/**
 * Shared type definitions for the download automation pipeline.
 *
 * Data flows: monitored_items (wanted) → indexer search → qBittorrent grab →
 * media_items availability check → auto-delete for quick requests.
 * These types are shared across monitor, grabber, parser, bridge, and availability modules.
 *
 * All DB-backed interfaces mirror their SQLite column names exactly so rows can be
 * cast directly without a mapping step (better-sqlite3 returns plain objects).
 */

export type MediaType = 'movie' | 'tv'
// 'grabbing' is a transient atomic-claim state (D3) preventing the immediate-grab path and the
// 15-min cron from grabbing the same row twice; 'grabbed' means sent to download client;
// 'imported' means confirmed in media_items table.
// 'failed' is terminal: the reaper sets it after MAX_GRAB_ATTEMPTS reaps leave no healthy
// download, so the grab cron stops re-searching a title with no good release (getWantedItems
// only selects 'wanted', so a 'failed' row is never re-grabbed). Surfaced to the admin queue.
export type ItemStatus = 'wanted' | 'grabbing' | 'grabbed' | 'imported' | 'ignored' | 'failed'
// import_status lives on grab_history, not monitored_items; updated by availability.ts
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
  // SQLite has no boolean type; 0/1 integer is used throughout the codebase
  monitored: number   // 0 | 1
  status: ItemStatus
  created_at: number  // Unix ms
  updated_at: number
  // Series scope — controls which portion of a TV series is grabbed.
  // 'full': whole series (default); 'seasons': specific season numbers;
  // 'episodes': specific individual episodes; 'movie': movies (scope not used).
  scope_type: 'full' | 'seasons' | 'episodes' | 'movie' | null
  // JSON-encoded number[] — season numbers to grab when scope_type='seasons'
  scope_seasons: string | null
  // JSON-encoded Array<{s,e}> — episodes to grab when scope_type='episodes'
  scope_episodes: string | null
  // A6-02 — deterministic dedup discriminator; part of the UNIQUE(tmdb_id,type,scope_key) index.
  // Computed by computeScopeKey() from type + scope_*; never null.
  scope_key: string
  // 1 = continue monitoring and grabbing new episodes as they release
  monitor_future: number | null  // 0 | 1
  // ISO 639-1 language code, or 'any' for no constraint. Passed to grabItem so the
  // background grab cron honors the language chosen at request/grab time.
  language: string
}

export interface QualityProfile {
  id: number
  name: string
  // Stored as JSON in SQLite; must be parsed before use — see parser.scoreRelease
  conditions: string  // JSON-encoded QualityCondition[]
}

export interface QualityCondition {
  type: 'resolution' | 'codec' | 'source'
  value: string
  // If required=true and the release doesn't match, the entire release is rejected (score=null)
  required: boolean
  // If negate=true, the match logic is inverted: a matching release is treated as non-matching.
  // Useful for exclusions: e.g. {type:'source', value:'BluRay REMUX', required:true, negate:true}
  // hard-rejects any REMUX release.
  negate?: boolean
}

export interface GrabHistory {
  id: number
  item_id: number
  indexer: string
  release_title: string
  // info_hash is the torrent infohash; used to correlate with qBittorrent if needed
  info_hash: string
  grabbed_at: number  // Unix ms
  import_status: ImportStatus
}

// Parsed metadata extracted from a scene/P2P release filename by parser.ts
export interface ReleaseMeta {
  resolution: string | null   // '2160p' | '1080p' | '720p' | '480p'
  codec: string | null        // 'x264' | 'x265' | 'HEVC' | 'AVC'
  source: string | null       // 'BluRay' | 'WEB-DL' | 'WEBRip' | 'HDTV' | 'REMUX'
  group: string | null
  season: number | null
  episode: number | null
  // year prefers the LAST match in the filename because scene releases put title year first,
  // then a second year can appear in quality/encode tags
  year: number | null
  parsedTitle: string | null  // cleaned title portion from filename
  // ISO 639-1 language code detected from explicit tags (e.g. 'fr', 'de'), or null if untagged.
  // Absence of a tag is common for English releases and is treated as unknown, not as English.
  language: string | null
}
