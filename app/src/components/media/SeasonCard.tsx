'use client'

/**
 * SeasonCard — a TV season tile on the discover detail page. Wraps the existing poster/name/
 * episode-count card (unchanged) and adds an "Episodes" expand toggle. Expanding fetches the
 * TMDB season detail and lists each episode with its still, air date, overview, runtime, and
 * rating, plus a per-episode admin grab control.
 *
 * Per-episode grab reuses SeasonGrabControl's existing `arc` prop (a one-episode "arc" is exactly
 * a single-episode grab through the same findCoveringPacks/fan-out path `/api/grab/season` already
 * uses for TMDB story arcs) — no new grab endpoint needed.
 */

import { useState } from 'react'
import Image from 'next/image'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { SeasonGrabControl } from './SeasonGrabControl'
import { EpisodeGrabList, type NormalizedEpisode } from './EpisodeGrabList'
import type { TVSeasonInfo } from '@/lib/media-server/tmdb'

interface EpisodeInfo {
  id: number | null
  episodeNumber: number
  name: string | null
  airDate: string | null
  stillPath: string | null
  overview: string | null
  runtime: number | null
  voteAverage: number | null
}

interface Props {
  tmdbId: number
  title: string
  year: number | null
  season: TVSeasonInfo
  isAdmin: boolean
}

export function SeasonCard({ tmdbId, title, year, season, isAdmin }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const sPosterUrl = season.posterPath ? `https://image.tmdb.org/t/p/w185${season.posterPath}` : null

  async function toggleExpanded() {
    if (expanded) { setExpanded(false); return }
    setExpanded(true)
    if (episodes !== null || loading) return
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/tmdb/tv/${tmdbId}/season/${season.seasonNumber}`)
      const data = await res.json().catch(() => ({})) as { episodes?: EpisodeInfo[] }
      setEpisodes(data.episodes ?? [])
    } catch {
      setError('Could not load episodes.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/5">
      <div className="relative aspect-[2/3] w-full bg-zinc-800">
        {sPosterUrl ? (
          <Image src={sPosterUrl} alt={season.name ?? `Season ${season.seasonNumber}`} fill sizes="150px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-600 text-xs">No Image</div>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-white line-clamp-1">{season.name ?? `Season ${season.seasonNumber}`}</p>
        {season.episodeCount && (
          <p className="text-[10px] text-zinc-400 mt-0.5">{season.episodeCount} episodes</p>
        )}
        {season.airDate && (
          <p className="text-[10px] text-zinc-500">{season.airDate.slice(0, 4)}</p>
        )}

        {season.seasonNumber > 0 && (
          <button
            type="button"
            onClick={() => void toggleExpanded()}
            className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            Episodes
          </button>
        )}

        {/* Admin-only per-season direct grab (skip specials/season 0). */}
        {isAdmin && season.seasonNumber > 0 && (
          <SeasonGrabControl
            tmdbId={tmdbId}
            title={title}
            year={year}
            seasonNumber={season.seasonNumber}
            seasonName={season.name ?? `Season ${season.seasonNumber}`}
            episodeCount={season.episodeCount}
          />
        )}
      </div>

      {expanded && (
        <div className="border-t border-white/5 p-2 flex flex-col gap-2">
          {loading && <p className="text-[10px] text-zinc-500">Loading episodes…</p>}
          {error && <p className="text-[10px] text-red-400">{error}</p>}
          {episodes && (
            <EpisodeGrabList
              tmdbId={tmdbId}
              title={title}
              year={year}
              isAdmin={isAdmin}
              episodes={episodes.map((ep): NormalizedEpisode => ({ ...ep, seasonNumber: season.seasonNumber }))}
            />
          )}
        </div>
      )}
    </div>
  )
}
