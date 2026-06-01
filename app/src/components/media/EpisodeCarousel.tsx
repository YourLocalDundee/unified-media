'use client'

import { useQuery } from '@tanstack/react-query'
import { useState, useMemo, useEffect, useRef } from 'react'
import EpisodeCard, { type NativeEpisode } from '@/components/media/EpisodeCard'
import EpisodeToolbar, {
  type SortField,
  type SortOrder,
  type EpisodeFilter,
} from '@/components/media/EpisodeToolbar'

interface EpisodeCarouselProps {
  seriesId: string
  seasonId: string
}

const CARD_WIDTH = 280

export default function EpisodeCarousel({ seriesId, seasonId }: EpisodeCarouselProps) {
  const { data: episodes, isLoading, isError, refetch } = useQuery<NativeEpisode[]>({
    queryKey: ['episodes', seasonId, seriesId],
    queryFn: async () => {
      const res = await fetch(`/api/media/seasons/${seasonId}/episodes`)
      if (!res.ok) throw new Error('Failed to fetch episodes')
      return res.json()
    },
    staleTime: 60_000,
  })

  const [sortBy, setSortBy] = useState<SortField>('episode')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [filter, setFilter] = useState<EpisodeFilter>('all')

  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  const displayEpisodes = useMemo(() => {
    if (!episodes) return []
    let list = [...episodes]
    if (filter === 'watched') list = list.filter((ep) => ep.played === 1)
    if (filter === 'unwatched') list = list.filter((ep) => ep.played === 0)
    list.sort((a, b) => {
      let aVal: number, bVal: number
      if (sortBy === 'episode') {
        aVal = a.episode_number ?? 0
        bVal = b.episode_number ?? 0
      } else if (sortBy === 'airdate') {
        // native DB doesn't store air date; fall back to episode number
        aVal = a.episode_number ?? 0
        bVal = b.episode_number ?? 0
      } else {
        aVal = a.runtime_ticks ?? 0
        bVal = b.runtime_ticks ?? 0
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })
    return list
  }, [episodes, sortBy, sortOrder, filter])

  const upNextIndex = useMemo(() => {
    if (!episodes || episodes.length === 0) return 0
    const idx = episodes.findIndex((ep) => ep.played === 0 && ep.position_ticks === 0)
    return idx === -1 ? 0 : idx
  }, [episodes])

  const updateArrows = () => {
    const el = scrollRef.current
    if (!el) return
    setShowLeftArrow(el.scrollLeft > 0)
    setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateArrows)
    updateArrows()
    return () => el.removeEventListener('scroll', updateArrows)
  }, [displayEpisodes.length])

  useEffect(() => {
    if (!scrollRef.current || displayEpisodes.length === 0) return
    const target = scrollRef.current.children[upNextIndex] as HTMLElement | undefined
    target?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' })
  }, [upNextIndex, displayEpisodes.length])

  const scrollLeft = () =>
    scrollRef.current?.scrollBy({ left: -(CARD_WIDTH * 3), behavior: 'smooth' })
  const scrollRight = () =>
    scrollRef.current?.scrollBy({ left: CARD_WIDTH * 3, behavior: 'smooth' })

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="w-[220px] sm:w-[280px] flex-shrink-0 rounded-lg bg-zinc-800 animate-pulse"
          >
            <div className="aspect-video w-full bg-zinc-700 rounded-t-lg" />
            <div className="p-3 space-y-2">
              <div className="h-3 w-3/4 bg-zinc-700 rounded" />
              <div className="h-3 w-1/2 bg-zinc-700 rounded" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3 text-zinc-400 py-6">
        <span>Failed to load episodes.</span>
        <button onClick={() => refetch()} className="text-blue-400 hover:underline text-sm">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <EpisodeToolbar
        sortBy={sortBy}
        sortOrder={sortOrder}
        filter={filter}
        onChange={(updates) => {
          if (updates.sortBy !== undefined) setSortBy(updates.sortBy)
          if (updates.sortOrder !== undefined) setSortOrder(updates.sortOrder)
          if (updates.filter !== undefined) setFilter(updates.filter)
        }}
      />

      <div className="relative mt-3">
        {showLeftArrow && (
          <button
            onClick={scrollLeft}
            className="absolute top-1/2 -translate-y-1/2 left-0 -translate-x-1/2 z-10 hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            aria-label="Scroll left"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory [&::-webkit-scrollbar]:hidden pb-2"
          style={{ scrollbarWidth: 'none' }}
        >
          {displayEpisodes.map((ep, i) => (
            <EpisodeCard key={ep.id} episode={ep} isUpNext={i === upNextIndex} />
          ))}
        </div>

        {showRightArrow && (
          <button
            onClick={scrollRight}
            className="absolute top-1/2 -translate-y-1/2 right-0 translate-x-1/2 z-10 hidden sm:flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            aria-label="Scroll right"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
