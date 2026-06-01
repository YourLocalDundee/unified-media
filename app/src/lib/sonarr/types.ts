export interface SonarrQuality {
  id: number
  name: string
  source: string
  resolution: number
}

export interface SonarrQualityItem {
  quality?: SonarrQuality
  items: SonarrQualityItem[]
  allowed: boolean
  name?: string
  id?: number
}

export interface SonarrQualityProfile {
  id: number
  name: string
  upgradeAllowed: boolean
  cutoff: number
  items: SonarrQualityItem[]
  minFormatScore: number
  cutoffFormatScore: number
  minUpgradeFormatScore: number
  language: { id: number; name: string }
  formatItems: SonarrFormatItem[]
}

export interface SonarrFormatItem {
  format: number
  name: string
  score: number
}

export interface SonarrLanguageProfile {
  id: number
  name: string
  upgradeAllowed: boolean
  cutoff: { id: number; name: string }
  languages: Array<{ language: { id: number; name: string }; allowed: boolean }>
}

export interface SonarrRootFolder {
  id: number
  path: string
  accessible: boolean
  freeSpace: number
  unmappedFolders: Array<{ name: string; path: string; relativePath: string }>
}

export interface SonarrImage {
  coverType: 'banner' | 'poster' | 'fanart' | 'clearlogo' | 'headshot'
  url: string
  remoteUrl: string
}

export interface SonarrSeasonStatistics {
  episodeFileCount: number
  episodeCount: number
  totalEpisodeCount: number
  sizeOnDisk: number
  releaseGroups: string[]
  percentOfEpisodes: number
}

export interface SonarrSeason {
  seasonNumber: number
  monitored: boolean
  statistics: SonarrSeasonStatistics
}

export interface SonarrSeries {
  id: number
  title: string
  alternateTitles: Array<{ title: string; sceneSeasonNumber: number }>
  sortTitle: string
  status: 'continuing' | 'ended' | 'upcoming' | 'deleted'
  ended: boolean
  overview: string
  network: string
  airTime: string
  images: SonarrImage[]
  originalLanguage: { id: number; name: string }
  seasons: SonarrSeason[]
  year: number
  path: string
  qualityProfileId: number
  languageProfileId: number
  seasonFolder: boolean
  monitored: boolean
  monitorNewItems: 'all' | 'none'
  useSceneNumbering: boolean
  tvdbId: number
  tvRageId: number
  tvMazeId: number
  imdbId: string
  tmdbId: number
  firstAired: string
  lastAired?: string
  seriesType: 'standard' | 'daily' | 'anime'
  cleanTitle: string
  titleSlug: string
  rootFolderPath: string
  folder: string
  certification?: string
  genres: string[]
  tags: number[]
  added: string
  ratings: { votes: number; value: number }
  statistics: {
    seasonCount: number
    episodeFileCount: number
    episodeCount: number
    totalEpisodeCount: number
    sizeOnDisk: number
    releaseGroups: string[]
    percentOfEpisodes: number
  }
}

export interface SonarrEpisode {
  id: number
  seriesId: number
  tvdbId: number
  episodeFileId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  airDate: string
  airDateUtc: string
  overview: string
  hasFile: boolean
  monitored: boolean
  absoluteEpisodeNumber?: number
  unverifiedSceneNumbering: boolean
  grabbed: boolean
}

export interface SonarrQueueItem {
  id: number
  seriesId: number
  episodeId: number
  series?: Pick<SonarrSeries, 'id' | 'title'>
  episode?: Pick<SonarrEpisode, 'id' | 'title' | 'seasonNumber' | 'episodeNumber'>
  quality: { quality: SonarrQuality; revision: { version: number; real: number; isRepack: boolean } }
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

export interface SonarrQueueResponse {
  page: number
  pageSize: number
  sortKey: string
  sortDirection: string
  totalRecords: number
  records: SonarrQueueItem[]
}

export interface SonarrAddSeriesParams {
  title: string
  qualityProfileId: number
  languageProfileId?: number
  titleSlug: string
  images: SonarrImage[]
  seasons: Array<{ seasonNumber: number; monitored: boolean }>
  rootFolderPath: string
  tvdbId: number
  tmdbId?: number
  monitored: boolean
  monitorNewItems?: 'all' | 'none'
  seriesType?: 'standard' | 'daily' | 'anime'
  seasonFolder?: boolean
  addOptions?: {
    ignoreEpisodesWithFiles: boolean
    ignoreEpisodesWithoutFiles: boolean
    monitor: 'all' | 'future' | 'missing' | 'existing' | 'pilot' | 'firstSeason' | 'latestSeason' | 'none'
    searchForMissingEpisodes: boolean
    searchForCutoffUnmetEpisodes: boolean
  }
}
