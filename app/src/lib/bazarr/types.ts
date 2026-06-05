// TypeScript interfaces for the Bazarr REST API.
// Bazarr runs with network_mode: host — reached via 192.168.0.50:6767.
// Auth is a static X-API-KEY header (note uppercase KEY vs *arr services).
// Bazarr wraps most list responses in a { data: T[] } envelope.

export interface BazarrLanguage {
  name: string
  code2: string
  code3: string
}

export interface BazarrSubtitleFile {
  name: string
  code2: string
  code3: string
  path: string
  forced: boolean
  hi: boolean
  file_size: number
}

export interface BazarrMissingSubtitle {
  name: string
  code2: string
  code3: string
  forced: boolean
  hi: boolean
}

export interface BazarrSeries {
  sonarrSeriesId: number
  title: string
  year: string
  path: string
  overview?: string
  poster: string
  fanart: string
  audio_language: BazarrLanguage[]
  monitored: boolean
  ended: boolean
  episodeFileCount: number
  episodeMissingCount: number
  profileId: number
  tvdbId: number
  imdbId?: string
  alternativeTitles: string[]
  lastAired?: string
  seriesType: string
  tags: unknown[]
}

export interface BazarrMovie {
  radarrId: number
  title: string
  year: string
  path: string
  overview?: string
  poster: string
  fanart: string
  audio_language: BazarrLanguage[]
  monitored: boolean
  profileId: number
  tmdbId?: number
  imdbId?: string
  alternativeTitles: string[]
  missing_subtitles: BazarrMissingSubtitle[]
  subtitles: BazarrSubtitleFile[]
  sceneName?: string
  tags: unknown[]
}

export interface BazarrProvider {
  name: string
  status: string
  retry: string
}

export interface BazarrSystemStatus {
  bazarr_version: string
  package_version: string
  sonarr_version: string
  radarr_version: string
  operating_system: string
  python_version: string
  database_engine: string
  database_migration: string
  bazarr_directory: string
  bazarr_config_directory: string
  start_time: number
  timezone: string
  cpu_cores: number
}

// Note: Bazarr encodes hi/forced/audio_exclude as the strings "True"/"False",
// not actual booleans — compare with === 'True', not a truthy check.
export interface BazarrLanguageProfile {
  profileId: number
  name: string
  items: Array<{
    id: number
    language: BazarrLanguage
    audio_exclude: string
    hi: string
    forced: string
  }>
  cutoff?: number
  mustContain: string[]
  mustNotContain: string[]
  originalFormat: boolean
}

export interface BazarrEpisode {
  sonarrEpisodeId: number
  sonarrSeriesId: number
  title: string
  season: number
  episode: number
  path?: string
  audio_language: BazarrLanguage[]
  missing_subtitles: BazarrMissingSubtitle[]
  subtitles: BazarrSubtitleFile[]
  monitored: boolean
  profileId: number
}
