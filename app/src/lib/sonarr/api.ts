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

export function commandSearch(seriesId: number): Promise<void> {
  return sonarrFetch('/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'SeriesSearch', seriesId }),
  })
}
