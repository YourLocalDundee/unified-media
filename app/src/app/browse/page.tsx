/**
 * browse/page.tsx
 *
 * The TMDB discovery surface. Every tab is TMDB discovery, cross-referenced against
 * the local library so "In Library" / request status show inline. Owned-media-by-type
 * browsing lives at /library, not here.
 *
 * Controls (work together):
 *   - Type tabs: ✦ Browse (All) · Movies · TV Shows  → media-type scope
 *   - Sort: Popularity / Top Rated / Newest / Oldest / Most Voted
 *   - Year filter, Min-rating filter, Genre pills (single-type only), name search
 *
 * Fetch strategy (within TMDB's API constraints):
 *   - Movies/TV (single type), no query → discoverTMDB(type, {sort,year,minRating,genre})
 *   - All, no filters set            → trending mixed feed (getTrendingContent)
 *   - All, filters set               → merge discoverTMDB('movie') + ('tv') at the same sort
 *   - Name search (any type)         → searchTMDB(q,type); year/minRating/sort applied to the
 *                                       returned page (TMDB /search has no sort_by)
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getItemsByTmdbIds } from '@/lib/media-server/library'
import { searchTMDB, getTrendingContent, getGenres, discoverTMDB } from '@/lib/media-server/tmdb'
import type { DiscoverSort, DiscoverDir, TMDBSearchResult } from '@/lib/media-server/tmdb'
import { getDb } from '@/lib/db/index'
import { requireAuth } from '@/lib/dal'
import { getUserRequests } from '@/lib/requests/monitor'
import type { RequestStatus, RequestType } from '@/lib/requests/types'
import DiscoverResults from './DiscoverResults'
import type { DiscoverItem } from './DiscoverResults'
import RescanButton from './RescanButton'

export const metadata: Metadata = {
  title: 'Browse — unified-frontend',
}

// ---------------------------------------------------------------------------
// Filter model
// ---------------------------------------------------------------------------

type ItemType = 'discover' | 'movies' | 'shows'
type DiscoverType = 'all' | 'movie' | 'tv'

const SORT_FIELDS: { value: DiscoverSort; label: string }[] = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'rating',     label: 'Rating' },
  { value: 'date',       label: 'Release Year' },
  { value: 'title',      label: 'Title' },
  { value: 'votes',      label: 'Vote Count' },
]
const VALID_SORTS: DiscoverSort[] = SORT_FIELDS.map((s) => s.value)
const VALID_DIRS: DiscoverDir[] = ['asc', 'desc']

// Default direction per field — what feels natural when first switching to a field.
const DEFAULT_DIR: Record<DiscoverSort, DiscoverDir> = {
  popularity: 'desc',
  rating:     'desc',
  date:       'desc',
  title:      'asc',
  votes:      'desc',
}

const MIN_RATING_OPTIONS = [0, 5, 6, 7, 8, 9]

type WatchedFilter = 'any' | 'watched' | 'in-progress' | 'unwatched'
const WATCHED_OPTIONS: { value: WatchedFilter; label: string }[] = [
  { value: 'any',         label: 'Any status' },
  { value: 'unwatched',   label: 'Unwatched' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'watched',     label: 'Watched' },
]

function discoverTypeFor(itemType: ItemType): DiscoverType {
  return itemType === 'movies' ? 'movie' : itemType === 'shows' ? 'tv' : 'all'
}

// Interleave two result lists so a merged movie+tv feed feels balanced (mirrors searchTMDB('all')).
function interleave(a: TMDBSearchResult[], b: TMDBSearchResult[]): TMDBSearchResult[] {
  const out: TMDBSearchResult[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

// Client-side sort for the name-search path (TMDB /search has no sort_by).
function sortResults(arr: TMDBSearchResult[], sort: DiscoverSort, dir: DiscoverDir): TMDBSearchResult[] {
  const c = [...arr]
  const asc = dir === 'asc'
  switch (sort) {
    case 'popularity': return c.sort((x, y) => asc ? (x.popularity ?? 0) - (y.popularity ?? 0) : (y.popularity ?? 0) - (x.popularity ?? 0))
    case 'rating':     return c.sort((x, y) => asc ? (x.rating ?? 0) - (y.rating ?? 0) : (y.rating ?? 0) - (x.rating ?? 0))
    case 'date':       return c.sort((x, y) => asc ? (x.year ?? 0) - (y.year ?? 0) : (y.year ?? 0) - (x.year ?? 0))
    case 'title':      return c.sort((x, y) => asc ? x.title.localeCompare(y.title) : y.title.localeCompare(x.title))
    case 'votes':      return c.sort((x, y) => asc ? (x.voteCount ?? 0) - (y.voteCount ?? 0) : (y.voteCount ?? 0) - (x.voteCount ?? 0))
    default:           return c
  }
}

const COUNT_OPTIONS = [10, 15, 20, 25, 50, 75, 100] as const
type BrowseCount = typeof COUNT_OPTIONS[number]
const DEFAULT_COUNT: BrowseCount = 20

interface FilterState {
  query?: string
  page: number
  itemType: ItemType
  discoverType: DiscoverType
  sort: DiscoverSort
  sortDir: DiscoverDir
  year?: number
  minRating?: number
  genreId?: number
  count: BrowseCount
  watchedFilter: WatchedFilter
}

// Build a /browse query string preserving the chosen subset of the current filters.
function buildQuery(f: FilterState, overrides: Omit<Partial<FilterState>, 'genreId'> & { genreId?: number | null } = {}): string {
  const s = { ...f, ...overrides }
  const p = new URLSearchParams()
  p.set('type', s.itemType)
  if (s.query) p.set('q', s.query)
  if (s.sort !== 'popularity') p.set('sort', s.sort)
  // Only write dir when it differs from the natural default for the chosen field
  if (s.sortDir !== DEFAULT_DIR[s.sort]) p.set('dir', s.sortDir)
  if (s.year) p.set('year', String(s.year))
  if (s.minRating) p.set('minRating', String(s.minRating))
  if (s.count !== DEFAULT_COUNT) p.set('count', String(s.count))
  if (s.watchedFilter !== 'any') p.set('watched', s.watchedFilter)
  // genreId override of null explicitly drops it (used when switching type)
  const genre = 'genreId' in overrides ? overrides.genreId : s.genreId
  if (genre) p.set('genre', String(genre))
  return `/browse?${p.toString()}`
}

interface BrowsePageProps {
  searchParams: Promise<{ q?: string; page?: string; type?: string; genre?: string; sort?: string; dir?: string; year?: string; minRating?: string; count?: string; watched?: string }>
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function TypeTabs({ f }: { f: FilterState }) {
  const tabs: { value: ItemType; label: string }[] = [
    { value: 'discover', label: '✦ Browse' },
    { value: 'movies',   label: 'Movies' },
    { value: 'shows',    label: 'TV Shows' },
  ]
  return (
    <div className="flex gap-1">
      {tabs.map((tab) => (
        <a
          key={tab.value}
          // Switching type keeps the search + sort/year/rating/count but drops genre (genre IDs are type-specific).
          href={buildQuery(f, { itemType: tab.value, genreId: null })}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            f.itemType === tab.value ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {tab.label}
        </a>
      ))}
    </div>
  )
}

function FilterBar({ f }: { f: FilterState }) {
  const placeholder =
    f.discoverType === 'movie' ? 'Search movies…' : f.discoverType === 'tv' ? 'Search TV shows…' : 'Search TMDB…'
  const currentYear = new Date().getFullYear()
  const years: number[] = []
  for (let y = currentYear; y >= 1950; y--) years.push(y)
  const select = 'rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/20 cursor-pointer'

  const isFiltered = f.query || f.year || f.minRating || f.sort !== 'popularity' ||
    f.sortDir !== DEFAULT_DIR[f.sort] || f.genreId || f.watchedFilter !== 'any'

  return (
    <form method="GET" action="/browse" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={f.query ?? ''}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-white/20"
      />

      {/* Sort field + direction toggle */}
      <div className="flex items-center gap-1">
        <select name="sort" defaultValue={f.sort} className={select} title="Sort by">
          {SORT_FIELDS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {/* Direction toggle — submits as a hidden field; clicking flips the value then submits */}
        <input type="hidden" name="dir" id="dir-input" defaultValue={f.sortDir} />
        <button
          type="button"
          title={f.sortDir === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
          className="flex items-center justify-center rounded-lg bg-zinc-800 px-2 py-2 text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-white/20"
          onClick={(e) => {
            const form = (e.currentTarget as HTMLElement).closest('form') as HTMLFormElement
            const input = form.querySelector('#dir-input') as HTMLInputElement
            input.value = input.value === 'desc' ? 'asc' : 'desc'
            form.requestSubmit()
          }}
        >
          {f.sortDir === 'desc'
            ? <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 12L3 6h10z"/></svg>
            : <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 4l5 6H3z"/></svg>
          }
        </button>
      </div>

      <select name="year" defaultValue={f.year?.toString() ?? ''} className={select} title="Year">
        <option value="">All years</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>

      <select name="minRating" defaultValue={f.minRating?.toString() ?? ''} className={select} title="Minimum rating">
        <option value="">Any rating</option>
        {MIN_RATING_OPTIONS.filter((r) => r > 0).map((r) => <option key={r} value={r}>{r}+ ★</option>)}
      </select>

      <select name="watched" defaultValue={f.watchedFilter} className={select} title="Watch status">
        {WATCHED_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select name="count" defaultValue={f.count} className={select} title="Results per page">
        {COUNT_OPTIONS.map((n) => <option key={n} value={n}>{n} / page</option>)}
      </select>

      {/* Preserve active type + genre across filter submits */}
      <input type="hidden" name="type" value={f.itemType} />
      {f.genreId && <input type="hidden" name="genre" value={f.genreId} />}

      <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200">
        Apply
      </button>

      {isFiltered && (
        <a href={`/browse?type=${f.itemType}`} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white hover:bg-zinc-700">
          Clear
        </a>
      )}
    </form>
  )
}

async function GenreFilterBar({ f }: { f: FilterState }) {
  // Genre pills are only meaningful for a single media type (genre IDs differ movie vs tv)
  // and only when browsing (not searching).
  if (f.discoverType === 'all' || f.query) return null
  const genres = await getGenres(f.discoverType).catch(() => [])
  if (genres.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      <a
        href={buildQuery(f, { genreId: null })}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          !f.genreId ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
      >
        All
      </a>
      {genres.map((g) => (
        <a
          key={g.id}
          href={buildQuery(f, { genreId: g.id })}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            f.genreId === g.id ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {g.name}
        </a>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discover grid
// ---------------------------------------------------------------------------

// Fetch one or more TMDB pages so we can fulfil the requested count.
// TMDB always returns 20 results per page; for counts > 20 we fan out to
// ceil(count/20) consecutive pages and concat the results.
async function fetchTMDBPages<T>(
  fetchOnePage: (page: number) => Promise<{ results: T[]; totalPages: number; totalResults: number } | null>,
  browsePageIndex: number,
  count: number,
): Promise<{ results: T[]; totalPages: number; totalResults: number }> {
  const TMDB_PAGE_SIZE = 20
  const pagesNeeded = Math.ceil(count / TMDB_PAGE_SIZE)
  const tmdbStart = (browsePageIndex - 1) * pagesNeeded + 1
  const tmdbPages = Array.from({ length: pagesNeeded }, (_, i) => tmdbStart + i)

  const responses = await Promise.all(tmdbPages.map((p) => fetchOnePage(p).catch(() => null)))
  const allResults = responses.flatMap((r) => r?.results ?? [])
  const tmdbTotalPages = responses[0]?.totalPages ?? 1
  const totalResults = responses[0]?.totalResults ?? 0
  // Browse page total = TMDB total pages divided by how many TMDB pages each browse page consumes.
  const browseTotalPages = Math.max(1, Math.ceil(tmdbTotalPages / pagesNeeded))
  return { results: allResults.slice(0, count), totalPages: browseTotalPages, totalResults }
}

async function fetchDiscover(f: FilterState): Promise<{ results: TMDBSearchResult[]; totalPages: number; totalResults: number }> {
  const { query, page, discoverType, sort, sortDir, year, minRating, genreId, count } = f

  if (query) {
    // Name search: TMDB /search has no sort_by; apply filters + sort client-side.
    const pagesNeeded = Math.ceil(count / 20)
    const tmdbStart = (page - 1) * pagesNeeded + 1
    const responses = await Promise.all(
      Array.from({ length: pagesNeeded }, (_, i) =>
        searchTMDB(query, discoverType, tmdbStart + i).catch(() => null)
      )
    )
    let results = responses.flatMap((r) => r?.results ?? [])
    if (year) results = results.filter((r) => r.year === year)
    if (minRating) results = results.filter((r) => (r.rating ?? 0) >= minRating)
    results = sortResults(results, sort, sortDir)
    const tmdbTotalPages = responses[0]?.totalPages ?? 1
    const totalResults = responses[0]?.totalResults ?? 0
    return {
      results: results.slice(0, count),
      totalPages: Math.max(1, Math.ceil(tmdbTotalPages / pagesNeeded)),
      totalResults,
    }
  }

  if (discoverType === 'all') {
    const filtersActive = sort !== 'popularity' || sortDir !== 'desc' || !!year || !!minRating
    if (!filtersActive) {
      return fetchTMDBPages(
        (p) => getTrendingContent('trending', p).catch(() => null),
        page,
        count,
      )
    }
    // Filtered all: merge movie + tv at every TMDB page
    const pagesNeeded = Math.ceil(count / 20)
    const tmdbStart = (page - 1) * pagesNeeded + 1
    const pageNums = Array.from({ length: pagesNeeded }, (_, i) => tmdbStart + i)
    const pairs = await Promise.all(
      pageNums.map((p) => Promise.all([
        discoverTMDB('movie', { sortBy: sort, sortDir, year, minRating, page: p }).catch(() => null),
        discoverTMDB('tv',    { sortBy: sort, sortDir, year, minRating, page: p }).catch(() => null),
      ]))
    )
    const allResults = pairs.flatMap(([m, tv]) => interleave(m?.results ?? [], tv?.results ?? []))
    const tmdbTotalPages = Math.max(pairs[0]?.[0]?.totalPages ?? 1, pairs[0]?.[1]?.totalPages ?? 1)
    const totalResults = (pairs[0]?.[0]?.totalResults ?? 0) + (pairs[0]?.[1]?.totalResults ?? 0)
    return {
      results: allResults.slice(0, count),
      totalPages: Math.max(1, Math.ceil(tmdbTotalPages / pagesNeeded)),
      totalResults,
    }
  }

  return fetchTMDBPages(
    (p) => discoverTMDB(discoverType, { genreId, sortBy: sort, sortDir, year, minRating, page: p }).catch(() => null),
    page,
    count,
  )
}

async function DiscoverGrid({ f, userId }: { f: FilterState; userId: string }) {
  const { results, totalPages, totalResults } = await fetchDiscover(f)

  // Batch TMDB-ID lookup against the local library to surface "In Library" / Watch.
  const tmdbIds = results.map((r) => r.tmdbId)
  const libraryMap = tmdbIds.length > 0 ? getItemsByTmdbIds(tmdbIds) : {}

  // ---------------------------------------------------------------------------
  // Watched-status filter — per-user, scoped to session userId (never leaks another
  // user's watch state). Only meaningful for items in the local library; items not
  // yet scanned have no watch state and are always treated as "unwatched".
  // ---------------------------------------------------------------------------
  type WatchRow = { tmdb_id: number; played: number; position_ticks: number }
  let filteredResults = results
  if (f.watchedFilter !== 'any' && tmdbIds.length > 0) {
    // Look up watch state for every result in one parameterized query.
    // idx_watch_state_user_media (user_id, media_id) covers the join.
    const placeholders = tmdbIds.map(() => '?').join(',')
    const watchRows = getDb()
      .prepare(
        `SELECT mi.tmdb_id, mws.played, mws.position_ticks
         FROM media_items mi
         LEFT JOIN media_watch_state mws
           ON mws.media_id = mi.id AND mws.user_id = ?
         WHERE mi.tmdb_id IN (${placeholders})
           AND mi.type IN ('movie', 'series')`
      )
      .all(userId, ...tmdbIds) as WatchRow[]

    // Build a map: tmdbId → { played, position_ticks } (NULL from LEFT JOIN → not in library)
    const watchMap = new Map<number, { played: number; positionTicks: number }>()
    for (const row of watchRows) {
      watchMap.set(row.tmdb_id, {
        played: row.played ?? 0,
        positionTicks: row.position_ticks ?? 0,
      })
    }

    filteredResults = results.filter((r) => {
      const ws = watchMap.get(r.tmdbId)
      if (!ws) {
        // Not in library — counts as unwatched for filter purposes
        return f.watchedFilter === 'unwatched'
      }
      const isWatched    = ws.played === 1
      const isInProgress = ws.positionTicks > 0 && ws.played === 0
      const isUnwatched  = !isWatched && !isInProgress
      switch (f.watchedFilter) {
        case 'watched':     return isWatched
        case 'in-progress': return isInProgress
        case 'unwatched':   return isUnwatched
        default:            return true
      }
    })
  }

  // Per-user request status (expired excluded so the item is requestable again).
  const userRequests = getUserRequests(userId)
  const requestMap: Record<string, { status: RequestStatus; requestType: RequestType }> = {}
  for (const req of userRequests) {
    if (req.status === 'expired') continue
    requestMap[`${req.media_type}-${req.tmdb_id}`] = { status: req.status, requestType: req.request_type }
  }

  const items: DiscoverItem[] = filteredResults.map((r) => ({
    tmdbId: r.tmdbId,
    mediaType: r.mediaType,
    title: r.title,
    year: r.year,
    posterPath: r.posterPath,
    rating: r.rating,
    overview: r.overview,
    libraryId: libraryMap[r.tmdbId] ?? null,
    requestStatus: requestMap[`${r.mediaType}-${r.tmdbId}`]?.status ?? null,
    requestType: requestMap[`${r.mediaType}-${r.tmdbId}`]?.requestType ?? null,
  }))

  return (
    <div className="flex flex-col gap-6">
      <GenreFilterBar f={f} />

      {f.query && results.length > 0 && (
        <p className="text-sm text-zinc-400">
          {totalResults.toLocaleString()} result{totalResults !== 1 ? 's' : ''} for &ldquo;{f.query}&rdquo;
          {(f.year || f.minRating || f.sort !== 'popularity') && ' (sort/filters applied to this page)'}
        </p>
      )}

      <DiscoverResults items={items} query={f.query} />

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3">
          {f.page > 1 && (
            <a href={buildQuery(f, { page: f.page - 1 })} className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700">Prev</a>
          )}
          <span className="text-sm text-zinc-400">Page {f.page} of {totalPages}</span>
          {f.page < totalPages && (
            <a href={buildQuery(f, { page: f.page + 1 })} className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700">Next</a>
          )}
        </nav>
      )}
    </div>
  )
}

function BrowseGridSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-4 w-32 animate-pulse rounded bg-zinc-800" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {Array.from({ length: 18 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="aspect-[2/3] animate-pulse rounded-lg bg-zinc-800" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const session = await requireAuth()
  const params = await searchParams

  const itemType: ItemType = (['movies', 'shows', 'discover'].includes(params.type ?? '')
    ? params.type
    : 'discover') as ItemType

  // Map legacy flat sort values (oldest/newest) to field+dir
  const sortRaw = params.sort ?? 'popularity'
  let sort: DiscoverSort
  let legacyDir: DiscoverDir | null = null
  if (sortRaw === 'newest')  { sort = 'date'; legacyDir = 'desc' }
  else if (sortRaw === 'oldest') { sort = 'date'; legacyDir = 'asc' }
  else sort = (VALID_SORTS as string[]).includes(sortRaw) ? (sortRaw as DiscoverSort) : 'popularity'

  const dirRaw = params.dir
  const sortDir: DiscoverDir = legacyDir ??
    (VALID_DIRS.includes(dirRaw as DiscoverDir) ? (dirRaw as DiscoverDir) : DEFAULT_DIR[sort])

  const yearN = params.year ? parseInt(params.year, 10) : NaN
  const minRatingN = params.minRating ? parseInt(params.minRating, 10) : NaN
  const countRaw = params.count ? parseInt(params.count, 10) : DEFAULT_COUNT
  const count: BrowseCount = (COUNT_OPTIONS as readonly number[]).includes(countRaw)
    ? (countRaw as BrowseCount)
    : DEFAULT_COUNT
  const watchedFilter: WatchedFilter =
    (['any', 'watched', 'in-progress', 'unwatched'] as WatchedFilter[]).includes(params.watched as WatchedFilter)
      ? (params.watched as WatchedFilter)
      : 'any'

  const f: FilterState = {
    query: params.q?.trim() || undefined,
    page: Math.max(1, parseInt(params.page ?? '1', 10) || 1),
    itemType,
    discoverType: discoverTypeFor(itemType),
    sort,
    sortDir,
    year: Number.isFinite(yearN) ? yearN : undefined,
    minRating: Number.isFinite(minRatingN) && minRatingN > 0 ? minRatingN : undefined,
    genreId: params.genre ? parseInt(params.genre, 10) || undefined : undefined,
    count,
    watchedFilter,
  }
  // Genre only applies to single-type browsing.
  if (f.discoverType === 'all' || f.query) f.genreId = undefined

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Browse</h1>
            <RescanButton />
          </div>

          <FilterBar f={f} />
          <TypeTabs f={f} />
        </div>

        <Suspense fallback={<BrowseGridSkeleton />}>
          <DiscoverGrid f={f} userId={session.userId} />
        </Suspense>
      </div>
    </div>
  )
}
