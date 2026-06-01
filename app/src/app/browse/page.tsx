import { Suspense } from 'react'
import type { Metadata } from 'next'
import MediaCard from '@/components/media/MediaCard'
import { getItemsByType, searchItems, getTotalCount, getAvailableFilters, getItemsByTmdbIds } from '@/lib/media-server/library'
import { searchTMDB } from '@/lib/media-server/tmdb'
import type { MediaItem } from '@/lib/media-server/types'
import { requireAuth } from '@/lib/dal'
import DiscoverResults from './DiscoverResults'
import type { DiscoverItem } from './DiscoverResults'

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

interface BrowsePageProps {
  searchParams: Promise<{ q?: string; page?: string; type?: string; year?: string; sort?: string }>
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
}: {
  query?: string
  page: number
  itemType: string
  year?: number
  sort: SortKey
}) {
  const limit = 60
  const offset = (page - 1) * limit

  let items: MediaItem[] = []
  let totalCount = 0

  if (query && query.trim().length > 0) {
    items = await searchItems(query.trim(), limit)
    totalCount = items.length
  } else if (itemType === 'movies') {
    items = getItemsByType('movie', limit, offset, year, sort)
    const counts = getTotalCount()
    totalCount = year ? items.length : counts.movies
  } else if (itemType === 'shows') {
    items = getItemsByType('series', limit, offset, year, sort)
    const counts = getTotalCount()
    totalCount = year ? items.length : counts.series
  } else {
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
        <Pagination currentPage={page} totalPages={totalPages} itemType={itemType} sort={sort} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Discover Grid (TMDB search with library cross-reference)
// ---------------------------------------------------------------------------

async function DiscoverGrid({
  query,
  page,
  mediaType,
}: {
  query?: string
  page: number
  mediaType: 'all' | 'movie' | 'tv'
}) {
  if (!query) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-zinc-500">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
        <p className="text-lg">Search TMDB to discover movies and TV shows</p>
        <p className="text-sm">Use the search bar above — anything not in your library shows a Request button</p>
      </div>
    )
  }

  const tmdbType = mediaType === 'all' ? 'all' : mediaType
  const searchData = await searchTMDB(query, tmdbType, page).catch(() => null)
  const results = searchData?.results ?? []
  const totalResults = searchData?.totalResults ?? 0
  const totalPages = searchData?.totalPages ?? 0

  // Cross-reference with local library by tmdb_id
  const tmdbIds = results.map((r) => r.tmdbId)
  const libraryMap = tmdbIds.length > 0 ? getItemsByTmdbIds(tmdbIds) : {}

  const items: DiscoverItem[] = results.map((r) => ({
    tmdbId: r.tmdbId,
    mediaType: r.mediaType,
    title: r.title,
    year: r.year,
    posterPath: r.posterPath,
    rating: r.rating,
    overview: r.overview,
    libraryId: libraryMap[r.tmdbId] ?? null,
  }))

  return (
    <div className="flex flex-col gap-6">
      {results.length > 0 && (
        <p className="text-sm text-zinc-400">
          {totalResults.toLocaleString()} result{totalResults !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
        </p>
      )}

      <DiscoverResults items={items} query={query} />

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-3">
          {page > 1 && (
            <a href={`?type=discover&q=${encodeURIComponent(query)}&page=${page - 1}`}
              className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700">Prev</a>
          )}
          <span className="text-sm text-zinc-400">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <a href={`?type=discover&q=${encodeURIComponent(query)}&page=${page + 1}`}
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
  year,
}: {
  currentPage: number
  totalPages: number
  itemType: string
  sort: SortKey
  year?: number
}) {
  const extra = `&sort=${sort}${year ? `&year=${year}` : ''}`
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

function FilterBar({
  query,
  sort,
  year,
  itemType,
  years,
  isDiscover,
}: {
  query?: string
  sort: SortKey
  year?: number
  itemType: string
  years: number[]
  isDiscover: boolean
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

function TypeTabs({ active, query, sort, year }: { active: string; query?: string; sort: SortKey; year?: number }) {
  const tabs = [
    { value: 'all',      label: 'All' },
    { value: 'movies',   label: 'Movies' },
    { value: 'shows',    label: 'TV Shows' },
    { value: 'discover', label: 'Discover' },
  ]
  const extra = `&sort=${sort}${year ? `&year=${year}` : ''}${query ? `&q=${encodeURIComponent(query)}` : ''}`
  return (
    <div className="flex gap-1">
      {tabs.map((tab) => (
        <a
          key={tab.value}
          href={`/browse?type=${tab.value}${extra}`}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.value
              ? tab.value === 'discover'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white text-black'
              : tab.value === 'discover'
              ? 'bg-primary/20 text-primary hover:bg-primary/30'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {tab.value === 'discover' ? '✦ Discover' : tab.label}
        </a>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  await requireAuth()
  const params = await searchParams
  const query    = params.q?.trim() || undefined
  const page     = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const itemType = ['movies', 'shows', 'all', 'discover'].includes(params.type ?? '')
    ? (params.type ?? 'all')
    : 'all'
  const isDiscover = itemType === 'discover'
  const year     = (!isDiscover && params.year) ? parseInt(params.year, 10) || undefined : undefined
  const sortRaw  = params.sort ?? 'title_asc'
  const sort: SortKey = (['title_asc','title_desc','year_desc','year_asc','added_desc','added_asc'] as SortKey[]).includes(sortRaw as SortKey)
    ? (sortRaw as SortKey)
    : 'title_asc'

  const filterType = itemType === 'movies' ? 'movie' : itemType === 'shows' ? 'series' : undefined
  const filters = isDiscover ? { genres: [], years: [] } : getAvailableFilters(filterType)

  // Discover media type tab (separate from library type)
  const discoverMediaType: 'all' | 'movie' | 'tv' =
    isDiscover && (params.type === 'discover')
      ? (params.sort === 'movie' || params.sort === 'tv' ? (params.sort as 'movie' | 'tv') : 'all')
      : 'all'

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4">
          <h1 className="text-3xl font-bold tracking-tight">Browse</h1>

          <FilterBar
            query={query}
            sort={sort}
            year={year}
            itemType={itemType}
            years={filters.years}
            isDiscover={isDiscover}
          />

          <TypeTabs active={itemType} query={query} sort={sort} year={year} />
        </div>

        {isDiscover ? (
          <Suspense fallback={<BrowseGridSkeleton />}>
            <DiscoverGrid query={query} page={page} mediaType={discoverMediaType} />
          </Suspense>
        ) : (
          <Suspense fallback={<BrowseGridSkeleton />}>
            <BrowseGrid query={query} page={page} itemType={itemType} year={year} sort={sort} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
