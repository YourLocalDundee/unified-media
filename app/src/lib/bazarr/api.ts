import { bazarrFetch } from './client'
import type {
  BazarrProvider,
  BazarrSeries,
  BazarrMovie,
  BazarrSystemStatus,
  BazarrLanguageProfile,
} from './types'

export function getSystemStatus(): Promise<{ data: BazarrSystemStatus }> {
  return bazarrFetch('/system/status')
}

export function getProviders(): Promise<{ data: BazarrProvider[] }> {
  return bazarrFetch('/providers')
}

export function getSeries(page = 1, perPage = 50): Promise<{ data: BazarrSeries[]; total?: number }> {
  return bazarrFetch(`/series?start=${(page - 1) * perPage}&length=${perPage}`)
}

export function getMovies(page = 1, perPage = 50): Promise<{ data: BazarrMovie[]; total?: number }> {
  return bazarrFetch(`/movies?start=${(page - 1) * perPage}&length=${perPage}`)
}

export function getLanguageProfiles(): Promise<{ data: BazarrLanguageProfile[] }> {
  return bazarrFetch('/profiles/languages')
}

export function downloadSubtitle(
  radarrId: number,
  language: string,
  forced: boolean,
  hi: boolean
): Promise<void> {
  const params = new URLSearchParams({
    radarrid: String(radarrId),
    language,
    forced: String(forced),
    hi: String(hi),
  })
  return bazarrFetch(`/movies/subtitles?${params}`, { method: 'PATCH' })
}

export function downloadEpisodeSubtitle(
  sonarrSeriesId: number,
  sonarrEpisodeId: number,
  language: string,
  forced: boolean,
  hi: boolean
): Promise<void> {
  const params = new URLSearchParams({
    seriesid: String(sonarrSeriesId),
    episodeid: String(sonarrEpisodeId),
    language,
    forced: String(forced),
    hi: String(hi),
  })
  return bazarrFetch(`/episodes/subtitles?${params}`, { method: 'PATCH' })
}
