export interface ProwlarrCategory {
  id: number
  name: string
  subCategories: ProwlarrCategory[]
}

export interface ProwlarrField {
  order: number
  name: string
  label?: string
  helpText?: string
  value?: unknown
  type: string
  advanced: boolean
  privacy?: string
  isFloat?: boolean
  selectOptions?: Array<{ value: number; name: string; order: number; hint?: string }>
}

export interface ProwlarrCapabilities {
  limitsMax: number
  limitsDefault: number
  categories: ProwlarrCategory[]
  supportsRawSearch: boolean
  searchParams: string[]
  tvSearchParams?: string[]
  movieSearchParams?: string[]
  musicSearchParams?: string[]
  bookSearchParams?: string[]
}

export interface ProwlarrIndexer {
  id: number
  name: string
  sortName: string
  definitionName: string
  description?: string
  language: string
  encoding: string
  enable: boolean
  redirect: boolean
  supportsRss: boolean
  supportsSearch: boolean
  supportsRedirect: boolean
  supportsPagination: boolean
  appProfileId: number
  protocol: 'torrent' | 'usenet'
  privacy: 'public' | 'semiPrivate' | 'private'
  capabilities: ProwlarrCapabilities
  priority: number
  downloadClientId: number
  added: string
  fields: ProwlarrField[]
  implementationName: string
  implementation: string
  configContract: string
  infoLink: string
  tags: number[]
  indexerUrls: string[]
  legacyUrls: string[]
}

export interface ProwlarrIndexerStats {
  indexerId: number
  indexerName: string
  averageResponseTime: number
  percentOfQueries: number
  numberOfQueries: number
  numberOfGrabs: number
  numberOfRssQueries: number
  numberOfAuthQueries: number
  numberOfFailedQueries: number
  numberOfFailedGrabs: number
  numberOfFailedRssQueries: number
  numberOfFailedAuthQueries: number
}

export interface ProwlarrTag {
  id: number
  label: string
}

export interface ProwlarrAppProfile {
  id: number
  name: string
  enableRss: boolean
  enableAutomaticSearch: boolean
  enableInteractiveSearch: boolean
  minimumSeeders: number
  seedRatio?: number
  seedTime?: number
  packSeedTime?: number
}

export interface ProwlarrSearchResult {
  guid: string
  ageHours: number
  age: number
  ageMinutes: number
  size: number
  indexerId: number
  indexer: string
  title: string
  sortTitle: string
  infoUrl: string
  downloadUrl?: string
  magnetUrl?: string
  imdbId?: number
  tmdbId?: number
  tvdbId?: number
  tvMazeId?: number
  seeders?: number
  leechers?: number
  indexerFlags: number
  categories: ProwlarrCategory[]
  publishDate: string
}
