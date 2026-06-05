// TypeScript interfaces for the Radarr v3 REST API.
// All field names match Radarr's JSON exactly.
// Radarr runs with network_mode: host — must be reached via 192.168.0.50:7878.
// Auth is a static X-Api-Key header.

export interface RadarrQuality {
  id: number
  name: string
  source: string
  resolution: number
  modifier: string
}

export interface RadarrQualityItem {
  quality?: RadarrQuality
  items: RadarrQualityItem[]
  allowed: boolean
  name?: string
  id?: number
}

export interface RadarrFormatItem {
  format: number
  name: string
  score: number
}

export interface RadarrQualityProfile {
  id: number
  name: string
  upgradeAllowed: boolean
  cutoff: number
  items: RadarrQualityItem[]
  minFormatScore: number
  cutoffFormatScore: number
  minUpgradeFormatScore: number
  language: { id: number; name: string }
  formatItems: RadarrFormatItem[]
}

export interface RadarrRootFolder {
  id: number
  path: string
  accessible: boolean
  freeSpace: number
  unmappedFolders: Array<{ name: string; path: string; relativePath: string }>
}

export interface RadarrImage {
  coverType: 'poster' | 'fanart' | 'banner' | 'clearlogo' | 'headshot'
  url: string
  remoteUrl: string
}

export interface RadarrMovie {
  id: number
  title: string
  originalTitle: string
  alternateTitles: Array<{ sourceType: string; movieMetadataId: number; title: string }>
  sortTitle: string
  sizeOnDisk: number
  status: 'tba' | 'announced' | 'inCinemas' | 'released' | 'deleted'
  overview: string
  inCinemas?: string
  physicalRelease?: string
  digitalRelease?: string
  images: RadarrImage[]
  website?: string
  year: number
  hasFile: boolean
  youTubeTrailerId?: string
  studio?: string
  path: string
  qualityProfileId: number
  monitored: boolean
  minimumAvailability: 'tba' | 'announced' | 'inCinemas' | 'released'
  isAvailable: boolean
  folderName: string
  runtime: number
  cleanTitle: string
  imdbId: string
  tmdbId: number
  titleSlug: string
  rootFolderPath: string
  folder: string
  certification?: string
  genres: string[]
  tags: number[]
  added: string
  ratings: { imdb?: { votes: number; value: number; type: string }; tmdb?: { votes: number; value: number; type: string }; rottenTomatoes?: { votes: number; value: number; type: string } }
  movieFile?: RadarrMovieFile
  collection?: { name: string; tmdbId: number; images: RadarrImage[] }
  popularity: number
  statistics: { movieFileCount: number; sizeOnDisk: number; releaseGroups: string[] }
}

export interface RadarrMovieFile {
  id: number
  movieId: number
  relativePath: string
  path: string
  size: number
  dateAdded: string
  quality: { quality: RadarrQuality; revision: { version: number; real: number; isRepack: boolean } }
  mediaInfo?: {
    audioBitrate: number
    audioChannels: number
    audioCodec: string
    audioLanguages: string
    audioStreamCount: number
    videoBitDepth: number
    videoBitrate: number
    videoCodec: string
    videoDynamicRange: string
    videoDynamicRangeType: string
    videoFps: number
    resolution: string
    runTime: string
    scanType: string
    subtitles: string
  }
  indexerFlags: number
  qualityCutoffNotMet: boolean
}

export interface RadarrQueueItem {
  id: number
  movieId: number
  movie?: Pick<RadarrMovie, 'id' | 'title' | 'tmdbId'>
  quality: { quality: RadarrQuality; revision: { version: number; real: number; isRepack: boolean } }
  size: number
  title: string
  sizeleft: number
  timeleft: string
  estimatedCompletionTime: string
  status: string
  trackedDownloadStatus: 'ok' | 'warning' | 'error'
  trackedDownloadState: string
  statusMessages: Array<{ title: string; messages: string[] }>
  downloadId: string
  protocol: 'torrent' | 'usenet' | 'unknown'
  downloadClient: string
  indexer: string
  outputPath: string
}

export interface RadarrQueueResponse {
  page: number
  pageSize: number
  sortKey: string
  sortDirection: string
  totalRecords: number
  records: RadarrQueueItem[]
}

// Used by POST /api/v3/movie. tmdbId is the canonical lookup key for Radarr.
// minimumAvailability controls when Radarr considers a movie eligible to grab.
// addOptions.searchForMovie triggers an immediate search after adding.
export interface RadarrAddMovieParams {
  title: string
  qualityProfileId: number
  titleSlug: string
  images: RadarrImage[]
  tmdbId: number
  year: number
  rootFolderPath: string
  monitored: boolean
  minimumAvailability: 'tba' | 'announced' | 'inCinemas' | 'released'
  addOptions?: {
    searchForMovie: boolean
  }
}
