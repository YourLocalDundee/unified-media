// Typed Prowlarr API helpers. All functions run server-side.
// getIndexerStats accepts optional ISO date strings for windowed reporting;
// omitting both returns all-time stats.
import { prowlarrFetch } from './client'
import type {
  ProwlarrIndexer,
  ProwlarrIndexerStats,
  ProwlarrTag,
  ProwlarrAppProfile,
  ProwlarrSearchResult,
} from './types'

export function getIndexers(): Promise<ProwlarrIndexer[]> {
  return prowlarrFetch('/indexer')
}

export function getIndexer(id: number): Promise<ProwlarrIndexer> {
  return prowlarrFetch(`/indexer/${id}`)
}

export function updateIndexer(id: number, data: ProwlarrIndexer): Promise<ProwlarrIndexer> {
  return prowlarrFetch(`/indexer/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteIndexer(id: number): Promise<void> {
  return prowlarrFetch(`/indexer/${id}`, { method: 'DELETE' })
}

export function testIndexer(id: number): Promise<void> {
  return prowlarrFetch(`/indexer/test`, { method: 'POST', body: JSON.stringify({ id }) })
}

export function getIndexerStats(startDate?: string, endDate?: string): Promise<{ indexers: ProwlarrIndexerStats[] }> {
  const params = new URLSearchParams()
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  const qs = params.toString()
  return prowlarrFetch(`/indexerstats${qs ? `?${qs}` : ''}`)
}

export function getTags(): Promise<ProwlarrTag[]> {
  return prowlarrFetch('/tag')
}

export function getAppProfiles(): Promise<ProwlarrAppProfile[]> {
  return prowlarrFetch('/appprofile')
}

export function search(query: string, categories?: number[], indexerIds?: number[]): Promise<ProwlarrSearchResult[]> {
  const params = new URLSearchParams({ query })
  if (categories?.length) params.set('categories', categories.join(','))
  if (indexerIds?.length) params.set('indexerIds', indexerIds.join(','))
  return prowlarrFetch(`/search?${params}`)
}
