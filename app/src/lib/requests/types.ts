// Shared types for the native request system (Phase 7 independence build).
// These replace Seerr's request model; rows live in the media_requests SQLite table.

// 'expired' is set by the auto-delete job after a quick request's 48h window elapses.
// 'available' is set externally when the media server confirms the item is playable.
export type RequestStatus = 'pending' | 'approved' | 'declined' | 'available' | 'expired'

// 'quick' (48hr retention): auto-approved only when request_method is also 'auto-pick'.
// 'longterm': always goes to admin queue regardless of request_method.
export type RequestType = 'quick' | 'longterm'

// 'auto-pick': system selects the best available release automatically.
// 'interactive': user hand-picked a specific release (stored in preferred_release).
export type RequestMethod = 'auto-pick' | 'interactive'

export type RequestMediaType = 'movie' | 'tv'

export interface NativeRequest {
  id: number
  user_id: string
  tmdb_id: number
  media_type: RequestMediaType
  title: string
  year: number | null
  poster_path: string | null
  overview: string | null
  seasons: string | null       // JSON: number[] or null
  status: RequestStatus
  request_type: RequestType
  // 'auto-pick' = system picks best release; 'interactive' = user pre-selected a release.
  request_method: RequestMethod
  // ISO 639-1 language code or 'any'. Hard constraint on the auto-pick path; 'any' disables it.
  language: string
  // SQLite has no boolean — 0/1 integer; truthy check works normally in JS.
  auto_approved: number
  // Unix ms timestamp; null for longterm requests that are never auto-deleted.
  auto_delete_at: number | null
  available_at: number | null
  // JSON-encoded release the user pre-selected in the torrent picker modal (nullable).
  preferred_release: string | null
  created_at: number           // Unix ms
  updated_at: number
  // Series scope — which portion of the TV series to request/grab.
  // 'full': whole series; 'seasons': specific season numbers;
  // 'episodes': specific individual episodes; 'movie': default for movies.
  scopeType?: 'full' | 'seasons' | 'episodes' | 'movie'
  // When scopeType='seasons': JSON-encoded number[] of season numbers
  scopeSeasons?: number[]
  // When scopeType='episodes': JSON-encoded Array<{s,e}> of episode refs
  scopeEpisodes?: Array<{ s: number; e: number }>
  // true = continue watching for new episodes after the initial grab
  monitorFuture?: boolean
}

// Parsed form of the preferred_release JSON blob stored on NativeRequest.
export interface PreferredRelease {
  magnetUrl: string
  downloadUrl: string
  infoHash: string
  indexerName: string
  releaseTitle: string
  seeders: number
  size: number
}

// Used for all list/detail responses so callers never need a separate join query.
export interface NativeRequestWithUser extends NativeRequest {
  username: string             // joined from users table
}
