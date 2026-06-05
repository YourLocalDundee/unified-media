/**
 * browse/page.tsx
 *
 * Main browse page — entry point for all content discovery. Supports two modes:
 *   - "discover" (default): TMDB trending/popular/genre browsing, cross-referenced
 *     against the local library so "In Library" / request status are shown inline.
 *   - "library" (all / movies / shows): paginated grid of locally available media,
 *     driven entirely by the native media server (no TMDB network calls).
 *
 * All data fetching happens in async Server Components so there are no client
 * waterfalls. The page shell renders instantly while Suspense handles the grid.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import MediaCard from '@/components/media/MediaCard'
import { getItemsByType, searchItems, getTotalCount, getAvailableFilters, getItemsByTmdbIds } from '@/lib/media-server/library'
import { searchTMDB, getTrendingContent, getGenres, discoverByGenre } from '@/lib/media-server/tmdb'
import type { TrendingCategory } from '@/lib/media-server/tmdb'
import type { MediaItem } from '@/lib/media-server/types'
import { requireAuth } from '@/lib/dal'
import { getUserRequests } from '@/lib/requests/monitor'
import type { RequestStatus } from '@/lib/requests/types'
import type { RequestType } from '@/lib/requests/types'
import DiscoverResults from './DiscoverResults'
import type { DiscoverItem } from './DiscoverResults'
import RescanButton from './RescanButton'

export const metadata: Metadata = {
  title: 'Browse — unified-frontend',
}

type SortKey = 'title_asc' | 'title_desc' | 'year_desc' | 'year_asc' | 'added_desc' | 'added_asc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title_asc',  label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'year_desc',  label: 'Year (Newest)' },
  { value: 'year_asc',   label: 'Year (Oldest)' },
  { value: 'added_desc', label: 'Date Added (Newest)' },
  { value: 'added_asc',  label: 'Date Added (Oldest)' },
]

const TRENDING_CATEGORIES: { value: TrendingCategory; label: string }[] = [
  { value: 'trending',         label: 'Trending' },
  { value: 'popular-movies',   label: 'Popular Movies' },
  { value: 'popular-tv',       label: 'Popular TV' },
  { value: 'top-rated-movies', label: 'Top Rated Movies' },
  { value: 'top-rated-tv',     label: 'Top Rated TV' },
]

interface BrowsePageProps {
  searchParams: Promise<{ q?: string; page?: string; type?: string; year?: string; sort?: string; cat?: string; genre?: string; count?: string }>
}

// ---------------------------------------------------------------------------
// Library Grid
// ---------------------------------------------------------------------------

async function BrowseGrid({
  query,
  page,
  itemType,
  year,
  sort,
  count,
}: {
  query?: string
  page: number
  itemType: string
  year?: number
  sort: SortKey
  count: number
}) {
  const limit = count
  const offset = (page - 1) * limit

  let items: MediaItem[] = []
  let totalCount = 0

  if (query && query.trim().length > 0) {
    items = await searchItems(query.trim(), limit)
    // Search returns all matches up to limit; no server-side pagination for search results
    totalCount = items.length
  } else if (itemType === 'movies') {
    items = getItemsByType('movie', limit, offset, year, sort)
    const counts = getTotalCount()
    // When filtering by year, the full count is unknown without scanning — use actual slice length
    totalCount = year ? items.length : counts.movies
  } else if (itemType === 'shows') {
    items = getItemsByType('series', limit, offset, year, sort)
    const counts = getTotalCount()
    totalCount = year ? items.length : counts.series
  } else {
    // "all" mode: pull an equal split of movies and series then re-sort in memory.
    // This means "all" is always one page — no offset pagination across mixed types.
    const half = Math.floor(limit / 2)
    const movies = getItemsByType('movie', half, 0, year, sort)
    const series = getItemsByType('series', half, 0, year, sort)
    items = [...movies, ...series].sort((a, b) => {
      if (sort === 'added_desc') return b.added_at - a.added_at
      if (sort === 'added_asc')  return a.added_at - b.added_at
      if (sort === 'year_desc')  return (b.year ?? 0) - (a.year ?? 0)
      if (sort === 'year_asc')   return (a.year ?? 0) - (b.year ?? 0)
      if (sort === 'title_desc') return (b.sort_title ?? b.title).localeCompare(a.sort_title ?? a.title)
      const aKey = (a.sort_title ?? a.title).toLowerCase()
      const bKey = (b.sort_title ?? b.title).toLowerCase()
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0
    })
    const counts = getTotalCount()
    totalCount = year ? items.length : counts.movies + counts.series
  }

  // "all" view and year-filtered views are single-page — pagination would require
  // knowing the combined sorted position across two separate collections.
  const totalPages = (itemType === 'all' || year) ? 1 : Math.ceil(totalCount / limit)

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-400">
        {query
          ? `${totalCount} result${totalCount !== 1 ? 's' : ''} for "${query}"`
          : `${totalCount.toLocaleString()} item${totalCount !== 1 ? 's' : ''}`}
      </p>

      {items.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-zinc-500">
          {query ? 'No results found.' : 'No items in library.'}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {items.map((item) => (
            <MediaCard
              key={item.id}
              id={item.id}
              title={item.title}
              year={item.year ?? undefined}
              imageUrl={item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : undefined}
              type={item.type === 'movie' ? 'Movie' : 'Series'}
            />
          ))}
        </div>
      )}

      {!query && !year && totalPages > 1 && (
        <Pagination currentPage={page} totalPages={totalPages} itemType={itemType} sort={sort} count={count} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discover Grid (TMDB search or trending/popular with library cross-reference)
// ---------------------------------------------------------------------------

function TrendingCategoryTabs({ active, query }: { active: TrendingCategory; query?: string }) {
  const qParam = query ? `&q=${encodeURIComponent(query)}` : ''
  return (
    <div className="flex flex-wrap gap-2">
      {TRENDING_CATEGORIES.map((cat) => (
        <a
          key={cat.value}
          href={`/browse?type=discover&cat=${cat.value}${qParam}`}
          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            active === cat.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {cat.label}
        </a>
      ))}
    </div>
  )
}

async function GenreFilterBar({
  genreType,
  activeGenreId,
  category,
  query,
}: {
  genreType: 'movie' | 'tv'
  activeGenreId?: number
  category: TrendingCategory
  query?: string
}) {
  const genres = await getGenres(genreType).catch(() => [])
  if (genres.length === 0) return null
  const base = `?type=discover&cat=${category}${query ? `&q=${encodeURIComponent(query)}` : ''}`
  return (
    <div className="flex flex-wrap gap-1.5">
      <a
        href={base}
        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          !activeGenreId ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
        }`}
      >
        All
      </a>
      {genres.map((g) => (
        <a
          key={g.id}
          href={`${base}&genre=${g.id}`}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            activeGenreId === g.id ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {g.name}
        </a>
      ))}
    </div>
  )
}

async function DiscoverGrid({
  query,
  page,
  category,
  genreId,
  userId,
}: {
  query?: string
  page: number
  category: TrendingCategory
  genreId?: number
  userId: string
}) {
  let results: Awaited<ReturnType<typeof searchTMDB>>['results'] = []
  let totalResults = 0
  let totalPages = 0

  if (query && query.trim().length > 0) {
    const searchData = await searchTMDB(query.trim(), 'all', page).catch(() => null)
    results = searchData?.results ?? []
    totalResults = searchData?.totalResults ?? 0
    totalPages = searchData?.totalPages ?? 0
  } else if (genreId) {
    const genreType: 'movie' | 'tv' =
      category === 'popular-tv' || category === 'top-rated-tv' ? 'tv' : 'movie'
    const genreData = await discoverByGenre(genreType, genreId, page).catch(() => null)
    results = genreData?.results ?? []
    totalResults = genreData?.totalResults ?? 0
    totalPages = genreData?.totalPages ?? 0
  } else {
    const trendData = await getTrendingContent(category, page).catch(() => null)
    results = trendData?.results ?? []
    totalResults = trendData?.totalResults ?? 0
    totalPages = trendData?.totalPages ?? 0
  }

  // Batch TMDB-ID lookup against local library to get native item IDs in one pass
  const tmdbIds = results.map((r) => r.tmdbId)
  const libraryMap = tmdbIds.length > 0 ? getItemsByTmdbIds(tmdbIds) : {}

  // Build request status map for current user so each card reflects the user's own state.
  // Expired slots are excluded so the item appears requestable again rather than stuck.
  const userRequests = getUserRequests(userId)
  const requestMap: Record<string, { status: RequestStatus; requestType: RequestType }> = {}
  for (const req of userRequests) {
    if (req.status === 'expired') continue
    // Composite key avoids collision between movie/tv items that share a TMDB ID
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

  const pageBase = query
    ? `?type=discover&q=${encodeURIComponent(query)}`
    : genreId
    ? `?type=discover&cat=${category}&genre=${genreId}`
    : `?type=discover&cat=${category}`

  // Determine genreType for the filter bar
  const genreType: 'movie' | 'tv' =
    category === 'popular-tv' || category === 'top-rated-tv' ? 'tv' : 'movie'

  return (
    <div className="flex flex-col gap-6">
      {/* Category tabs only when not searching */}
      {!query && <TrendingCategoryTabs active={category} />}

      {/* Genre filter bar only when not searching */}
      {!query && (
        <GenreFilterBar
          genreType={genreType}
          activeGenreId={genreId}
          category={category}
          query={query}
        />
      )}

      {query && results.length > 0 && (
        <p className="text-sm text-zinc-400">
          {totalResults.toLocaleString()} result{totalResults !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
        </p>
      )}

      <DiscoverResults items={items} query={query} />

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3">
          {page > 1 && (
            <a href={`${pageBase}&page=${page - 1}`}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700">Prev</a>
          )}
          <span className="text-sm text-zinc-400">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`${pageBase}&page=${page + 1}`}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700">Next</a>
          )}
        </nav>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function Pagination({
  currentPage,
  totalPages,
  itemType,
  sort,
  count,
  year,
}: {
  currentPage: number
  totalPages: number
  itemType: string
  sort: SortKey
  count: number
  year?: number
}) {
  const extra = `&sort=${sort}&count=${count}${year ? `&year=${year}` : ''}`
  const prev = currentPage - 1
  const next = currentPage + 1
  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || (p >= currentPage - 2 && p <= currentPage + 2)
  )

  return (
    <nav className="flex items-center justify-center gap-1 flex-wrap" aria-label="Pagination">
      {currentPage > 1 && (
        <a href={`?page=${prev}&type=${itemType}${extra}`}
          className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">Prev</a>
      )}
      {pageNums.map((p, idx) => {
        const prevNum = pageNums[idx - 1]
        const showEllipsis = prevNum !== undefined && p - prevNum > 1
        return (
          <span key={p} className="flex items-center gap-1">
            {showEllipsis && <span className="px-1 text-zinc-500">…</span>}
            <a href={`?page=${p}&type=${itemType}${extra}`}
              className={`rounded px-3 py-1.5 text-sm ${p === currentPage ? 'bg-white text-black font-semibold' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
              {p}
            </a>
          </span>
        )
      })}
      {currentPage < totalPages && (
        <a href={`?page=${next}&type=${itemType}${extra}`}
          className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">Next</a>
      )}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

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
// Filter bar
// ---------------------------------------------------------------------------

const COUNT_OPTIONS = [10, 25, 50, 100] as const
type PageCount = typeof COUNT_OPTIONS[number]

function FilterBar({
  query,
  sort,
  year,
  itemType,
  years,
  isDiscover,
  count,
}: {
  query?: string
  sort: SortKey
  year?: number
  itemType: string
  years: number[]
  isDiscover: boolean
  count: number
}) {
  return (
    <form method="GET" action="/browse" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={query ?? ''}
        placeholder={isDiscover ? 'Search TMDB…' : 'Search library…'}
        className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-white/20"
      />

      {!isDiscover && years.length > 0 && (
        <select
          name="year"
          defaultValue={year?.toString() ?? ''}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/20 cursor-pointer"
        >
          <option value="">All years</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}

      {!isDiscover && (
        <select
          name="sort"
          defaultValue={sort}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/20 cursor-pointer"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {!isDiscover && (
        <select
          name="count"
          defaultValue={count}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/20 cursor-pointer"
          title="Items per page"
        >
          {COUNT_OPTIONS.map((n) => (
            <option key={n} value={n}>{n} / page</option>
          ))}
        </select>
      )}

      <input type="hidden" name="type" value={itemType} />

      <button
        type="submit"
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
      >
        {isDiscover ? 'Search' : 'Apply'}
      </button>

      {(query || year) && (
        <a
          href={`/browse?type=${itemType}&sort=${sort}`}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white hover:bg-zinc-700"
        >
          Clear
        </a>
      )}
    </form>
  )
}

// ---------------------------------------------------------------------------
// Type tabs
// ---------------------------------------------------------------------------

function TypeTabs({ active, query, sort, year, count }: { active: string; query?: string; sort: SortKey; year?: number; count: number }) {
  const tabs = [
    { value: 'discover', label: '✦ Browse' },
    { value: 'movies',   label: 'Movies' },
    { value: 'shows',    label: 'TV Shows' },
  ]
  const extra = `&sort=${sort}&count=${count}${year ? `&year=${year}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}`
  return (
    <div className="flex gap-1">
      {tabs.map((tab) => (
        <a
          key={tab.value}
          href={`/browse?type=${tab.value}${extra}`}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.value
              ? 'bg-white text-black'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {tab.label}
        </a>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const VALID_TREND_CATS = ['trending','popular-movies','popular-tv','top-rated-movies','top-rated-tv'] as const

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const session = await requireAuth()
  const params = await searchParams
  const query    = params.q?.trim() || undefined
  const page     = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const itemType = ['movies', 'shows', 'all', 'discover'].includes(params.type ?? '')
    ? (params.type ?? 'discover')
    : 'discover'
  const isDiscover = itemType === 'discover'
  const year     = (!isDiscover && params.year) ? parseInt(params.year, 10) || undefined : undefined
  const sortRaw  = params.sort ?? 'title_asc'
  const sort: SortKey = (['title_asc','title_desc','year_desc','year_asc','added_desc','added_asc'] as SortKey[]).includes(sortRaw as SortKey)
    ? (sortRaw as SortKey)
    : 'title_asc'

  const catRaw = params.cat ?? 'trending'
  const trendCategory: TrendingCategory = (VALID_TREND_CATS as readonly string[]).includes(catRaw)
    ? (catRaw as TrendingCategory)
    : 'trending'

  const genreId = params.genre ? parseInt(params.genre, 10) || undefined : undefined

  const VALID_COUNTS = [10, 25, 50, 100] as const
  const rawCount = parseInt(params.count ?? '25', 10)
  const count: PageCount = (VALID_COUNTS as readonly number[]).includes(rawCount)
    ? (rawCount as PageCount)
    : 25

  const filterType = itemType === 'movies' ? 'movie' : itemType === 'shows' ? 'series' : undefined
  const filters = isDiscover ? { genres: [], years: [] } : getAvailableFilters(filterType)

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Browse</h1>
            <RescanButton />
          </div>

          <FilterBar
            query={query}
            sort={sort}
            year={year}
            itemType={itemType}
            years={filters.years}
            isDiscover={isDiscover}
            count={count}
          />

          <TypeTabs active={itemType} query={query} sort={sort} year={year} count={count} />
        </div>

        {isDiscover ? (
          <Suspense fallback={<BrowseGridSkeleton />}>
            <DiscoverGrid
              query={query}
              page={page}
              category={trendCategory}
              genreId={genreId}
              userId={session.userId}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<BrowseGridSkeleton />}>
            <BrowseGrid query={query} page={page} itemType={itemType} year={year} sort={sort} count={count} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
