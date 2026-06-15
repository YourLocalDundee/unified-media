/**
 * browse/page.tsx
 *
 * Main browse page — the discovery surface. Every tab browses TMDB
 * (discoverable content), cross-referenced against the local library so
 * "In Library" / request status show inline:
 *   - "✦ Browse" : mixed movie + TV trending/popular feed
 *   - "Movies"   : TMDB movies only (trending/popular/top-rated + genres)
 *   - "TV Shows" : TMDB TV only (trending/popular/top-rated + genres)
 *
 * Owned-media-by-type browsing lives at /library, not here. A TV result links
 * into the request flow where SeriesScopeModal lets you grab a whole series,
 * specific seasons (e.g. just Season 1), or individual episodes.
 *
 * All data fetching happens in async Server Components so there are no client
 * waterfalls. The page shell renders instantly while Suspense handles the grid.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getItemsByTmdbIds } from '@/lib/media-server/library'
import { searchTMDB, getTrendingContent, getGenres, discoverByGenre } from '@/lib/media-server/tmdb'
import type { TrendingCategory } from '@/lib/media-server/tmdb'
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

// ---------------------------------------------------------------------------
// Discover type model
// ---------------------------------------------------------------------------

// URL `type` tab → TMDB media-type scope
type ItemType = 'discover' | 'movies' | 'shows'
type DiscoverType = 'all' | 'movie' | 'tv'

const TREND_CATS_ALL: TrendingCategory[] = ['trending', 'popular-movies', 'popular-tv', 'top-rated-movies', 'top-rated-tv']
const TREND_CATS_MOVIE: TrendingCategory[] = ['trending-movies', 'popular-movies', 'top-rated-movies']
const TREND_CATS_TV: TrendingCategory[] = ['trending-tv', 'popular-tv', 'top-rated-tv']

function catsForType(t: DiscoverType): TrendingCategory[] {
  return t === 'movie' ? TREND_CATS_MOVIE : t === 'tv' ? TREND_CATS_TV : TREND_CATS_ALL
}

function defaultCatForType(t: DiscoverType): TrendingCategory {
  return t === 'movie' ? 'trending-movies' : t === 'tv' ? 'trending-tv' : 'trending'
}

// Labels for the mixed "✦ Browse" feed need the type qualifier; the single-type
// tabs don't (the tab itself already says Movies / TV Shows).
const ALL_LABELS: Partial<Record<TrendingCategory, string>> = {
  'trending':         'Trending',
  'popular-movies':   'Popular Movies',
  'popular-tv':       'Popular TV',
  'top-rated-movies': 'Top Rated Movies',
  'top-rated-tv':     'Top Rated TV',
}

function categoryLabel(cat: TrendingCategory, t: DiscoverType): string {
  if (t === 'all') return ALL_LABELS[cat] ?? cat
  if (cat.startsWith('trending')) return 'Trending'
  if (cat.startsWith('popular')) return 'Popular'
  return 'Top Rated'
}

function discoverTypeFor(itemType: ItemType): DiscoverType {
  return itemType === 'movies' ? 'movie' : itemType === 'shows' ? 'tv' : 'all'
}

interface BrowsePageProps {
  searchParams: Promise<{ q?: string; page?: string; type?: string; cat?: string; genre?: string }>
}

// ---------------------------------------------------------------------------
// Category + genre filter bars
// ---------------------------------------------------------------------------

function TrendingCategoryTabs({
  active,
  discoverType,
  itemType,
}: {
  active: TrendingCategory
  discoverType: DiscoverType
  itemType: ItemType
}) {
  const cats = catsForType(discoverType)
  return (
    <div className="flex flex-wrap gap-2">
      {cats.map((cat) => (
        <a
          key={cat}
          href={`/browse?type=${itemType}&cat=${cat}`}
          className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
            active === cat
              ? 'bg-primary text-primary-foreground'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {categoryLabel(cat, discoverType)}
        </a>
      ))}
    </div>
  )
}

async function GenreFilterBar({
  genreType,
  activeGenreId,
  category,
  itemType,
}: {
  genreType: 'movie' | 'tv'
  activeGenreId?: number
  category: TrendingCategory
  itemType: ItemType
}) {
  const genres = await getGenres(genreType).catch(() => [])
  if (genres.length === 0) return null
  const base = `?type=${itemType}&cat=${category}`
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

// ---------------------------------------------------------------------------
// Discover Grid (TMDB search or trending/popular with library cross-reference)
// ---------------------------------------------------------------------------

async function DiscoverGrid({
  query,
  page,
  category,
  genreId,
  discoverType,
  itemType,
  userId,
}: {
  query?: string
  page: number
  category: TrendingCategory
  genreId?: number
  discoverType: DiscoverType
  itemType: ItemType
  userId: string
}) {
  let results: Awaited<ReturnType<typeof searchTMDB>>['results'] = []
  let totalResults = 0
  let totalPages = 0

  // genreType is fixed by the tab for single-type views; for the mixed feed it
  // follows whichever category is active.
  const genreType: 'movie' | 'tv' =
    discoverType === 'tv'
      ? 'tv'
      : discoverType === 'movie'
      ? 'movie'
      : category === 'popular-tv' || category === 'top-rated-tv' || category === 'trending-tv'
      ? 'tv'
      : 'movie'

  if (query && query.trim().length > 0) {
    const searchData = await searchTMDB(query.trim(), discoverType, page).catch(() => null)
    results = searchData?.results ?? []
    totalResults = searchData?.totalResults ?? 0
    totalPages = searchData?.totalPages ?? 0
  } else if (genreId) {
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
    ? `?type=${itemType}&q=${encodeURIComponent(query)}`
    : genreId
    ? `?type=${itemType}&cat=${category}&genre=${genreId}`
    : `?type=${itemType}&cat=${category}`

  return (
    <div className="flex flex-col gap-6">
      {/* Category tabs only when not searching */}
      {!query && <TrendingCategoryTabs active={category} discoverType={discoverType} itemType={itemType} />}

      {/* Genre filter bar only when not searching */}
      {!query && (
        <GenreFilterBar
          genreType={genreType}
          activeGenreId={genreId}
          category={category}
          itemType={itemType}
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
// Search bar
// ---------------------------------------------------------------------------

function FilterBar({ query, itemType }: { query?: string; itemType: ItemType }) {
  const placeholder =
    itemType === 'movies' ? 'Search movies…' : itemType === 'shows' ? 'Search TV shows…' : 'Search TMDB…'
  return (
    <form method="GET" action="/browse" className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        name="q"
        defaultValue={query ?? ''}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-4 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-white/20"
      />

      <input type="hidden" name="type" value={itemType} />

      <button
        type="submit"
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
      >
        Search
      </button>

      {query && (
        <a
          href={`/browse?type=${itemType}`}
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

function TypeTabs({ active, query }: { active: ItemType; query?: string }) {
  const tabs: { value: ItemType; label: string }[] = [
    { value: 'discover', label: '✦ Browse' },
    { value: 'movies',   label: 'Movies' },
    { value: 'shows',    label: 'TV Shows' },
  ]
  // Carry the active search across a type switch; cat/genre are type-specific so reset.
  const extra = query ? `&q=${encodeURIComponent(query)}` : ''
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

export default async function BrowsePage({ searchParams }: BrowsePageProps) {
  const session = await requireAuth()
  const params = await searchParams
  const query    = params.q?.trim() || undefined
  const page     = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const itemType: ItemType = (['movies', 'shows', 'discover'].includes(params.type ?? '')
    ? params.type
    : 'discover') as ItemType
  const discoverType = discoverTypeFor(itemType)

  const validCats = catsForType(discoverType)
  const catRaw = params.cat ?? ''
  const trendCategory: TrendingCategory = (validCats as readonly string[]).includes(catRaw)
    ? (catRaw as TrendingCategory)
    : defaultCatForType(discoverType)

  const genreId = params.genre ? parseInt(params.genre, 10) || undefined : undefined

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold tracking-tight">Browse</h1>
            <RescanButton />
          </div>

          <FilterBar query={query} itemType={itemType} />

          <TypeTabs active={itemType} query={query} />
        </div>

        <Suspense fallback={<BrowseGridSkeleton />}>
          <DiscoverGrid
            query={query}
            page={page}
            category={trendCategory}
            genreId={genreId}
            discoverType={discoverType}
            itemType={itemType}
            userId={session.userId}
          />
        </Suspense>
      </div>
    </div>
  )
}
