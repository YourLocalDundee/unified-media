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
import type { DiscoverSort, TMDBSearchResult } from '@/lib/media-server/tmdb'
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

const SORT_OPTIONS: { value: DiscoverSort; label: string }[] = [
  { value: 'popularity', label: 'Popularity' },
  { value: 'rating',     label: 'Top Rated' },
  { value: 'newest',     label: 'Newest' },
  { value: 'oldest',     label: 'Oldest' },
  { value: 'votes',      label: 'Most Voted' },
]
const VALID_SORTS = SORT_OPTIONS.map((s) => s.value)
const MIN_RATING_OPTIONS = [0, 5, 6, 7, 8, 9]

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

// Client-side sort for the name-search path (TMDB /search has no sort_by). 'votes' is a
// no-op (search results carry no vote count) — fall back to TMDB's relevance order.
function sortResults(arr: TMDBSearchResult[], sort: DiscoverSort): TMDBSearchResult[] {
  const c = [...arr]
  switch (sort) {
    case 'rating': return c.sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0))
    case 'newest': return c.sort((x, y) => (y.year ?? 0) - (x.year ?? 0))
    case 'oldest': return c.sort((x, y) => (x.year ?? 0) - (y.year ?? 0))
    default:       return c
  }
}

interface FilterState {
  query?: string
  page: number
  itemType: ItemType
  discoverType: DiscoverType
  sort: DiscoverSort
  year?: number
  minRating?: number
  genreId?: number
}

// Build a /browse query string preserving the chosen subset of the current filters.
function buildQuery(f: FilterState, overrides: Omit<Partial<FilterState>, 'genreId'> & { genreId?: number | null } = {}): string {
  const s = { ...f, ...overrides }
  const p = new URLSearchParams()
  p.set('type', s.itemType)
  if (s.query) p.set('q', s.query)
  if (s.sort !== 'popularity') p.set('sort', s.sort)
  if (s.year) p.set('year', String(s.year))
  if (s.minRating) p.set('minRating', String(s.minRating))
  // genreId override of null explicitly drops it (used when switching type)
  const genre = 'genreId' in overrides ? overrides.genreId : s.genreId
  if (genre) p.set('genre', String(genre))
  return `/browse?${p.toString()}`
}

interface BrowsePageProps {
  searchParams: Promise<{ q?: string; page?: string; type?: string; genre?: string; sort?: string; year?: string; minRating?: string }>
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
          // Switching type keeps the search + sort/year/rating but drops genre (genre IDs are type-specific).
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

  return (
    <form method="GET" action="/browse" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={f.query ?? ''}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-white/20"
      />

      <select name="sort" defaultValue={f.sort} className={select} title="Sort">
        {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select name="year" defaultValue={f.year?.toString() ?? ''} className={select} title="Year">
        <option value="">All years</option>
        {years.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>

      <select name="minRating" defaultValue={f.minRating?.toString() ?? ''} className={select} title="Minimum rating">
        <option value="">Any rating</option>
        {MIN_RATING_OPTIONS.filter((r) => r > 0).map((r) => <option key={r} value={r}>{r}+ ★</option>)}
      </select>

      {/* Preserve the active type + genre across a filter submit. */}
      <input type="hidden" name="type" value={f.itemType} />
      {f.genreId && <input type="hidden" name="genre" value={f.genreId} />}

      <button type="submit" className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200">
        Apply
      </button>

      {(f.query || f.year || f.minRating || f.sort !== 'popularity' || f.genreId) && (
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

async function fetchDiscover(f: FilterState): Promise<{ results: TMDBSearchResult[]; totalPages: number; totalResults: number }> {
  const { query, page, discoverType, sort, year, minRating, genreId } = f

  if (query) {
    const data = await searchTMDB(query, discoverType, page).catch(() => null)
    let results = data?.results ?? []
    if (year) results = results.filter((r) => r.year === year)
    if (minRating) results = results.filter((r) => (r.rating ?? 0) >= minRating)
    results = sortResults(results, sort)
    return { results, totalPages: data?.totalPages ?? 0, totalResults: data?.totalResults ?? 0 }
  }

  if (discoverType === 'all') {
    const filtersActive = sort !== 'popularity' || !!year || !!minRating
    if (!filtersActive) {
      const t = await getTrendingContent('trending', page).catch(() => null)
      return { results: t?.results ?? [], totalPages: t?.totalPages ?? 0, totalResults: t?.totalResults ?? 0 }
    }
    const [m, tv] = await Promise.all([
      discoverTMDB('movie', { sortBy: sort, year, minRating, page }).catch(() => null),
      discoverTMDB('tv', { sortBy: sort, year, minRating, page }).catch(() => null),
    ])
    return {
      results: interleave(m?.results ?? [], tv?.results ?? []),
      totalPages: Math.max(m?.totalPages ?? 0, tv?.totalPages ?? 0),
      totalResults: (m?.totalResults ?? 0) + (tv?.totalResults ?? 0),
    }
  }

  const data = await discoverTMDB(discoverType, { genreId, sortBy: sort, year, minRating, page }).catch(() => null)
  return { results: data?.results ?? [], totalPages: data?.totalPages ?? 0, totalResults: data?.totalResults ?? 0 }
}

async function DiscoverGrid({ f, userId }: { f: FilterState; userId: string }) {
  const { results, totalPages, totalResults } = await fetchDiscover(f)

  // Batch TMDB-ID lookup against the local library to surface "In Library" / Watch.
  const tmdbIds = results.map((r) => r.tmdbId)
  const libraryMap = tmdbIds.length > 0 ? getItemsByTmdbIds(tmdbIds) : {}

  // Per-user request status (expired excluded so the item is requestable again).
  const userRequests = getUserRequests(userId)
  const requestMap: Record<string, { status: RequestStatus; requestType: RequestType }> = {}
  for (const req of userRequests) {
    if (req.status === 'expired') continue
    requestMap[`${req.media_type}-${req.tmdb_id}`] = { status: req.status, requestType: req.request_type }
  }

  const items: DiscoverItem[] = results.map((r) => ({
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
  const sortRaw = params.sort ?? 'popularity'
  const sort: DiscoverSort = (VALID_SORTS as string[]).includes(sortRaw) ? (sortRaw as DiscoverSort) : 'popularity'
  const yearN = params.year ? parseInt(params.year, 10) : NaN
  const minRatingN = params.minRating ? parseInt(params.minRating, 10) : NaN

  const f: FilterState = {
    query: params.q?.trim() || undefined,
    page: Math.max(1, parseInt(params.page ?? '1', 10) || 1),
    itemType,
    discoverType: discoverTypeFor(itemType),
    sort,
    year: Number.isFinite(yearN) ? yearN : undefined,
    minRating: Number.isFinite(minRatingN) && minRatingN > 0 ? minRatingN : undefined,
    genreId: params.genre ? parseInt(params.genre, 10) || undefined : undefined,
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
