'use client'

import { useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ChevronDown, ChevronUp, Clapperboard } from 'lucide-react'
import type { MediaItem } from '@/lib/media-server/types'

interface Props {
  episodes: MediaItem[]
}

// Groups a flat episode list by season and lets each season collapse independently —
// long-running shows (Pokémon, Naruto Shippuden, ...) render hundreds of episodes flat
// otherwise, making the page unnavigable. First season starts expanded, the rest collapsed.
export function SeasonEpisodeList({ episodes }: Props) {
  const seasonMap = new Map<number, MediaItem[]>()
  for (const ep of episodes) {
    const s = ep.season_number ?? 0
    if (!seasonMap.has(s)) seasonMap.set(s, [])
    seasonMap.get(s)!.push(ep)
  }
  const seasons = [...seasonMap.entries()].sort((a, b) => a[0] - b[0])

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(seasons.slice(0, 1).map(([n]) => n)))

  function toggle(seasonNumber: number) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(seasonNumber)) next.delete(seasonNumber)
      else next.add(seasonNumber)
      return next
    })
  }

  return (
    <>
      {seasons.map(([seasonNumber, eps]) => {
        const isOpen = expanded.has(seasonNumber)
        return (
          <div key={seasonNumber} className="mb-4">
            <button
              type="button"
              onClick={() => toggle(seasonNumber)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-left hover:bg-zinc-900/50 transition-colors"
            >
              <h3 className="text-lg font-medium text-zinc-300">
                {seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`}
                <span className="ml-2 text-sm text-zinc-500">({eps.length})</span>
              </h3>
              {isOpen ? (
                <ChevronUp className="h-5 w-5 text-zinc-500" />
              ) : (
                <ChevronDown className="h-5 w-5 text-zinc-500" />
              )}
            </button>
            {isOpen && (
              <div className="flex flex-col gap-2 mt-1">
                {eps.map((ep) => (
                  <Link
                    key={ep.id}
                    href={`/play/${ep.id}`}
                    className="flex items-center gap-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 px-4 py-3 transition-colors"
                  >
                    <div className="relative h-[68px] w-[120px] flex-shrink-0 overflow-hidden rounded bg-zinc-800">
                      {ep.poster_path ? (
                        <Image
                          src={`https://image.tmdb.org/t/p/w300${ep.poster_path}`}
                          alt=""
                          fill
                          sizes="120px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-zinc-600">
                          <Clapperboard className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex flex-col">
                      <span className="text-white text-sm font-medium">
                        S{String(ep.season_number ?? 0).padStart(2, '0')} E{String(ep.episode_number ?? 0).padStart(2, '0')} &mdash; {ep.episode_title ?? ep.title}
                      </span>
                      {ep.overview && (
                        <span className="text-zinc-500 text-xs mt-1 line-clamp-2">
                          {ep.overview}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
