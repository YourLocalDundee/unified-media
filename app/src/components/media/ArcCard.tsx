'use client'

/**
 * ArcCard — a TV story-arc tile on the discover detail page (Bug 7: shows like Pokémon/One Piece
 * that TMDB groups into arcs instead of plain seasons). Mirrors SeasonCard's "Episodes" expand
 * affordance, but needs no extra fetch — getArcs() already embeds full per-episode metadata from
 * TMDB's episode_group response, so expanding just reveals data already on the arc object.
 *
 * Arcs are already release-ordered: SeriesArc.order comes from TMDB's official arc grouping order,
 * which the caller (getArcs) already sorts by — no separate airDate sort needed here.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { SeasonGrabControl } from './SeasonGrabControl'
import { EpisodeGrabList, type NormalizedEpisode } from './EpisodeGrabList'
import type { SeriesArc } from '@/lib/media-server/tmdb'

interface Props {
  tmdbId: number
  title: string
  year: number | null
  arc: SeriesArc
  isAdmin: boolean
}

export function ArcCard({ tmdbId, title, year, arc, isAdmin }: Props) {
  const [expanded, setExpanded] = useState(false)

  const nums = arc.episodes.map((e) => e.e).filter((n) => n > 0).sort((x, y) => x - y)
  const range = nums.length > 0 ? (nums[0] === nums[nums.length - 1] ? `Ep ${nums[0]}` : `Eps ${nums[0]}–${nums[nums.length - 1]}`) : null

  return (
    <div className="flex flex-col justify-between overflow-hidden rounded-lg bg-zinc-900 p-3 ring-1 ring-white/5">
      <div>
        <p className="text-xs font-semibold text-white line-clamp-2">{arc.name}</p>
        <p className="mt-0.5 text-[10px] text-zinc-400">{arc.episodeCount} episodes{range ? ` · ${range}` : ''}</p>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
      >
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Episodes
      </button>

      {isAdmin && (
        <SeasonGrabControl
          tmdbId={tmdbId}
          title={title}
          year={year}
          seasonName={arc.name}
          episodeCount={arc.episodeCount}
          arc={{ name: arc.name, episodes: arc.episodes }}
        />
      )}

      {expanded && (
        <div className="mt-2 border-t border-white/5 pt-2 flex flex-col gap-2">
          <EpisodeGrabList
            tmdbId={tmdbId}
            title={title}
            year={year}
            isAdmin={isAdmin}
            episodes={arc.episodes.map((ep): NormalizedEpisode => ({
              seasonNumber: ep.s,
              episodeNumber: ep.e,
              name: ep.name,
              airDate: ep.airDate,
              stillPath: ep.stillPath,
              overview: ep.overview,
              runtime: ep.runtime,
              voteAverage: ep.voteAverage,
            }))}
          />
        </div>
      )}
    </div>
  )
}
