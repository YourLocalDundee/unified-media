// Types for the native subtitle management system (Independence Build Phase 4).
// Subtitle wants are stored in unified.db (`subtitle_wants` table).
// Downloads go through the OpenSubtitles v3 REST API (free tier: 5/day).
// The workflow: scanner creates 'wanted' rows → downloader processes them →
// status transitions to 'downloaded', 'skipped', or 'failed'.

export type SubtitleStatus = 'wanted' | 'downloaded' | 'skipped' | 'failed'

export interface SubtitleWant {
  id: number
  jellyfin_item_id: string
  jellyfin_item_type: string        // 'Movie' | 'Episode'
  title: string
  imdb_id: string | null
  media_path: string | null         // absolute path to the media file on disk
  language: string                  // 'en', 'es', etc.
  forced: number                    // 0 | 1
  hi: number                        // 0 | 1 (hearing impaired)
  status: SubtitleStatus
  subtitle_file_id: number | null   // OpenSubtitles file_id
  subtitle_path: string | null      // path where .srt was written
  created_at: number
  updated_at: number
}

// OpenSubtitles v3 API shapes
export interface OSUploader {
  uploader_id: number
  name: string
  rank: string
}

export interface OSFeatureDetails {
  feature_id: number
  feature_type: string
  year: number | null
  title: string
  movie_name: string
  imdb_id: number
  tmdb_id: number
}

export interface OSFile {
  file_id: number
  cd_number: number
  file_name: string
}

export interface OSSubtitleAttributes {
  subtitle_id: string
  language: string
  download_count: number
  hearing_impaired: boolean
  hd: boolean
  format: string              // 'srt' | 'ass' | 'vtt' etc.
  fps: number
  votes: number
  ratings: number
  from_trusted: boolean
  foreign_parts_only: boolean
  ai_translated: boolean
  machine_translated: boolean
  upload_date: string
  release: string
  comments: string
  uploader: OSUploader
  feature_details: OSFeatureDetails
  url: string
  files: OSFile[]
}

export interface OSSubtitle {
  id: string
  type: string
  attributes: OSSubtitleAttributes
}

export interface OSSearchResponse {
  data: OSSubtitle[]
  total_count: number
  page: number
  per_page: number
}

// Response from POST /download. `remaining` is the daily quota left after this
// request. The free tier resets at midnight UTC (reset_time_utc). When remaining
// hits 0 the downloader logs a warning and the current run stops downloading.
export interface OSDownloadResponse {
  link: string
  file_name: string
  requests: number
  remaining: number             // downloads remaining today
  message: string
  reset_time: string
  reset_time_utc: string
}

// Response from POST /login. The `token` is a JWT (valid ~24h) that must be sent as
// `Authorization: Bearer <token>` on download/infos requests to draw on the logged-in
// user's quota (VIP 1000/day) rather than the anonymous Api-Key bucket (100/day).
// `base_url` is the host to direct subsequent authenticated requests at (VIP users may
// be routed to a dedicated host).
export interface OSLoginResponse {
  user: {
    allowed_downloads: number
    allowed_translations: number
    level: string
    user_id: number
    ext_installed: boolean
    vip: boolean
  }
  token: string
  status: number
  base_url?: string
}

// Response from GET /infos/user (the authoritative, live quota for the logged-in user).
export interface OSUserInfo {
  allowed_downloads: number
  allowed_translations: number
  level: string
  user_id: number
  ext_installed: boolean
  vip: boolean
  downloads_count: number
  remaining_downloads: number
  username?: string
}

// imdb_id must be the numeric portion only — strip the "tt" prefix before passing.
// The OpenSubtitles API rejects IDs with the prefix.
export interface SubtitleSearchParams {
  imdb_id?: string     // numeric IMDB ID without "tt" prefix, e.g. "1234567"
  tmdb_id?: number
  query?: string       // title fallback
  languages: string    // comma-separated, e.g. "en,es"
  type: 'movie' | 'episode'
  hearing_impaired?: 'include' | 'exclude' | 'only'
}
