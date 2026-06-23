'use client'

/**
 * SeriesScopeModal — shown when a user clicks a request button on a TV series.
 *
 * Lets the user pick what to grab:
 *   - Full Series (all seasons, optional monitor-future)
 *   - Specific Seasons (checkboxes, optional monitor-future)
 *   - Specific Episodes (expand a season, pick individual episodes)
 *
 * Fetches season/episode data from the existing TMDB proxy routes:
 *   GET /api/tmdb/tv/[tmdbId]                        → seasons list
 *   GET /api/tmdb/tv/[tmdbId]/season/[n]             → episodes for a season
 *
 * Calls onConfirm with the chosen scope so RequestOptions can attach it to the
 * POST /api/requests body.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { ModalPortal } from '@/components/ui/ModalPortal'
import { useFocusTrap } from '@/hooks/useFocusTrap'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SeriesScopeType = 'full' | 'seasons' | 'episodes'

export interface SeriesScope {
  scopeType: SeriesScopeType
  scopeSeasons?: number[]
  scopeEpisodes?: Array<{ s: number; e: number }>
  monitorFuture: boolean
}

interface SeasonInfo {
  seasonNumber: number
  name: string | null
  episodeCount: number | null
  airDate: string | null
}

interface EpisodeInfo {
  episodeNumber: number
  name: string | null
  airDate: string | null
}

interface Props {
  tmdbId: number
  title: string
  onConfirm: (scope: SeriesScope) => void
  onClose: () => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Spinner({ size = 4 }: { size?: number }) {
  return (
    <svg
      className={`animate-spin h-${size} w-${size} text-zinc-400`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  sublabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (v: boolean) => void
  label: string
  sublabel?: string
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer group">
      <span
        role="checkbox"
        aria-checked={indeterminate ? 'mixed' : checked}
        tabIndex={0}
        className={`relative flex-shrink-0 h-4 w-4 rounded border transition-colors
          ${checked || indeterminate
            ? 'bg-blue-600 border-blue-500'
            : 'bg-zinc-800 border-zinc-600 group-hover:border-zinc-500'
          }`}
        onClick={() => onChange(!checked)}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!checked) } }}
      >
        {indeterminate && !checked && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="block h-0.5 w-2 bg-white rounded" />
          </span>
        )}
        {checked && (
          <svg className="absolute inset-0 h-4 w-4 text-white" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13 4l-6.5 6.5L3 7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        )}
      </span>
      <span className="flex flex-col">
        <span className="text-sm text-zinc-200 leading-tight">{label}</span>
        {sublabel && <span className="text-[10px] text-zinc-500">{sublabel}</span>}
      </span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SeriesScopeModal({ tmdbId, title, onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, onClose)

  const [scopeType, setScopeType] = useState<SeriesScopeType>('full')
  const [monitorFuture, setMonitorFuture] = useState(true)

  // Season list state
  const [seasons, setSeasons] = useState<SeasonInfo[]>([])
  const [seasonsLoading, setSeasonsLoading] = useState(true)
  const [seasonsError, setSeasonsError] = useState('')

  // Selected seasons (for 'seasons' scope)
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number>>(new Set())

  // Episodes expansion state: seasonNumber → episode list
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null)
  const [episodeCache, setEpisodeCache] = useState<Map<number, EpisodeInfo[]>>(new Map())
  const [episodesLoading, setEpisodesLoading] = useState(false)

  // Selected episodes (for 'episodes' scope): Set of "s:e" keys
  const [selectedEpisodes, setSelectedEpisodes] = useState<Set<string>>(new Set())

  // ---------------------------------------------------------------------------
  // Load seasons on mount
  // ---------------------------------------------------------------------------

  // Deferred a tick so setSeasonsLoading runs outside the effect's synchronous
  // commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => {
      setSeasonsLoading(true)
      fetch(`/api/tmdb/tv/${tmdbId}`)
        .then(r => {
          if (!r.ok) throw new Error(`TMDB ${r.status}`)
          return r.json() as Promise<{
            seasons: {
              seasonNumber: number
              name: string | null
              episodeCount: number | null
              airDate: string | null
            }[]
          }>
        })
        .then(data => {
          // Filter out season 0 (specials) — grabbers don't handle them well
          const regular = (data.seasons ?? []).filter(s => s.seasonNumber > 0)
          setSeasons(regular)
          // Pre-select all seasons for 'seasons' scope default
          setSelectedSeasons(new Set(regular.map(s => s.seasonNumber)))
        })
        .catch(err => setSeasonsError(String(err)))
        .finally(() => setSeasonsLoading(false))
    }, 0)
    return () => clearTimeout(id)
  }, [tmdbId])

  // ---------------------------------------------------------------------------
  // Load episodes for an expanded season
  // ---------------------------------------------------------------------------

  const loadEpisodes = useCallback(async (seasonNumber: number) => {
    if (episodeCache.has(seasonNumber)) return
    setEpisodesLoading(true)
    try {
      const r = await fetch(`/api/tmdb/tv/${tmdbId}/season/${seasonNumber}`)
      if (!r.ok) throw new Error(`TMDB ${r.status}`)
      const data = await r.json() as {
        episodes: { episodeNumber: number; name: string | null; airDate: string | null }[]
      }
      setEpisodeCache(prev => new Map(prev).set(seasonNumber, data.episodes ?? []))
    } catch (err) {
      console.error('[SeriesScopeModal] loadEpisodes:', err)
    } finally {
      setEpisodesLoading(false)
    }
  }, [tmdbId, episodeCache])

  function toggleExpandSeason(seasonNumber: number) {
    if (expandedSeason === seasonNumber) {
      setExpandedSeason(null)
    } else {
      setExpandedSeason(seasonNumber)
      void loadEpisodes(seasonNumber)
    }
  }

  // ---------------------------------------------------------------------------
  // Season checkbox helpers
  // ---------------------------------------------------------------------------

  function toggleSeason(n: number) {
    setSelectedSeasons(prev => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  function allSeasonsSelected() {
    return seasons.every(s => selectedSeasons.has(s.seasonNumber))
  }

  function someSeasonsSelected() {
    return seasons.some(s => selectedSeasons.has(s.seasonNumber))
  }

  function toggleAllSeasons() {
    if (allSeasonsSelected()) {
      setSelectedSeasons(new Set())
    } else {
      setSelectedSeasons(new Set(seasons.map(s => s.seasonNumber)))
    }
  }

  // ---------------------------------------------------------------------------
  // Episode checkbox helpers
  // ---------------------------------------------------------------------------

  function epKey(s: number, e: number) { return `${s}:${e}` }

  function toggleEpisode(s: number, e: number) {
    setSelectedEpisodes(prev => {
      const next = new Set(prev)
      const k = epKey(s, e)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function allEpisodesInSeason(seasonNumber: number) {
    const eps = episodeCache.get(seasonNumber) ?? []
    return eps.length > 0 && eps.every(ep => selectedEpisodes.has(epKey(seasonNumber, ep.episodeNumber)))
  }

  function someEpisodesInSeason(seasonNumber: number) {
    const eps = episodeCache.get(seasonNumber) ?? []
    return eps.some(ep => selectedEpisodes.has(epKey(seasonNumber, ep.episodeNumber)))
  }

  function toggleAllEpisodesInSeason(seasonNumber: number) {
    const eps = episodeCache.get(seasonNumber) ?? []
    if (allEpisodesInSeason(seasonNumber)) {
      setSelectedEpisodes(prev => {
        const next = new Set(prev)
        eps.forEach(ep => next.delete(epKey(seasonNumber, ep.episodeNumber)))
        return next
      })
    } else {
      setSelectedEpisodes(prev => {
        const next = new Set(prev)
        eps.forEach(ep => next.add(epKey(seasonNumber, ep.episodeNumber)))
        return next
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  function handleConfirm() {
    if (scopeType === 'full') {
      onConfirm({ scopeType: 'full', monitorFuture })
      return
    }

    if (scopeType === 'seasons') {
      const chosen = Array.from(selectedSeasons).sort((a, b) => a - b)
      if (chosen.length === 0) return  // guard — button disabled below
      onConfirm({ scopeType: 'seasons', scopeSeasons: chosen, monitorFuture })
      return
    }

    if (scopeType === 'episodes') {
      const eps: Array<{ s: number; e: number }> = []
      for (const key of selectedEpisodes) {
        const [sStr, eStr] = key.split(':')
        eps.push({ s: parseInt(sStr, 10), e: parseInt(eStr, 10) })
      }
      eps.sort((a, b) => a.s - b.s || a.e - b.e)
      if (eps.length === 0) return  // guard — button disabled below
      onConfirm({ scopeType: 'episodes', scopeEpisodes: eps, monitorFuture: false })
      return
    }
  }

  const canConfirm =
    scopeType === 'full' ||
    (scopeType === 'seasons' && selectedSeasons.size > 0) ||
    (scopeType === 'episodes' && selectedEpisodes.size > 0)

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <ModalPortal>
    {/* Backdrop */}
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-scope-title"
        className="relative w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
      >

        {/* Header */}
        <div className="flex items-start justify-between px-5 pt-5 pb-3 flex-shrink-0">
          <div>
            <h2 id="series-scope-title" className="text-base font-semibold text-zinc-100 leading-tight">Request Series</h2>
            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors ml-4 flex-shrink-0"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scope type selector */}
        <div className="px-5 pb-3 flex-shrink-0">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">What to request</p>
          <div className="flex gap-1.5">
            {(['full', 'seasons', 'episodes'] as const).map(type => (
              <button
                key={type}
                onClick={() => setScopeType(type)}
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors capitalize ${
                  scopeType === type
                    ? 'bg-blue-900/60 text-blue-300 ring-1 ring-blue-700'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
              >
                {type === 'full' ? 'Full Series' : type === 'seasons' ? 'Seasons' : 'Episodes'}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-zinc-800 flex-shrink-0" />

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">

          {/* Full series — no extra options, just monitor future */}
          {scopeType === 'full' && (
            <p className="text-sm text-zinc-400">
              All existing seasons will be grabbed. New seasons will be picked up automatically
              if &quot;Monitor future&quot; is enabled below.
            </p>
          )}

          {/* Seasons scope */}
          {scopeType === 'seasons' && (
            <div className="space-y-1.5">
              {seasonsLoading && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Spinner size={3} /> Loading seasons...
                </div>
              )}
              {seasonsError && (
                <p className="text-xs text-red-400">{seasonsError}</p>
              )}
              {!seasonsLoading && !seasonsError && seasons.length > 0 && (
                <>
                  <Checkbox
                    checked={allSeasonsSelected()}
                    indeterminate={!allSeasonsSelected() && someSeasonsSelected()}
                    onChange={toggleAllSeasons}
                    label="All seasons"
                  />
                  <div className="ml-4 space-y-1.5 pt-1 border-l border-zinc-800 pl-3">
                    {seasons.map(s => (
                      <Checkbox
                        key={s.seasonNumber}
                        checked={selectedSeasons.has(s.seasonNumber)}
                        onChange={() => toggleSeason(s.seasonNumber)}
                        label={s.name ?? `Season ${s.seasonNumber}`}
                        sublabel={s.episodeCount != null ? `${s.episodeCount} episodes` : undefined}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Episodes scope */}
          {scopeType === 'episodes' && (
            <div className="space-y-2">
              {seasonsLoading && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Spinner size={3} /> Loading seasons...
                </div>
              )}
              {seasonsError && (
                <p className="text-xs text-red-400">{seasonsError}</p>
              )}
              {!seasonsLoading && !seasonsError && seasons.map(s => (
                <div key={s.seasonNumber} className="rounded-lg border border-zinc-800 overflow-hidden">
                  {/* Season header row */}
                  <button
                    onClick={() => toggleExpandSeason(s.seasonNumber)}
                    className="w-full flex items-center justify-between px-3 py-2.5 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-left"
                  >
                    <div className="flex items-center gap-2">
                      {/* Season-level checkbox (indeterminate if partial) */}
                      <span
                        role="checkbox"
                        aria-checked={
                          allEpisodesInSeason(s.seasonNumber)
                            ? 'true'
                            : someEpisodesInSeason(s.seasonNumber)
                            ? 'mixed'
                            : 'false'
                        }
                        className={`flex-shrink-0 h-4 w-4 rounded border flex items-center justify-center transition-colors ${
                          allEpisodesInSeason(s.seasonNumber)
                            ? 'bg-blue-600 border-blue-500'
                            : someEpisodesInSeason(s.seasonNumber)
                            ? 'bg-blue-900/50 border-blue-600'
                            : 'bg-zinc-700 border-zinc-600'
                        }`}
                        onClick={e => {
                          e.stopPropagation()
                          if (episodeCache.has(s.seasonNumber)) {
                            toggleAllEpisodesInSeason(s.seasonNumber)
                          }
                        }}
                      >
                        {allEpisodesInSeason(s.seasonNumber) && (
                          <svg className="h-3 w-3 text-white" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M3 8l3.5 3.5L13 4" />
                          </svg>
                        )}
                        {!allEpisodesInSeason(s.seasonNumber) && someEpisodesInSeason(s.seasonNumber) && (
                          <span className="block h-0.5 w-2 bg-blue-400 rounded" />
                        )}
                      </span>
                      <span className="text-sm text-zinc-200 font-medium">
                        {s.name ?? `Season ${s.seasonNumber}`}
                      </span>
                      {s.episodeCount != null && (
                        <span className="text-[10px] text-zinc-500">{s.episodeCount} eps</span>
                      )}
                    </div>
                    <svg
                      className={`h-4 w-4 text-zinc-500 transition-transform ${expandedSeason === s.seasonNumber ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Episode list */}
                  {expandedSeason === s.seasonNumber && (
                    <div className="px-3 py-2 space-y-1.5 bg-zinc-900">
                      {episodesLoading && !episodeCache.has(s.seasonNumber) && (
                        <div className="flex items-center gap-2 text-xs text-zinc-500 py-1">
                          <Spinner size={3} /> Loading episodes...
                        </div>
                      )}
                      {(episodeCache.get(s.seasonNumber) ?? []).map(ep => (
                        <Checkbox
                          key={ep.episodeNumber}
                          checked={selectedEpisodes.has(epKey(s.seasonNumber, ep.episodeNumber))}
                          onChange={() => toggleEpisode(s.seasonNumber, ep.episodeNumber)}
                          label={`E${String(ep.episodeNumber).padStart(2, '0')}${ep.name ? ` — ${ep.name}` : ''}`}
                          sublabel={ep.airDate ?? undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 border-t border-zinc-800 px-5 py-4 flex flex-col gap-3">
          {/* Monitor future — only relevant for full/seasons scope */}
          {scopeType !== 'episodes' && (
            <Checkbox
              checked={monitorFuture}
              onChange={setMonitorFuture}
              label="Monitor future episodes"
              sublabel="Automatically grab new seasons/episodes as they release"
            />
          )}

          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="rounded-lg px-4 py-2 text-sm font-medium bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
