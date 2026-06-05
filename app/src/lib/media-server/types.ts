/**
 * Shared type definitions for the native media server (Phase 5).
 * All four row types live in a single `media_items` table — type discriminates them.
 * Ticks are 100-nanosecond units (multiply seconds by 10_000_000) to match the
 * Jellyfin wire format so the same player components work with both backends.
 */

export type MediaItemType = 'movie' | 'episode' | 'series' | 'season'

export interface MediaItem {
  id: string
  type: MediaItemType
  title: string
  sort_title: string | null
  year: number | null
  overview: string | null
  // Duration stored in 100-ns ticks so the player doesn't need unit conversion
  runtime_ticks: number | null
  tmdb_id: number | null
  tvdb_id: number | null
  imdb_id: string | null
  // Foreign key into media_items (type='series'); null for movies and series rows themselves
  series_id: string | null
  season_number: number | null
  episode_number: number | null
  episode_title: string | null
  // Null for series/season stubs — only episodes and movies have an actual file on disk
  file_path: string | null
  poster_path: string | null
  backdrop_path: string | null
  // Genre names from TMDB; stored as JSON text in SQLite, parsed on read
  genres: string[] | null
  // Unix epoch ms; added_at is set once, updated_at reflects last enrichment or re-scan
  added_at: number
  updated_at: number
  scanned_at: number | null
}

export interface WatchState {
  id: number
  user_id: string
  media_id: string
  // Resume position in 100-ns ticks; 0 means not started
  position_ticks: number
  // SQLite stores booleans as integers; 0 = in-progress, 1 = fully played
  played: number
  play_count: number
  last_played: number | null
  updated_at: number
}

export interface ProbeStream {
  index: number
  codec: string
  language: string
  title: string
  channels: number   // only meaningful for audio; 0 for subtitle/video
  isDefault: boolean
  isForced: boolean
}

export interface ProbeResult {
  durationSeconds: number
  width: number
  height: number
  videoCodec: string | null
  audioCodec: string | null
  audioChannels: number
  bitrate: number
  fileSizeBytes: number
  audioStreams: ProbeStream[]
  subtitleStreams: ProbeStream[]
}

export interface ParsedFilename {
  title: string
  episodeTitle: string | null
  year: number | null
  season: number | null
  episode: number | null
  // True when the filename matched an episode pattern (not a movie fallback)
  isEpisode: boolean
}

export interface PlaybackData {
  playSessionId: string
  streamUrl: string
  // False = direct byte-range stream; true = HLS manifest (.m3u8)
  isHls: boolean
  mediaSourceId: string
  itemId: string
  subtitleStreams: { index: number; language: string; title: string; isDefault: boolean }[]
  audioStreams: { index: number; language: string; title: string; channels: number; isDefault: boolean }[]
  defaultAudioIndex: number
  // -1 signals "no default subtitle" (player should not auto-enable subtitles)
  defaultSubtitleIndex: number
  itemTitle: string
  seriesTitle?: string
  seriesId?: string
  seasonEpisode?: string
  runTimeTicks: number
  resumePositionTicks: number
  chapters?: Array<{ name: string; startPositionTicks: number }>
  nativeWidth: number
  nativeHeight: number
  // Always populated so the quality selector can construct HLS URLs even for direct-play content
  hlsTranscodeUrl: string
  availableQualities: import('@/components/player/types').QualityOption[]
  progressApiUrl?: string
  subtitleApiBase?: string      // base path for subtitle proxy, e.g. /api/media/subtitles
  nextEpisodeApiBase?: string   // base path for next-episode lookup, e.g. /api/media/series
}
