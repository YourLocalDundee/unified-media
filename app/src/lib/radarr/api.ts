// Typed Radarr API helpers. All functions run server-side.
// Movies are identified by Radarr's internal integer ID for mutations;
// TMDB ID is used for lookups and adds.
import { radarrFetch } from './client'
import type {
  RadarrQualityProfile,
  RadarrRootFolder,
  RadarrMovie,
  RadarrQueueResponse,
  RadarrAddMovieParams,
} from './types'

export function getQualityProfiles(): Promise<RadarrQualityProfile[]> {
  return radarrFetch('/qualityprofile')
}

export function getRootFolders(): Promise<RadarrRootFolder[]> {
  return radarrFetch('/rootfolder')
}

export function getAllMovies(): Promise<RadarrMovie[]> {
  return radarrFetch('/movie')
}

export function getMovie(id: number): Promise<RadarrMovie> {
  return radarrFetch(`/movie/${id}`)
}

export function addMovie(params: RadarrAddMovieParams): Promise<RadarrMovie> {
  return radarrFetch('/movie', { method: 'POST', body: JSON.stringify(params) })
}

export function deleteMovie(id: number, deleteFiles = false): Promise<void> {
  return radarrFetch(`/movie/${id}?deleteFiles=${deleteFiles}`, { method: 'DELETE' })
}

export function getQueue(page = 1, pageSize = 20): Promise<RadarrQueueResponse> {
  return radarrFetch(`/queue?page=${page}&pageSize=${pageSize}&includeMovie=true`)
}

export function removeQueueItem(id: number, blacklist = false): Promise<void> {
  return radarrFetch(`/queue/${id}?blacklist=${blacklist}`, { method: 'DELETE' })
}

// Note: the command name is 'MoviesSearch' (plural) and accepts an array of IDs,
// even when searching a single movie. This matches Radarr's v3 API spec.
export function commandSearch(movieId: number): Promise<void> {
  return radarrFetch('/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'MoviesSearch', movieIds: [movieId] }),
  })
}
