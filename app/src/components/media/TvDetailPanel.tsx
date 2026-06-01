'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Badge } from '@/components/ui/Badge'
import { ExternalLinks } from './ExternalLinks'
import { SeasonAccordion } from './SeasonAccordion'

interface Genre {
  id: number
  name: string
}

interface Network {
  id: number
  name: string
}

interface ExternalIds {
  tvdb_id?: number | null
  imdb_id?: string | null
}

interface SeasonSummary {
  id: number
  seasonNumber: number
  episodeCount?: number
  airDate?: string | null
  overview?: string
  name?: string
}

interface TvDetail {
  name: string
  overview?: string | null
  posterPath?: string | null
  backdropPath?: string | null
  firstAirDate?: string | null
  status?: string | null
  networks?: Network[]
  numberOfSeasons?: number
  numberOfEpisodes?: number
  genres?: Genre[]
  episodeRunTime?: number[]
  externalIds?: ExternalIds
  seasons?: SeasonSummary[]
  homepage?: string | null
  originalLanguage?: string
  voteAverage?: number
}

interface TvDetailPanelProps {
  tmdbId: number
  requestStatus?: number
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function TvSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-48 w-full rounded-lg bg-zinc-800" />
      <div className="flex gap-4">
        <div className="h-48 w-32 flex-shrink-0 rounded-lg bg-zinc-800" />
        <div className="flex-1 space-y-3">
          <div className="h-6 w-3/4 rounded bg-zinc-800" />
          <div className="h-4 w-1/2 rounded bg-zinc-800" />
          <div className="h-4 w-full rounded bg-zinc-800" />
          <div className="h-4 w-full rounded bg-zinc-800" />
          <div className="h-4 w-2/3 rounded bg-zinc-800" />
        </div>
      </div>
    </div>
  )
}

export function TvDetailPanel({ tmdbId, requestStatus: _requestStatus }: TvDetailPanelProps) {
  const [show, setShow] = useState<TvDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/tmdb/tv/${tmdbId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<TvDetail>
      })
      .then((data) => {
        if (!cancelled) setShow(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load TV details')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tmdbId])

  if (loading) return <TvSkeleton />

  if (error) {
    return (
      <div className="rounded-lg bg-zinc-800/50 px-4 py-3 text-sm text-zinc-300">
        <span className="text-red-400">Could not load TV details.</span>{' '}
        <a
          href={`https://www.themoviedb.org/tv/${tmdbId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-white"
        >
          View on TMDB
        </a>
      </div>
    )
  }

  if (!show) return null

  const runTime =
    (show.episodeRunTime ?? []).length > 0
      ? Math.round(
          (show.episodeRunTime ?? []).reduce((a, b) => a + b, 0) /
            (show.episodeRunTime ?? []).length,
        )
      : null

  const tvdbId = show.externalIds?.tvdb_id
  const imdbId = show.externalIds?.imdb_id

  const externalLinks = [
    { label: 'TMDB', url: `https://www.themoviedb.org/tv/${tmdbId}` },
    { label: 'IMDB', url: imdbId ? `https://www.imdb.com/title/${imdbId}` : '' },
    {
      label: 'TVDB',
      url: tvdbId ? `https://thetvdb.com/?tab=series&id=${tvdbId}` : '',
    },
    { label: 'Trakt', url: `https://trakt.tv/shows/${tmdbId}` },
    { label: 'Official site', url: show.homepage ?? '' },
  ]

  // Filter seasons: skip season 0 if it has no episodes
  const seasons = (show.seasons ?? []).filter(
    (s) => s.seasonNumber !== 0 || (s.episodeCount != null && s.episodeCount > 0),
  )

  return (
    <div className="space-y-4">
      {/* Backdrop */}
      {show.backdropPath && (
        <div className="relative max-h-[200px] w-full overflow-hidden rounded-lg">
          <Image
            src={`https://image.tmdb.org/t/p/w780${show.backdropPath}`}
            alt={show.name}
            width={780}
            height={440}
            unoptimized
            className="h-full max-h-[200px] w-full object-cover opacity-30"
          />
        </div>
      )}

      {/* Poster + metadata */}
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Poster */}
        {show.posterPath && (
          <div className="flex-shrink-0">
            <div className="relative aspect-[2/3] w-32 overflow-hidden rounded-lg">
              <Image
                src={`https://image.tmdb.org/t/p/w300${show.posterPath}`}
                alt={show.name}
                fill
                unoptimized
                className="object-cover"
                sizes="128px"
              />
            </div>
          </div>
        )}

        {/* Metadata */}
        <div className="min-w-0 flex-1 space-y-2">
          <h2 className="text-lg font-bold text-zinc-100">{show.name}</h2>

          {show.overview && (
            <p className="text-sm leading-relaxed text-zinc-300">{show.overview}</p>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            {show.firstAirDate && (
              <span>First aired: {formatDate(show.firstAirDate)}</span>
            )}
            {show.status && <span>{show.status}</span>}
            {show.originalLanguage && (
              <span className="uppercase">{show.originalLanguage}</span>
            )}
            {show.voteAverage != null && show.voteAverage > 0 && (
              <span>{show.voteAverage.toFixed(1)} / 10</span>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            {show.numberOfSeasons != null && (
              <span>
                {show.numberOfSeasons} season{show.numberOfSeasons !== 1 ? 's' : ''}
              </span>
            )}
            {show.numberOfEpisodes != null && (
              <span>
                {show.numberOfEpisodes} episode{show.numberOfEpisodes !== 1 ? 's' : ''}
              </span>
            )}
            {runTime != null && runTime > 0 && <span>~{runTime} min / episode</span>}
          </div>

          {/* Networks */}
          {(show.networks ?? []).length > 0 && (
            <p className="text-xs text-zinc-400">
              {(show.networks ?? []).map((n) => n.name).join(', ')}
            </p>
          )}

          {/* Genres */}
          {(show.genres ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(show.genres ?? []).map((g) => (
                <Badge key={g.id} variant="outline">
                  {g.name}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* External links */}
      <ExternalLinks links={externalLinks} />

      {/* Seasons */}
      {seasons.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Seasons</h3>
          <div className="flex flex-col gap-2">
            {seasons.map((season) => (
              <SeasonAccordion key={season.id} tmdbId={tmdbId} season={season} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
