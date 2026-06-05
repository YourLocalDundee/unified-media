'use client'

import Link from 'next/link'
import Image from 'next/image'

export interface NativeEpisode {
  id: string
  title: string
  episode_number: number | null
  season_number: number | null
  overview: string | null
  runtime_ticks: number | null
  poster_path: string | null
  series_id: string | null
  series_poster_path: string | null
  position_ticks: number
  played: number  // SQLite stores booleans as 0/1 integers
}

interface EpisodeCardProps {
  episode: NativeEpisode
  isUpNext?: boolean
}

export default function EpisodeCard({ episode, isUpNext = false }: EpisodeCardProps) {
  const positionTicks = episode.position_ticks ?? 0
  const isPlayed = episode.played === 1
  const isPartiallyWatched = positionTicks > 0 && !isPlayed
  const progressPercent = episode.runtime_ticks
    ? Math.round((positionTicks / episode.runtime_ticks) * 100)
    : 0

  // Use episode poster if available, else fall back to series poster
  const imagePath = episode.poster_path ?? episode.series_poster_path
  const imageSrc = imagePath
    ? `/api/media/image?path=${encodeURIComponent(imagePath)}&size=w300`
    : null

  const episodeNumber = `E${String(episode.episode_number ?? 0).padStart(2, '0')}`

  // runtime_ticks is in 100-nanosecond units; 600_000_000 = 1 minute
  const runtime =
    episode.runtime_ticks != null
      ? `${Math.round(episode.runtime_ticks / 600_000_000)} min`
      : null

  return (
    <Link href={`/watch/${episode.id}`}>
      <div
        className={[
          'w-[220px] sm:w-[280px]',
          'flex-shrink-0',
          'snap-start',
          'rounded-lg overflow-hidden bg-zinc-900',
          'hover:ring-2 hover:ring-white/20 transition-all duration-200',
          isUpNext ? 'ring-2 ring-blue-500' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {/* Thumbnail */}
        <div className="relative aspect-video w-full bg-zinc-800">
          {imageSrc ? (
            <Image
              src={imageSrc}
              alt={episode.title}
              fill
              unoptimized
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-600 text-xs">
              {episodeNumber}
            </div>
          )}

          {/* Progress bar */}
          {isPartiallyWatched && (
            <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-zinc-700 z-10">
              <div
                className="h-full bg-blue-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex flex-col gap-1 p-2">
          <span className="text-xs text-zinc-500">{episodeNumber}</span>
          <p className="truncate text-sm font-medium text-white leading-tight">{episode.title}</p>

          <div className="flex items-center gap-2 text-xs">
            {isPartiallyWatched ? (
              <span className="text-blue-400">Continue</span>
            ) : (
              runtime && <span className="text-zinc-400">{runtime}</span>
            )}
          </div>

          {episode.overview && (
            <p className="line-clamp-2 text-xs text-zinc-400 leading-snug">{episode.overview}</p>
          )}
        </div>
      </div>
    </Link>
  )
}
