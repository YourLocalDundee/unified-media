import { Suspense } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getItemsByType, getCountByType, getAvailableFilters } from '@/lib/media-server/library'
import { requireAuth } from '@/lib/dal'
import { LibraryViewLayout } from './LibraryViewLayout'

export const metadata: Metadata = {
  title: 'Library — minime',
}

type SortKey = 'title_asc' | 'title_desc' | 'year_desc' | 'year_asc' | 'added_desc' | 'added_asc'

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'title_asc',  label: 'Title A–Z' },
  { value: 'title_desc', label: 'Title Z–A' },
  { value: 'year_desc',  label: 'Year (Newest)' },
  { value: 'year_asc',   label: 'Year (Oldest)' },
  { value: 'added_desc', label: 'Recently Added' },
  { value: 'added_asc',  label: 'Oldest Added' },
]

const COUNT_OPTIONS = [25, 50, 100] as const
type PageCount = typeof COUNT_OPTIONS[number]

interface LibraryPageProps {
  searchParams: Promise<{ type?: string; sort?: string; year?: string; page?: string; count?: string; view?: string }>
}

// ---------------------------------------------------------------------------
// Library Grid
// ---------------------------------------------------------------------------

async function LibraryGrid({
  itemType,
  sort,
  year,
  page,
  count,
  view,
}: {
  itemType: string
  sort: SortKey
  year?: number
  page: number
  count: number
  view: 'grid' | 'list'
}) {
  const offset = (page - 1) * count
  const dbType = itemType === 'movies' ? 'movie' : itemType === 'shows' ? 'series' : 'all'
  const items = getItemsByType(dbType, count, offset, year, sort)
  const totalCount = getCountByType(dbType, year)
  const totalPages = Math.max(1, Math.ceil(totalCount / count))

  const viewItems = items.map((item) => ({
    id: item.id,
    title: item.title,
    year: item.year ?? undefined,
    imageUrl: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : undefined,
    type: (item.type === 'movie' ? 'Movie' : 'Series') as 'Movie' | 'Series',
  }))

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-zinc-400">
        {totalCount.toLocaleString()} item{totalCount !== 1 ? 's' : ''}
      </p>

      {items.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-zinc-500">
          Nothing in library yet.
        </div>
      ) : (
        <LibraryViewLayout items={viewItems} view={view} />
      )}

      {totalPages > 1 && (
        <LibraryPagination
          currentPage={page}
          totalPages={totalPages}
          itemType={itemType}
          sort={sort}
          count={count}
          year={year}
          view={view}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function LibraryPagination({
  currentPage,
  totalPages,
  itemType,
  sort,
  count,
  year,
  view,
}: {
  currentPage: number
  totalPages: number
  itemType: string
  sort: SortKey
  count: number
  year?: number
  view: 'grid' | 'list'
}) {
  const extra = `&sort=${sort}&count=${count}&view=${view}${year ? `&year=${year}` : ''}`
  const pageNums = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || (p >= currentPage - 2 && p <= currentPage + 2)
  )

  return (
    <nav className="flex items-center justify-center gap-1 flex-wrap" aria-label="Pagination">
      {currentPage > 1 && (
        <Link href={`?page=${currentPage - 1}&type=${itemType}${extra}`}
          className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">Prev</Link>
      )}
      {pageNums.map((p, idx) => {
        const prevNum = pageNums[idx - 1]
        const showEllipsis = prevNum !== undefined && p - prevNum > 1
        return (
          <span key={p} className="flex items-center gap-1">
            {showEllipsis && <span className="px-1 text-zinc-500">…</span>}
            <Link href={`?page=${p}&type=${itemType}${extra}`}
              className={`rounded px-3 py-1.5 text-sm ${p === currentPage ? 'bg-white text-black font-semibold' : 'bg-zinc-800 text-white hover:bg-zinc-700'}`}>
              {p}
            </Link>
          </span>
        )
      })}
      {currentPage < totalPages && (
        <Link href={`?page=${currentPage + 1}&type=${itemType}${extra}`}
          className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-white hover:bg-zinc-700">Next</Link>
      )}
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LibraryGridSkeleton() {
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
// Type tabs
// ---------------------------------------------------------------------------

function TypeTabs({ active, sort, count, view }: { active: string; sort: SortKey; count: number; view: 'grid' | 'list' }) {
  const tabs = [
    { value: 'all',    label: 'All' },
    { value: 'movies', label: 'Movies' },
    { value: 'shows',  label: 'TV Shows' },
  ]
  return (
    <div className="flex gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={`/library?type=${tab.value}&sort=${sort}&count=${count}&view=${view}`}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.value
              ? 'bg-white text-black'
              : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  await requireAuth()
  const params = await searchParams

  const itemType = ['all', 'movies', 'shows'].includes(params.type ?? '') ? (params.type ?? 'all') : 'all'
  const sortRaw = params.sort ?? 'title_asc'
  const sort: SortKey = (['title_asc','title_desc','year_desc','year_asc','added_desc','added_asc'] as SortKey[]).includes(sortRaw as SortKey)
    ? (sortRaw as SortKey)
    : 'title_asc'
  const year = params.year ? parseInt(params.year, 10) || undefined : undefined
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1)
  const rawCount = parseInt(params.count ?? '25', 10)
  const count: PageCount = (COUNT_OPTIONS as readonly number[]).includes(rawCount)
    ? (rawCount as PageCount)
    : 25
  const view: 'grid' | 'list' = params.view === 'list' ? 'list' : 'grid'

  const filterType = itemType === 'movies' ? 'movie' : itemType === 'shows' ? 'series' : undefined
  const filters = getAvailableFilters(filterType)

  const toggleViewHref = `/library?type=${itemType}&sort=${sort}&count=${count}&view=${view === 'grid' ? 'list' : 'grid'}${year ? `&year=${year}` : ''}`

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-3xl font-bold tracking-tight">Library</h1>
            {/* defaultView toggle (A8-H1 posterSize wired via LibraryViewLayout) */}
            <Link
              href={toggleViewHref}
              title={view === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
              className="flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors"
            >
              {view === 'grid' ? (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M1 2h6v6H1V2zm8 0h6v6H9V2zM1 10h6v4H1v-4zm8 0h6v4H9v-4z" />
                  </svg>
                  List
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <path d="M1 2h14v3H1V2zm0 5h14v3H1V7zm0 5h14v2H1v-2z" />
                  </svg>
                  Grid
                </>
              )}
            </Link>
          </div>

          <form method="GET" action="/library" className="flex flex-wrap items-center gap-2">
            {filters.years.length > 0 && (
              <select
                name="year"
                defaultValue={year?.toString() ?? ''}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/20 cursor-pointer"
              >
                <option value="">All years</option>
                {filters.years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
            <select
              name="sort"
              defaultValue={sort}
              className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-white/20 cursor-pointer"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
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
            <input type="hidden" name="type" value={itemType} />
            <input type="hidden" name="view" value={view} />
            <button
              type="submit"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black hover:bg-zinc-200"
            >
              Apply
            </button>
            {year && (
              <Link
                href={`/library?type=${itemType}&sort=${sort}&count=${count}&view=${view}`}
                className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white hover:bg-zinc-700"
              >
                Clear
              </Link>
            )}
          </form>

          <TypeTabs active={itemType} sort={sort} count={count} view={view} />
        </div>

        <Suspense fallback={<LibraryGridSkeleton />}>
          <LibraryGrid itemType={itemType} sort={sort} year={year} page={page} count={count} view={view} />
        </Suspense>
      </div>
    </div>
  )
}
