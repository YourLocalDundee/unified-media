'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { TMDBSearchResult } from '@/lib/media-server/tmdb'

interface Props {
  results: TMDBSearchResult[]
  query: string
}

export default function SearchResults({ results, query }: Props) {
  const [requestedIds, setRequestedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Record<number, string>>({})

  async function handleRequest(result: TMDBSearchResult) {
    setLoading((prev) => new Set(prev).add(result.tmdbId))
    setErrors((prev) => { const next = { ...prev }; delete next[result.tmdbId]; return next })
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId: result.tmdbId,
          mediaType: result.mediaType,
          title: result.title,
          year: result.year,
          posterPath: result.posterPath,
          overview: result.overview,
        }),
      })
      if (res.ok || res.status === 409) {
        setRequestedIds((prev) => new Set(prev).add(result.tmdbId))
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setErrors((prev) => ({ ...prev, [result.tmdbId]: data.error ?? 'Request failed' }))
      }
    } catch {
      setErrors((prev) => ({ ...prev, [result.tmdbId]: 'Network error' }))
    } finally {
      setLoading((prev) => {
        const s = new Set(prev)
        s.delete(result.tmdbId)
        return s
      })
    }
  }

  if (results.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-zinc-500">
        No results for &ldquo;{query}&rdquo;
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {results.map((result) => {
        const isRequested = requestedIds.has(result.tmdbId)
        const isLoading = loading.has(result.tmdbId)
        const error = errors[result.tmdbId]
        const posterUrl = result.posterPath
          ? `https://image.tmdb.org/t/p/w185${result.posterPath}`
          : null

        return (
          <div
            key={`${result.mediaType}-${result.tmdbId}`}
            className="group flex flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/5 transition hover:ring-white/20"
          >
            {/* Poster */}
            <div className="relative aspect-[2/3] w-full bg-zinc-800">
              {posterUrl ? (
                <Image
                  src={posterUrl}
                  alt={result.title}
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-zinc-600">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-10 w-10"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
                    />
                  </svg>
                </div>
              )}

              {/* Media type badge */}
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/80">
                {result.mediaType === 'movie' ? 'Movie' : 'TV'}
              </span>

              {/* Rating badge */}
              {result.rating !== null && result.rating > 0 && (
                <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
                  <svg className="h-2.5 w-2.5 fill-current" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  {result.rating.toFixed(1)}
                </span>
              )}
            </div>

            {/* Card body */}
            <div className="flex flex-1 flex-col gap-2 p-2.5">
              <div className="flex-1">
                <p className="line-clamp-2 text-sm font-medium leading-tight text-white">
                  {result.title}
                  {result.year !== null && (
                    <span className="ml-1 font-normal text-zinc-400">({result.year})</span>
                  )}
                </p>
              </div>

              {/* Request button */}
              {error && (
                <p className="text-[10px] text-red-400">{error}</p>
              )}
              <button
                onClick={() => handleRequest(result)}
                disabled={isRequested || isLoading}
                className={`w-full rounded px-2 py-1.5 text-xs font-medium transition ${
                  isRequested
                    ? 'cursor-default bg-green-700/40 text-green-300'
                    : isLoading
                    ? 'cursor-wait bg-zinc-700 text-zinc-400'
                    : 'bg-white/10 text-white hover:bg-white/20 active:bg-white/30'
                }`}
              >
                {isRequested ? 'Requested' : isLoading ? 'Requesting…' : 'Request'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
