'use client'

import Image from 'next/image'
import type { RequestStatus } from '@/lib/requests/types'
import type { RequestType } from '@/lib/requests/types'
import { RequestOptions } from '@/components/media/RequestOptions'

export interface DiscoverItem {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  title: string
  year: number | null
  posterPath: string | null
  rating: number | null
  overview: string
  libraryId: string | null
  requestStatus: RequestStatus | null
  requestType: RequestType | null
}

interface Props {
  items: DiscoverItem[]
  query?: string
}

export default function DiscoverResults({ items, query }: Props) {
  if (items.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-zinc-500">
        {query ? `No results for "${query}"` : 'No results.'}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((item) => {
        const inLibrary = item.libraryId !== null
        const posterUrl = item.posterPath
          ? `https://image.tmdb.org/t/p/w185${item.posterPath}`
          : null
        const detailUrl = `/browse/discover/${item.mediaType}/${item.tmdbId}`

        return (
          <div
            key={`${item.mediaType}-${item.tmdbId}`}
            className="group flex flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/5 transition hover:ring-white/20 hover:-translate-y-0.5"
          >
            {/* Poster as link */}
            <a href={detailUrl} className="relative aspect-[2/3] w-full bg-zinc-800 block">
              {posterUrl ? (
                // A02-006/A15-G: TMDB host covered by remotePatterns — optimization on.
                <Image
                  src={posterUrl}
                  alt={item.title}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, 20vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-zinc-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
              )}

              {/* Type badge */}
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
                {item.mediaType === 'movie' ? 'Movie' : 'TV'}
              </span>

              {/* Rating */}
              {item.rating !== null && item.rating > 0 && (
                <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                  <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {item.rating.toFixed(1)}
                </span>
              )}

              {/* In Library overlay on hover */}
              {inLibrary && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white">
                    In Library
                  </span>
                </div>
              )}
            </a>

            {/* Card body */}
            <div className="flex flex-1 flex-col p-2.5">
              <a href={detailUrl} className="line-clamp-2 text-sm font-medium leading-tight text-white hover:text-zinc-300">
                {item.title}
                {item.year !== null && (
                  <span className="ml-1 font-normal text-zinc-400">({item.year})</span>
                )}
              </a>

              {/* CTA */}
              <div className="mt-auto pt-2">
                {inLibrary ? (
                  <a
                    href={`/browse/${item.libraryId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center rounded px-2.5 py-1.5 text-xs font-medium bg-green-900/60 text-green-300 hover:bg-green-900/80 transition-colors"
                  >
                    Watch
                  </a>
                ) : (
                  <RequestOptions
                    tmdbId={item.tmdbId}
                    mediaType={item.mediaType}
                    title={item.title}
                    year={item.year}
                    posterPath={item.posterPath}
                    overview={item.overview ?? ''}
                    existingStatus={item.requestStatus ?? undefined}
                    existingRequestType={item.requestType ?? undefined}
                    compact
                  />
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
