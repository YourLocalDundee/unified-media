export type MediaItemType = 'movie' | 'episode' | 'series' | 'season'

export interface MediaItem {
  id: string
  type: MediaItemType
  title: string
  sort_title: string | null
  year: number | null
  overview: string | null
  runtime_ticks: number | null
  tmdb_id: number | null
  tvdb_id: number | null
  imdb_id: string | null
  series_id: string | null
  season_number: number | null
  episode_number: number | null
  episode_title: string | null
  file_path: string | null
  poster_path: string | null
  backdrop_path: string | null
  added_at: number
  updated_at: number
  scanned_at: number | null
}

export interface WatchState {
  id: number
  user_id: string
  media_id: string
  position_ticks: number
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
  isEpisode: boolean
}

export interface PlaybackData {
  playSessionId: string
  streamUrl: string
  isHls: boolean
  mediaSourceId: string
  itemId: string
  subtitleStreams: { index: number; language: string; title: string; isDefault: boolean }[]
  audioStreams: { index: number; language: string; title: string; channels: number; isDefault: boolean }[]
  defaultAudioIndex: number
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
  hlsTranscodeUrl: string
  availableQualities: import('@/components/player/types').QualityOption[]
  progressApiUrl?: string
  subtitleApiBase?: string      // base path for subtitle proxy, e.g. /api/media/subtitles
  nextEpisodeApiBase?: string   // base path for next-episode lookup, e.g. /api/media/series
}
