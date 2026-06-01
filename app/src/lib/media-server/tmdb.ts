const BASE = 'https://api.themoviedb.org/3'

function tmdbFetch<T>(path: string): Promise<T> {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) throw new Error('TMDB_ACCESS_TOKEN not set')
  return fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    next: { revalidate: 86400 },
  }).then(async r => {
    if (!r.ok) throw new Error(`TMDB ${r.status}: ${path}`)
    return r.json() as Promise<T>
  })
}

// Local types — not exported
interface TMDBMovie {
  id: number
  title: string
  original_title: string
  overview: string
  release_date: string
  runtime: number
  popularity: number
  poster_path: string | null
  backdrop_path: string | null
  imdb_id: string | null
  genres: { id: number; name: string }[]
}

interface TMDBTVShow {
  id: number
  name: string
  original_name: string
  overview: string
  first_air_date: string
  episode_run_time: number[]
  poster_path: string | null
  backdrop_path: string | null
  external_ids?: { imdb_id?: string; tvdb_id?: number }
}

interface TMDBRawSearchResponse<T> {
  results: T[]
  total_results: number
  total_pages: number
}

// Search for a movie by title + optional year
export async function searchMovie(title: string, year?: number): Promise<TMDBMovie | null> {
  try {
    const qs = new URLSearchParams({ query: title, language: 'en-US', page: '1' })
    if (year != null) qs.set('year', String(year))
    const data = await tmdbFetch<TMDBRawSearchResponse<TMDBMovie>>(`/search/movie?${qs.toString()}`)
    return data.results[0] ?? null
  } catch (err) {
    console.error('[tmdb] searchMovie error:', err)
    return null
  }
}

// Get full movie details by TMDB ID
export async function getMovie(tmdbId: number): Promise<TMDBMovie> {
  return tmdbFetch<TMDBMovie>(`/movie/${tmdbId}?language=en-US`)
}

// Search for a TV show
export async function searchTV(title: string, year?: number): Promise<TMDBTVShow | null> {
  try {
    const qs = new URLSearchParams({ query: title, language: 'en-US', page: '1' })
    if (year != null) qs.set('first_air_date_year', String(year))
    const data = await tmdbFetch<TMDBRawSearchResponse<TMDBTVShow>>(`/search/tv?${qs.toString()}`)
    return data.results[0] ?? null
  } catch (err) {
    console.error('[tmdb] searchTV error:', err)
    return null
  }
}

// Get full TV show details
export async function getTV(tmdbId: number): Promise<TMDBTVShow> {
  return tmdbFetch<TMDBTVShow>(`/tv/${tmdbId}?language=en-US&append_to_response=external_ids`)
}

// Get image URL from TMDB path
export function tmdbImageUrl(
  posterPath: string | null,
  size: 'w342' | 'w780' | 'original' = 'w342',
): string | null {
  if (posterPath === null) return null
  return `https://image.tmdb.org/t/p/${size}${posterPath}`
}

// ---------------------------------------------------------------------------
// List-search types and function for the search page
// ---------------------------------------------------------------------------

export interface TMDBSearchResult {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  title: string
  year: number | null
  overview: string
  posterPath: string | null
  backdropPath: string | null
  rating: number | null
}

export interface TMDBSearchResponse {
  results: TMDBSearchResult[]
  totalResults: number
  totalPages: number
  page: number
}

interface TMDBMovieListItem {
  id: number
  title: string
  release_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
}

interface TMDBTVListItem {
  id: number
  name: string
  first_air_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
}

interface TMDBListResponse<T> {
  results: T[]
  total_results: number
  total_pages: number
  page: number
}

function parseYear(date: string | null | undefined): number | null {
  if (!date) return null
  const parsed = parseInt(date.slice(0, 4), 10)
  return isNaN(parsed) ? null : parsed
}

function mapMovie(item: TMDBMovieListItem): TMDBSearchResult {
  return {
    tmdbId: item.id,
    mediaType: 'movie',
    title: item.title,
    year: parseYear(item.release_date),
    overview: item.overview,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    rating: item.vote_average ?? null,
  }
}

function mapTV(item: TMDBTVListItem): TMDBSearchResult {
  return {
    tmdbId: item.id,
    mediaType: 'tv',
    title: item.name,
    year: parseYear(item.first_air_date),
    overview: item.overview,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    rating: item.vote_average ?? null,
  }
}

async function fetchSearchPage<T>(
  endpoint: string,
  query: string,
  page: number,
): Promise<TMDBListResponse<T>> {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) throw new Error('TMDB_ACCESS_TOKEN not set')
  const qs = new URLSearchParams({ query, page: String(page), include_adult: 'false' })
  const url = `${BASE}${endpoint}?${qs.toString()}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    next: { revalidate: 300 },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${endpoint}`)
  return res.json() as Promise<TMDBListResponse<T>>
}

export async function searchTMDB(
  query: string,
  type: 'movie' | 'tv' | 'all',
  page = 1,
): Promise<TMDBSearchResponse> {
  if (type === 'movie') {
    const data = await fetchSearchPage<TMDBMovieListItem>('/search/movie', query, page)
    return {
      results: data.results.map(mapMovie),
      totalResults: data.total_results,
      totalPages: data.total_pages,
      page: data.page,
    }
  }

  if (type === 'tv') {
    const data = await fetchSearchPage<TMDBTVListItem>('/search/tv', query, page)
    return {
      results: data.results.map(mapTV),
      totalResults: data.total_results,
      totalPages: data.total_pages,
      page: data.page,
    }
  }

  // type === 'all': fetch both in parallel at page 1
  const [movies, shows] = await Promise.all([
    fetchSearchPage<TMDBMovieListItem>('/search/movie', query, 1),
    fetchSearchPage<TMDBTVListItem>('/search/tv', query, 1),
  ])

  // Interleave by original order position so results feel balanced
  const merged: TMDBSearchResult[] = []
  const maxLen = Math.max(movies.results.length, shows.results.length)
  const movieMapped = movies.results.map(mapMovie)
  const tvMapped = shows.results.map(mapTV)
  for (let i = 0; i < maxLen; i++) {
    if (i < movieMapped.length) merged.push(movieMapped[i])
    if (i < tvMapped.length) merged.push(tvMapped[i])
  }

  return {
    results: merged,
    totalResults: movies.total_results + shows.total_results,
    totalPages: Math.max(movies.total_pages, shows.total_pages),
    page: 1,
  }
}
