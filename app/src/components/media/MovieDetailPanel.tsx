'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Badge } from '@/components/ui/Badge'
import { ExternalLinks } from './ExternalLinks'
import { CastGrid } from './CastGrid'

interface Genre {
  id: number
  name: string
}

interface ProductionCompany {
  id: number
  name: string
}

interface CastMember {
  id: number
  name: string
  character: string
  profilePath?: string | null
}

interface CrewMember {
  id: number
  name: string
  job: string
  department: string
  profilePath?: string | null
}

interface ExternalIds {
  imdb_id?: string | null
}

interface Collection {
  id: number
  name: string
  parts?: unknown[]
}

interface MovieDetail {
  title: string
  tagline?: string | null
  overview?: string | null
  posterPath?: string | null
  backdropPath?: string | null
  releaseDate?: string | null
  runtime?: number | null
  genres?: Genre[]
  productionCompanies?: ProductionCompany[]
  budget?: number
  revenue?: number
  externalIds?: ExternalIds
  credits?: {
    cast: CastMember[]
    crew: CrewMember[]
  }
  homepage?: string | null
  originalLanguage?: string
  voteAverage?: number
  belongsToCollection?: Collection | null
}

interface MovieDetailPanelProps {
  tmdbId: number
  requestStatus?: number
}

function formatCurrency(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`
  }
  return `$${amount}`
}

function formatRuntime(mins: number): string {
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

function MovieSkeleton() {
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

export function MovieDetailPanel({ tmdbId, requestStatus: _requestStatus }: MovieDetailPanelProps) {
  const [movie, setMovie] = useState<MovieDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/tmdb/movie/${tmdbId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<MovieDetail>
      })
      .then((data) => {
        if (!cancelled) setMovie(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load movie details')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [tmdbId])

  if (loading) return <MovieSkeleton />

  if (error) {
    return (
      <div className="rounded-lg bg-zinc-800/50 px-4 py-3 text-sm text-zinc-300">
        <span className="text-red-400">Could not load movie details.</span>{' '}
        <a
          href={`https://www.themoviedb.org/movie/${tmdbId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-white"
        >
          View on TMDB
        </a>
      </div>
    )
  }

  if (!movie) return null

  const directors = (movie.credits?.crew ?? []).filter((c) => c.job === 'Director')
  const writers = (movie.credits?.crew ?? []).filter(
    (c) => c.job === 'Screenplay' || c.job === 'Writer',
  )
  const cinematographers = (movie.credits?.crew ?? []).filter(
    (c) => c.job === 'Director of Photography',
  )

  const externalLinks = [
    { label: 'TMDB', url: `https://www.themoviedb.org/movie/${tmdbId}` },
    {
      label: 'IMDB',
      url: movie.externalIds?.imdb_id ? `https://www.imdb.com/title/${movie.externalIds.imdb_id}` : '',
    },
    { label: 'Official site', url: movie.homepage ?? '' },
    { label: 'Letterboxd', url: `https://letterboxd.com/tmdb/${tmdbId}` },
    { label: 'Trakt', url: `https://trakt.tv/movies/${tmdbId}` },
  ]

  return (
    <div className="space-y-4">
      {/* Backdrop */}
      {movie.backdropPath && (
        <div className="relative max-h-[200px] w-full overflow-hidden rounded-lg">
          <Image
            src={`https://image.tmdb.org/t/p/w780${movie.backdropPath}`}
            alt={movie.title}
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
        {movie.posterPath && (
          <div className="flex-shrink-0">
            <div className="relative aspect-[2/3] w-32 overflow-hidden rounded-lg">
              <Image
                src={`https://image.tmdb.org/t/p/w300${movie.posterPath}`}
                alt={movie.title}
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
          <h2 className="text-lg font-bold text-zinc-100">{movie.title}</h2>

          {movie.tagline && (
            <p className="text-sm italic text-zinc-400">{movie.tagline}</p>
          )}

          {movie.overview && (
            <p className="text-sm leading-relaxed text-zinc-300">{movie.overview}</p>
          )}

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
            {movie.releaseDate && (
              <span>{formatDate(movie.releaseDate)}</span>
            )}
            {movie.runtime != null && movie.runtime > 0 && (
              <span>{formatRuntime(movie.runtime)}</span>
            )}
            {movie.originalLanguage && (
              <span className="uppercase">{movie.originalLanguage}</span>
            )}
            {movie.voteAverage != null && movie.voteAverage > 0 && (
              <span>{movie.voteAverage.toFixed(1)} / 10</span>
            )}
          </div>

          {/* Genres */}
          {(movie.genres ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(movie.genres ?? []).map((g) => (
                <Badge key={g.id} variant="outline">
                  {g.name}
                </Badge>
              ))}
            </div>
          )}

          {/* Budget / revenue */}
          {((movie.budget ?? 0) > 0 || (movie.revenue ?? 0) > 0) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
              {(movie.budget ?? 0) > 0 && (
                <span>Budget: {formatCurrency(movie.budget!)}</span>
              )}
              {(movie.revenue ?? 0) > 0 && (
                <span>Revenue: {formatCurrency(movie.revenue!)}</span>
              )}
            </div>
          )}

          {/* Production companies */}
          {(movie.productionCompanies ?? []).length > 0 && (
            <p className="text-xs text-zinc-500">
              {(movie.productionCompanies ?? []).map((c) => c.name).join(', ')}
            </p>
          )}

          {/* Collection */}
          {movie.belongsToCollection && (
            <p className="text-xs text-zinc-400">
              Part of{' '}
              <span className="font-medium text-zinc-300">
                {movie.belongsToCollection.name}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* External links */}
      <ExternalLinks links={externalLinks} />

      {/* Cast */}
      {(movie.credits?.cast ?? []).length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Cast</h3>
          <CastGrid cast={(movie.credits?.cast ?? []).slice(0, 10)} />
        </div>
      )}

      {/* Crew */}
      {(directors.length > 0 || writers.length > 0 || cinematographers.length > 0) && (
        <div className="space-y-1 text-xs text-zinc-400">
          <h3 className="font-semibold uppercase tracking-wider text-zinc-500">Crew</h3>
          {directors.length > 0 && (
            <p>
              <span className="text-zinc-500">Director{directors.length > 1 ? 's' : ''}:</span>{' '}
              {directors.map((c) => c.name).join(', ')}
            </p>
          )}
          {writers.length > 0 && (
            <p>
              <span className="text-zinc-500">Writer{writers.length > 1 ? 's' : ''}:</span>{' '}
              {writers.map((c) => c.name).join(', ')}
            </p>
          )}
          {cinematographers.length > 0 && (
            <p>
              <span className="text-zinc-500">Cinematographer{cinematographers.length > 1 ? 's' : ''}:</span>{' '}
              {cinematographers.map((c) => c.name).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
