'use client'

import { useState, useCallback } from 'react'
import { Spinner } from '@/components/ui/Spinner'
import { EpisodeRow } from './EpisodeRow'

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

interface SeasonSummary {
  id: number
  seasonNumber: number
  episodeCount?: number
  airDate?: string | null
  overview?: string
  name?: string
}

interface SeasonAccordionProps {
  tmdbId: number
  season: SeasonSummary
}

type SortField = 'episodeNumber' | 'airDate' | 'runtime'
type SortDirection = 'asc' | 'desc'

function sortEpisodes(episodes: Episode[], field: SortField, direction: SortDirection): Episode[] {
  const sorted = [...episodes].sort((a, b) => {
    let aVal: number
    let bVal: number

    if (field === 'episodeNumber') {
      aVal = a.episodeNumber
      bVal = b.episodeNumber
    } else if (field === 'airDate') {
      aVal = a.airDate ? new Date(a.airDate).getTime() : 0
      bVal = b.airDate ? new Date(b.airDate).getTime() : 0
    } else {
      aVal = a.runtime ?? 0
      bVal = b.runtime ?? 0
    }

    return direction === 'asc' ? aVal - bVal : bVal - aVal
  })
  return sorted
}

function formatAirYear(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return String(d.getFullYear())
}

export function SeasonAccordion({ tmdbId, season }: SeasonAccordionProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [episodes, setEpisodes] = useState<Episode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('episodeNumber')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const fetchEpisodes = useCallback(async () => {
    if (episodes !== null) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/tmdb/tv/${tmdbId}/season/${season.seasonNumber}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { episodes?: Episode[] }
      setEpisodes(data.episodes ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load episodes')
    } finally {
      setLoading(false)
    }
  }, [tmdbId, season.seasonNumber, episodes])

  const handleToggle = () => {
    const next = !isOpen
    setIsOpen(next)
    if (next) {
      void fetchEpisodes()
    }
  }

  const seasonLabel = season.name ?? `Season ${season.seasonNumber}`
  const airYear = formatAirYear(season.airDate)
  const sortedEpisodes = episodes ? sortEpisodes(episodes, sortField, sortDirection) : []

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700">
      {/* Header */}
      <button
        type="button"
        onClick={handleToggle}
        className="flex w-full items-center justify-between gap-3 bg-zinc-800 px-4 py-3 text-left transition-colors hover:bg-zinc-700"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-zinc-100">{seasonLabel}</span>
          {season.episodeCount != null && (
            <span className="text-xs text-zinc-400">{season.episodeCount} episodes</span>
          )}
          {airYear && <span className="text-xs text-zinc-500">{airYear}</span>}
        </div>
        <svg
          className={`h-4 w-4 flex-shrink-0 text-zinc-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Body */}
      {isOpen && (
        <div className="bg-zinc-900 px-4 py-3">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Spinner size="md" className="text-zinc-400" />
            </div>
          )}

          {error && !loading && (
            <p className="py-4 text-center text-sm text-red-400">
              Failed to load episodes: {error}
            </p>
          )}

          {!loading && !error && episodes !== null && (
            <>
              {/* Sort toolbar */}
              {episodes.length > 1 && (
                <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-zinc-500">Sort by:</span>
                  {(
                    [
                      { value: 'episodeNumber', label: 'Episode' },
                      { value: 'airDate', label: 'Air date' },
                      { value: 'runtime', label: 'Runtime' },
                    ] as { value: SortField; label: string }[]
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSortField(value)}
                      className={`rounded px-2 py-0.5 transition-colors ${
                        sortField === value
                          ? 'bg-zinc-600 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <span className="ml-2 text-zinc-500">Direction:</span>
                  {(
                    [
                      { value: 'asc', label: 'Ascending' },
                      { value: 'desc', label: 'Descending' },
                    ] as { value: SortDirection; label: string }[]
                  ).map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSortDirection(value)}
                      className={`rounded px-2 py-0.5 transition-colors ${
                        sortDirection === value
                          ? 'bg-zinc-600 text-zinc-100'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              {sortedEpisodes.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-500">No episodes available.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {sortedEpisodes.map((ep) => (
                    <EpisodeRow key={ep.id} episode={ep} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
