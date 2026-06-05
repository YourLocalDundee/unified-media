// Typed Sonarr API helpers. All functions run server-side.
// Series are identified by Sonarr's internal integer ID, not TVDB/TMDB IDs.
// Use tvdbId when adding and convert to Sonarr's id for subsequent operations.
import { sonarrFetch } from './client'
import type {
  SonarrQualityProfile,
  SonarrLanguageProfile,
  SonarrRootFolder,
  SonarrSeries,
  SonarrQueueResponse,
  SonarrAddSeriesParams,
} from './types'

export function getQualityProfiles(): Promise<SonarrQualityProfile[]> {
  return sonarrFetch('/qualityprofile')
}

export function getRootFolders(): Promise<SonarrRootFolder[]> {
  return sonarrFetch('/rootfolder')
}

export function getAllSeries(): Promise<SonarrSeries[]> {
  return sonarrFetch('/series')
}

export function getSeries(id: number): Promise<SonarrSeries> {
  return sonarrFetch(`/series/${id}`)
}

export function addSeries(params: SonarrAddSeriesParams): Promise<SonarrSeries> {
  return sonarrFetch('/series', { method: 'POST', body: JSON.stringify(params) })
}

export function deleteSeries(id: number, deleteFiles = false): Promise<void> {
  return sonarrFetch(`/series/${id}?deleteFiles=${deleteFiles}`, { method: 'DELETE' })
}

export function getQueue(page = 1, pageSize = 20): Promise<SonarrQueueResponse> {
  return sonarrFetch(`/queue?page=${page}&pageSize=${pageSize}&includeEpisode=true&includeSeries=true`)
}

export function removeQueueItem(id: number, blacklist = false): Promise<void> {
  return sonarrFetch(`/queue/${id}?blacklist=${blacklist}`, { method: 'DELETE' })
}

export function getLanguageProfiles(): Promise<SonarrLanguageProfile[]> {
  return sonarrFetch('/languageprofile')
}

// Triggers an immediate search across all enabled indexers for all missing
// episodes in the series. The command runs asynchronously in Sonarr; this
// call returns as soon as the command is queued, not when it completes.
export function commandSearch(seriesId: number): Promise<void> {
  return sonarrFetch('/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'SeriesSearch', seriesId }),
  })
}
