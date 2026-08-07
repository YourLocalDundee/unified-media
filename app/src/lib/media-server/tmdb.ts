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
  vote_average: number
  vote_count: number
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
  popularity: number
  vote_average: number
  vote_count: number
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
  rating: number | null       // vote_average
  popularity: number | null
  voteCount: number | null
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
  vote_count: number
  popularity: number
}

interface TMDBTVListItem {
  id: number
  name: string
  first_air_date: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  popularity: number
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
    popularity: item.popularity ?? null,
    voteCount: item.vote_count ?? null,
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
    popularity: item.popularity ?? null,
    voteCount: item.vote_count ?? null,
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

// ---------------------------------------------------------------------------
// Trending / Popular browsing
// ---------------------------------------------------------------------------

export type TrendingCategory =
  | 'trending'
  | 'trending-movies'
  | 'trending-tv'
  | 'popular-movies'
  | 'popular-tv'
  | 'top-rated-movies'
  | 'top-rated-tv'

const CATEGORY_ENDPOINT: Record<TrendingCategory, string> = {
  'trending':          '/trending/all/week',
  'trending-movies':   '/trending/movie/week',
  'trending-tv':       '/trending/tv/week',
  'popular-movies':    '/movie/popular',
  'popular-tv':        '/tv/popular',
  'top-rated-movies':  '/movie/top_rated',
  'top-rated-tv':      '/tv/top_rated',
}

export async function getTrendingContent(
  category: TrendingCategory = 'trending',
  page = 1,
): Promise<TMDBSearchResponse> {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) throw new Error('TMDB_ACCESS_TOKEN not set')
  const endpoint = CATEGORY_ENDPOINT[category]
  const qs = new URLSearchParams({ language: 'en-US', page: String(page) })
  const url = `${BASE}${endpoint}?${qs.toString()}`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${endpoint}`)
  const data = await res.json() as TMDBListResponse<TMDBMovieListItem & TMDBTVListItem & { media_type?: string }>

  const isTv = category === 'popular-tv' || category === 'top-rated-tv' || category === 'trending-tv'
  const isMovie = category === 'popular-movies' || category === 'top-rated-movies' || category === 'trending-movies'

  const results: TMDBSearchResult[] = data.results
    .filter((r) => {
      const mt = r.media_type
      if (mt === 'person') return false
      return true
    })
    .map((r) => {
      const mt = r.media_type ?? (isTv ? 'tv' : 'movie')
      if (mt === 'tv' || isTv) return mapTV(r as unknown as TMDBTVListItem)
      return mapMovie(r as unknown as TMDBMovieListItem)
    })

  void isMovie // suppress unused-variable warning; kept for readability of the isTv/isMovie pair above

  return {
    results,
    totalResults: data.total_results,
    totalPages: data.total_pages,
    page: data.page,
  }
}

// ---------------------------------------------------------------------------
// Genre discovery
// ---------------------------------------------------------------------------

export interface TMDBGenre {
  id: number
  name: string
}

export async function getGenres(type: 'movie' | 'tv'): Promise<TMDBGenre[]> {
  try {
    const data = await tmdbFetch<{ genres: TMDBGenre[] }>(`/genre/${type}/list?language=en-US`)
    return data.genres
  } catch {
    return []
  }
}

// Sort field — direction is supplied separately as DiscoverDir.
// 'newest' and 'oldest' are kept as aliases (legacy URL params map to date+dir).
export type DiscoverSort = 'popularity' | 'rating' | 'date' | 'title' | 'votes'
export type DiscoverDir  = 'asc' | 'desc'

export interface DiscoverOptions {
  genreId?: number
  sortBy?: DiscoverSort
  sortDir?: DiscoverDir
  year?: number
  minRating?: number
  page?: number
}

/**
 * Generalized TMDB Discover (replaces the old genre-only discoverByGenre). Hits
 * /discover/{type} with sort + optional genre/year/min-rating filters. The date sort
 * field differs by type (primary_release_date for movies, first_air_date for tv), and
 * the rating sort gets a vote-count floor so a single 10.0 vote can't top the list.
 */
export async function discoverTMDB(
  type: 'movie' | 'tv',
  opts: DiscoverOptions = {},
): Promise<TMDBSearchResponse> {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) throw new Error('TMDB_ACCESS_TOKEN not set')
  const { genreId, sortBy = 'popularity', sortDir = 'desc', year, minRating, page = 1 } = opts

  const dateField = type === 'movie' ? 'primary_release_date' : 'first_air_date'
  // Map field name + direction to TMDB's sort_by string.
  // title uses original_title which TMDB /discover supports in both directions.
  const tmdbSortField: Record<DiscoverSort, string> = {
    popularity: 'popularity',
    rating:     'vote_average',
    date:       dateField,
    title:      'original_title',
    votes:      'vote_count',
  }
  const sortByTmdb = `${tmdbSortField[sortBy]}.${sortDir}`

  const qs = new URLSearchParams({
    language: 'en-US',
    page: String(page),
    sort_by: sortByTmdb,
    include_adult: 'false',
  })
  if (genreId) qs.set('with_genres', String(genreId))
  if (year) qs.set(type === 'movie' ? 'primary_release_year' : 'first_air_date_year', String(year))
  // Rating desc needs a vote floor so a 1-vote 10.0 doesn't dominate the page.
  if (sortBy === 'rating' && sortDir === 'desc') qs.set('vote_count.gte', type === 'movie' ? '100' : '50')
  if (minRating && minRating > 0) qs.set('vote_average.gte', String(minRating))

  const endpoint = `/discover/${type}`
  const res = await fetch(`${BASE}${endpoint}?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    next: { revalidate: 3600 },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${endpoint}`)
  const data = await res.json() as TMDBListResponse<TMDBMovieListItem & TMDBTVListItem>
  const results: TMDBSearchResult[] = data.results.map((r) =>
    type === 'tv' ? mapTV(r as unknown as TMDBTVListItem) : mapMovie(r as unknown as TMDBMovieListItem)
  )
  return {
    results,
    totalResults: data.total_results,
    totalPages: data.total_pages,
    page: data.page,
  }
}

// ---------------------------------------------------------------------------
// Full detail (with credits) for detail pages
// ---------------------------------------------------------------------------

export interface CastMember {
  id: number
  name: string
  character: string
  profilePath: string | null
  order: number
}

export interface CrewMember {
  id: number
  name: string
  job: string
  department: string
  profilePath: string | null
}

export interface MovieDetail {
  tmdbId: number
  title: string
  tagline: string | null
  overview: string | null
  posterPath: string | null
  backdropPath: string | null
  releaseDate: string | null
  runtime: number | null
  genres: { id: number; name: string }[]
  voteAverage: number | null
  budget: number
  revenue: number
  homepage: string | null
  originalLanguage: string | null
  belongsToCollection: { id: number; name: string; posterPath: string | null } | null
  cast: CastMember[]
  crew: CrewMember[]
}

export interface TVSeasonInfo {
  id: number
  seasonNumber: number
  name: string | null
  episodeCount: number | null
  airDate: string | null
  posterPath: string | null
}

export interface TVDetail {
  tmdbId: number
  name: string
  tagline: string | null
  overview: string | null
  posterPath: string | null
  backdropPath: string | null
  firstAirDate: string | null
  status: string | null
  numberOfSeasons: number | null
  numberOfEpisodes: number | null
  genres: { id: number; name: string }[]
  episodeRunTime: number[]
  voteAverage: number | null
  homepage: string | null
  networks: { id: number; name: string; logoPath: string | null }[]
  creators: { id: number; name: string; profilePath: string | null }[]
  cast: CastMember[]
  crew: CrewMember[]
  seasons: TVSeasonInfo[]
}

export async function getMovieDetail(tmdbId: number): Promise<MovieDetail> {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) throw new Error('TMDB_ACCESS_TOKEN not set')
  const url = `${BASE}/movie/${tmdbId}?append_to_response=credits&language=en-US`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 86400 },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}: /movie/${tmdbId}`)
  const r = await res.json() as Record<string, unknown> & {
    credits?: {
      cast?: Record<string, unknown>[]
      crew?: Record<string, unknown>[]
    }
    belongs_to_collection?: { id: number; name: string; poster_path: string | null } | null
  }

  return {
    tmdbId: r.id as number,
    title: r.title as string,
    tagline: (r.tagline as string | null) ?? null,
    overview: (r.overview as string | null) ?? null,
    posterPath: (r.poster_path as string | null) ?? null,
    backdropPath: (r.backdrop_path as string | null) ?? null,
    releaseDate: (r.release_date as string | null) ?? null,
    runtime: (r.runtime as number | null) ?? null,
    genres: (r.genres as { id: number; name: string }[]) ?? [],
    voteAverage: (r.vote_average as number | null) ?? null,
    budget: (r.budget as number) ?? 0,
    revenue: (r.revenue as number) ?? 0,
    homepage: (r.homepage as string | null) ?? null,
    originalLanguage: (r.original_language as string | null) ?? null,
    belongsToCollection: r.belongs_to_collection
      ? {
          id: r.belongs_to_collection.id,
          name: r.belongs_to_collection.name,
          posterPath: r.belongs_to_collection.poster_path,
        }
      : null,
    cast: ((r.credits?.cast ?? []) as Record<string, unknown>[])
      .slice(0, 24)
      .map((c) => ({
        id: c.id as number,
        name: c.name as string,
        character: c.character as string,
        profilePath: (c.profile_path as string | null) ?? null,
        order: c.order as number,
      })),
    crew: ((r.credits?.crew ?? []) as Record<string, unknown>[])
      .filter((c) => ['Director', 'Producer', 'Screenplay', 'Writer'].includes(c.job as string))
      .map((c) => ({
        id: c.id as number,
        name: c.name as string,
        job: c.job as string,
        department: c.department as string,
        profilePath: (c.profile_path as string | null) ?? null,
      })),
  }
}

export async function getTVDetail(tmdbId: number): Promise<TVDetail> {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) throw new Error('TMDB_ACCESS_TOKEN not set')
  const url = `${BASE}/tv/${tmdbId}?append_to_response=credits&language=en-US`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 86400 },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}: /tv/${tmdbId}`)
  const r = await res.json() as Record<string, unknown> & {
    credits?: {
      cast?: Record<string, unknown>[]
      crew?: Record<string, unknown>[]
    }
    created_by?: Record<string, unknown>[]
    networks?: Record<string, unknown>[]
    seasons?: Record<string, unknown>[]
  }

  return {
    tmdbId: r.id as number,
    name: r.name as string,
    tagline: (r.tagline as string | null) ?? null,
    overview: (r.overview as string | null) ?? null,
    posterPath: (r.poster_path as string | null) ?? null,
    backdropPath: (r.backdrop_path as string | null) ?? null,
    firstAirDate: (r.first_air_date as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    numberOfSeasons: (r.number_of_seasons as number | null) ?? null,
    numberOfEpisodes: (r.number_of_episodes as number | null) ?? null,
    genres: (r.genres as { id: number; name: string }[]) ?? [],
    episodeRunTime: (r.episode_run_time as number[]) ?? [],
    voteAverage: (r.vote_average as number | null) ?? null,
    homepage: (r.homepage as string | null) ?? null,
    networks: ((r.networks ?? []) as Record<string, unknown>[]).map((n) => ({
      id: n.id as number,
      name: n.name as string,
      logoPath: (n.logo_path as string | null) ?? null,
    })),
    creators: ((r.created_by ?? []) as Record<string, unknown>[]).map((c) => ({
      id: c.id as number,
      name: c.name as string,
      profilePath: (c.profile_path as string | null) ?? null,
    })),
    cast: ((r.credits?.cast ?? []) as Record<string, unknown>[])
      .slice(0, 24)
      .map((c) => ({
        id: c.id as number,
        name: c.name as string,
        character: c.character as string,
        profilePath: (c.profile_path as string | null) ?? null,
        order: (c.order as number) ?? 0,
      })),
    crew: ((r.credits?.crew ?? []) as Record<string, unknown>[])
      .filter((c) => ['Executive Producer', 'Producer', 'Creator'].includes(c.job as string))
      .map((c) => ({
        id: c.id as number,
        name: c.name as string,
        job: c.job as string,
        department: c.department as string,
        profilePath: (c.profile_path as string | null) ?? null,
      })),
    seasons: ((r.seasons ?? []) as Record<string, unknown>[])
      .filter((s) => (s.season_number as number) > 0)
      .map((s) => ({
        id: s.id as number,
        seasonNumber: s.season_number as number,
        name: (s.name as string | null) ?? null,
        episodeCount: (s.episode_count as number | null) ?? null,
        airDate: (s.air_date as string | null) ?? null,
        posterPath: (s.poster_path as string | null) ?? null,
      }))
      // Release order, not TMDB's raw array order — some shows number seasons out of broadcast
      // order (e.g. reordered specials/regional splits). Seasons missing an air date (unaired,
      // or sparse TMDB data) sort last, tie-broken by season_number.
      .sort((a, b) => {
        if (a.airDate && b.airDate) return a.airDate.localeCompare(b.airDate)
        if (a.airDate) return -1
        if (b.airDate) return 1
        return a.seasonNumber - b.seasonNumber
      }),
  }
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

  // type === 'all': fetch BOTH at the requested page (previously hard-coded to 1,
  // which made every Next/Prev click re-render page 1 — A2-001). When one type runs
  // out of pages before the other, TMDB returns an empty list for it at that page, so
  // the merge below naturally degrades to the remaining type's results.
  const [movies, shows] = await Promise.all([
    fetchSearchPage<TMDBMovieListItem>('/search/movie', query, page),
    fetchSearchPage<TMDBTVListItem>('/search/tv', query, page),
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
    // The combined feed has results through whichever type paginates furthest.
    totalPages: Math.max(movies.total_pages, shows.total_pages),
    page,
  }
}

// ---------------------------------------------------------------------------
// Season episode numbers — used by the admin season-grab to fan out per-episode
// ---------------------------------------------------------------------------

/** Regular (episode_number > 0) episode numbers for a TV season. Specials (S0) excluded by caller. */
export async function getSeasonEpisodeNumbers(tmdbId: number, seasonNumber: number): Promise<number[]> {
  const data = await tmdbFetch<{ episodes?: { episode_number: number }[] }>(
    `/tv/${tmdbId}/season/${seasonNumber}?language=en-US`,
  )
  return (data.episodes ?? [])
    .map((e) => e.episode_number)
    .filter((n) => typeof n === 'number' && n > 0)
}

export interface SeasonEpisodeDetail {
  episodeNumber: number
  name: string | null
  stillPath: string | null
  overview: string | null
}

// One call covers every episode in the season — used to backfill per-episode still images,
// titles, and overviews for library items instead of one TMDB request per episode.
export async function getSeasonEpisodeDetails(tmdbId: number, seasonNumber: number): Promise<SeasonEpisodeDetail[]> {
  const data = await tmdbFetch<{
    episodes?: Array<{ episode_number: number; name?: string | null; still_path?: string | null; overview?: string | null }>
  }>(`/tv/${tmdbId}/season/${seasonNumber}?language=en-US`)
  return (data.episodes ?? [])
    .filter((e) => typeof e.episode_number === 'number' && e.episode_number > 0)
    .map((e) => ({
      episodeNumber: e.episode_number,
      name: e.name ?? null,
      stillPath: e.still_path ?? null,
      overview: e.overview ?? null,
    }))
}

// ---------------------------------------------------------------------------
// Story arcs (Bug 7): TMDB groups long-running anime into "seasons" that bundle
// multiple story arcs (e.g. One Piece S13 = "Impel Down & Marineford", 422–522).
// The episode_groups API exposes true arc boundaries; we use the type-5 grouping,
// preferring the one named "Arcs (Official)". Series without such a grouping (most
// non-anime) return [] so callers fall back to plain season behavior.
// ---------------------------------------------------------------------------

export interface SeriesArc {
  id: string                                // episode-group sub-group id (stable per arc)
  order: number                             // 0-based position within the grouping — this IS the
                                             // arc's release/story order (TMDB's official arc set),
                                             // so arcs are already release-ordered; no extra sort needed.
  name: string                              // e.g. "Impel Down"
  episodeCount: number
  episodes: ArcEpisode[]
}

export interface ArcEpisode {
  s: number   // season_number
  e: number   // (absolute) episode_number
  name: string | null
  airDate: string | null
  stillPath: string | null
  overview: string | null
  runtime: number | null
  voteAverage: number | null
}

// In-process cache: arc structure is static, so the 2-step episode-group resolution runs once
// per series per process. (Next's fetch data cache — revalidate 86400 on tmdbFetch — already
// dedupes the underlying HTTP calls across requests; this Map additionally skips the re-parse.)
const arcCache = new Map<number, SeriesArc[]>()

export async function getArcs(tmdbId: number): Promise<SeriesArc[]> {
  const cached = arcCache.get(tmdbId)
  if (cached) return cached
  try {
    const groups = await tmdbFetch<{ results?: { id: string; name: string; type: number }[] }>(
      `/tv/${tmdbId}/episode_groups`,
    )
    const list = groups.results ?? []
    // type 5 = story-arc/saga groupings. Prefer the canonical "Arcs (Official)" set.
    const arcGroup =
      list.find((g) => g.type === 5 && /arcs?\s*\(official\)/i.test(g.name)) ??
      list.find((g) => g.type === 5 && /\barc\b/i.test(g.name)) ??
      list.find((g) => g.type === 5)
    if (!arcGroup) { arcCache.set(tmdbId, []); return [] }

    const detail = await tmdbFetch<{
      groups?: {
        id: string
        name: string
        order: number
        episodes?: Array<{
          season_number: number
          episode_number: number
          name?: string | null
          air_date?: string | null
          still_path?: string | null
          overview?: string | null
          runtime?: number | null
          vote_average?: number | null
        }>
      }[]
    }>(`/tv/episode_group/${arcGroup.id}`)

    const arcs: SeriesArc[] = (detail.groups ?? [])
      .map((g) => {
        // TMDB's episode_group response embeds full episode metadata per grouped episode, so the
        // arc episode list needs no additional per-season fetch (unlike arcs spanning many seasons,
        // where fetching each season separately would mean many round trips).
        // Drop season-0 (specials) episodes — mirrors the `season_number > 0` filter the plain
        // Seasons list applies below, so a specials-only arc (e.g. Dragon Ball Z "Specials")
        // disappears the same way a Season 0 card does, instead of surfacing inconsistently here.
        const episodes: ArcEpisode[] = (g.episodes ?? [])
          .filter((e) => typeof e.episode_number === 'number' && e.episode_number > 0 && e.season_number > 0)
          .map((e) => ({
            s: e.season_number,
            e: e.episode_number,
            name: e.name ?? null,
            airDate: e.air_date ?? null,
            stillPath: e.still_path ?? null,
            overview: e.overview ?? null,
            runtime: e.runtime ?? null,
            voteAverage: e.vote_average ?? null,
          }))
        return { id: g.id, order: g.order ?? 0, name: g.name, episodes, episodeCount: episodes.length }
      })
      .filter((g) => g.episodeCount > 0)
      .sort((a, b) => a.order - b.order)

    arcCache.set(tmdbId, arcs)
    return arcs
  } catch {
    // Network/parse failure → treat as "no arcs" so the caller falls back to seasons.
    // Do NOT cache the failure, so a transient error retries on the next call.
    return []
  }
}

// ── Collection endpoints ─────────────────────────────────────────────────────

interface TMDBCollectionPart {
  id: number
  title: string
  release_date: string | null
  poster_path: string | null
}

interface TMDBCollectionResponse {
  id: number
  name: string
  parts: TMDBCollectionPart[]
}

/**
 * GET /3/collection/{id}
 * Returns the collection's name + all its parts (films), or null on any failure (404 / bad token).
 */
export async function getCollection(id: number): Promise<{
  id: number
  name: string
  parts: Array<{ id: number; title: string; release_date: string | null; poster_path: string | null }>
} | null> {
  try {
    const r = await tmdbFetch<TMDBCollectionResponse>(`/collection/${id}?language=en-US`)
    return {
      id: r.id,
      name: r.name,
      parts: (r.parts ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        release_date: p.release_date ?? null,
        poster_path: p.poster_path ?? null,
      })),
    }
  } catch {
    return null
  }
}

interface TMDBCollectionSearchResult {
  id: number
  name: string
  poster_path: string | null
}

interface TMDBCollectionSearchResponse {
  results: TMDBCollectionSearchResult[]
}

/**
 * GET /3/{movie|tv}/{id}/alternative_titles
 * Returns up to 20 unique non-empty alternative/AKA titles, or [] on any failure.
 * Used to populate monitored_items.alternative_titles so the grabber can search AKA-named releases.
 */
export async function getAlternativeTitles(tmdbId: number, type: 'movie' | 'tv'): Promise<string[]> {
  try {
    if (type === 'movie') {
      const data = await tmdbFetch<{ titles?: { title: string }[] }>(`/movie/${tmdbId}/alternative_titles`)
      return [...new Set((data.titles ?? []).map(t => t.title).filter(Boolean))].slice(0, 20)
    } else {
      const data = await tmdbFetch<{ results?: { title: string }[] }>(`/tv/${tmdbId}/alternative_titles`)
      return [...new Set((data.results ?? []).map(t => t.title).filter(Boolean))].slice(0, 20)
    }
  } catch {
    return []
  }
}

/**
 * GET /3/search/collection?query=...
 * Returns a list of matching TMDB collections (id + name + poster). Empty array on failure.
 */
export async function searchCollections(query: string): Promise<Array<{ id: number; name: string; poster_path: string | null }>> {
  try {
    const encoded = encodeURIComponent(query)
    const r = await tmdbFetch<TMDBCollectionSearchResponse>(`/search/collection?query=${encoded}&language=en-US`)
    return (r.results ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      poster_path: c.poster_path ?? null,
    }))
  } catch {
    return []
  }
}
