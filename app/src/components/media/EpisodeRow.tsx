'use client'

import Image from 'next/image'

interface Episode {
  id: number
  name: string
  overview: string
  airDate: string | null
  episodeNumber: number
  stillPath: string | null
  runtime: number | null
  voteAverage?: number
}

interface EpisodeRowProps {
  episode: Episode
}

function formatAirDate(dateStr: string | null): string {
  if (!dateStr) return 'TBA'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function EpisodeRow({ episode }: EpisodeRowProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-zinc-800/50 p-3 sm:flex-row">
      {/* Still image */}
      <div className="flex-shrink-0">
        {episode.stillPath ? (
          <div className="relative h-[90px] w-full overflow-hidden rounded sm:w-[160px]">
            <Image
              src={`https://image.tmdb.org/t/p/w300${episode.stillPath}`}
              alt={episode.name}
              fill
              unoptimized
              className="object-cover"
              sizes="160px"
            />
          </div>
        ) : (
          <div className="flex h-[90px] w-full items-center justify-center rounded bg-zinc-700 sm:w-[160px]">
            <span className="text-xs text-zinc-500">No image</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-xs font-semibold text-zinc-400">
            E{String(episode.episodeNumber).padStart(2, '0')}
          </span>
          <span className="text-sm font-semibold text-zinc-100">{episode.name}</span>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-zinc-400">
          <span>{formatAirDate(episode.airDate)}</span>
          {episode.runtime != null && episode.runtime > 0 && (
            <span>{episode.runtime} min</span>
          )}
          {episode.voteAverage != null && episode.voteAverage > 0 && (
            <span>{episode.voteAverage.toFixed(1)} / 10</span>
          )}
        </div>

        {episode.overview && (
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-zinc-300">
            {episode.overview}
          </p>
        )}
      </div>
    </div>
  )
}
