'use client'

/**
 * EpisodeGrabList — renders a list of episode rows (still, air date, overview, runtime, rating)
 * each with a per-episode admin grab control. Shared by SeasonCard (plain TMDB seasons) and the
 * Arcs section (TMDB story-arc groupings) so both surfaces get the same per-episode metadata +
 * grab UI without duplicating the row markup.
 *
 * Per-episode grab reuses SeasonGrabControl's `arc` prop (a one-episode "arc" is exactly a
 * single-episode grab through the same findCoveringPacks/fan-out path `/api/grab/season` already
 * uses for TMDB story arcs) — no new grab endpoint needed.
 */

import Image from 'next/image'
import { SeasonGrabControl } from './SeasonGrabControl'

export interface NormalizedEpisode {
  seasonNumber: number
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
  episodes: NormalizedEpisode[]
  isAdmin: boolean
}

function formatRuntime(minutes: number | null): string | null {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function EpisodeGrabList({ tmdbId, title, year, episodes, isAdmin }: Props) {
  if (episodes.length === 0) {
    return <p className="text-[10px] text-zinc-500">No episode data from TMDB for this scope.</p>
  }
  return (
    <>
      {episodes.map((ep) => {
        const stillUrl = ep.stillPath ? `https://image.tmdb.org/t/p/w300${ep.stillPath}` : null
        const runtime = formatRuntime(ep.runtime)
        const label = `S${ep.seasonNumber}E${ep.episodeNumber}`
        return (
          <div key={`${ep.seasonNumber}-${ep.episodeNumber}`} className="flex gap-2 rounded bg-zinc-950/50 p-1.5">
            <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-zinc-800">
              {stillUrl ? (
                <Image src={stillUrl} alt={ep.name ?? label} fill sizes="80px" className="object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[9px] text-zinc-600">No Image</div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium text-zinc-200 line-clamp-1">
                {label}{ep.name ? ` — ${ep.name}` : ''}
              </p>
              <p className="text-[9px] text-zinc-500">
                {ep.airDate ?? 'Unaired'}{runtime ? ` · ${runtime}` : ''}{ep.voteAverage ? ` · ★ ${ep.voteAverage.toFixed(1)}` : ''}
              </p>
              {ep.overview && (
                <p className="text-[10px] text-zinc-400 line-clamp-2 mt-0.5">{ep.overview}</p>
              )}
              {isAdmin && (
                <div className="mt-1 max-w-[140px]">
                  <SeasonGrabControl
                    tmdbId={tmdbId}
                    title={title}
                    year={year}
                    seasonName={`${label}${ep.name ? ` — ${ep.name}` : ''}`}
                    episodeCount={1}
                    arc={{ name: label, episodes: [{ s: ep.seasonNumber, e: ep.episodeNumber }] }}
                  />
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
