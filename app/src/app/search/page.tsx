import type { Metadata } from 'next'
import { searchTMDB } from '@/lib/media-server/tmdb'
import SearchInput from './SearchInput'
import SearchResults from './SearchResults'
import { requireAuth } from '@/lib/dal'

export const metadata: Metadata = {
  title: 'Search — unified-frontend',
}

const TYPE_TABS = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV Shows' },
] as const

type MediaType = 'all' | 'movie' | 'tv'

// ---------------------------------------------------------------------------
// Page — server component
// ---------------------------------------------------------------------------

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; type?: string }>
}) {
  await requireAuth()
  const { q, page, type } = await searchParams
  const query = q?.trim() || undefined
  const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1)
  const mediaType: MediaType =
    type === 'movie' || type === 'tv' ? type : 'all'

  const searchData = query
    ? await searchTMDB(query, mediaType, pageNum).catch(() => null)
    : null

  const results = searchData?.results ?? []
  const totalResults = searchData?.totalResults ?? 0
  const totalPages = searchData?.totalPages ?? 0

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4">
          <h1 className="text-3xl font-bold tracking-tight">Search</h1>
          <SearchInput initialQuery={query ?? ''} />

          {/* Type tabs */}
          <div className="flex gap-1">
            {TYPE_TABS.map((tab) => {
              const isActive = mediaType === tab.value
              const href = query
                ? `/search?q=${encodeURIComponent(query)}&type=${tab.value}`
                : `/search?type=${tab.value}`
              return (
                <a
                  key={tab.value}
                  href={href}
                  className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-white text-black'
                      : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  {tab.label}
                </a>
              )
            })}
          </div>
        </div>

        {/* Empty state */}
        {!query && (
          <div className="flex h-64 flex-col items-center justify-center gap-4 text-zinc-500">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-12 w-12 opacity-40"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
            <p className="text-lg">Search for movies and TV shows</p>
          </div>
        )}

        {/* Results */}
        {query && (
          <>
            {results.length > 0 && (
              <p className="mb-4 text-sm text-zinc-400">
                {totalResults} result{totalResults !== 1 ? 's' : ''} for &ldquo;{query}&rdquo;
              </p>
            )}

            <SearchResults results={results} query={query} />

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-center gap-3">
                {pageNum > 1 && (
                  <a
                    href={`/search?q=${encodeURIComponent(query)}&type=${mediaType}&page=${pageNum - 1}`}
                    className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
                  >
                    Prev
                  </a>
                )}
                <span className="text-sm text-zinc-400">
                  Page {pageNum} of {totalPages}
                </span>
                {pageNum < totalPages && (
                  <a
                    href={`/search?q=${encodeURIComponent(query)}&type=${mediaType}&page=${pageNum + 1}`}
                    className="rounded bg-zinc-800 px-4 py-2 text-sm text-white hover:bg-zinc-700"
                  >
                    Next
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
