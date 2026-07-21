'use client'

import Image from 'next/image'
import { useState, useEffect, useRef, useCallback } from 'react'
import type { TorrentSearchResult } from '@/app/api/torrent-search/route'
import { ModalPortal } from '@/components/ui/ModalPortal'
import { useFocusTrap } from '@/hooks/useFocusTrap'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number) {
  if (!bytes) return '—'
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function formatAge(dateStr: string) {
  if (!dateStr) return '—'
  const ms = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(ms / 86400000)
  if (d < 1) return 'today'
  if (d < 30) return `${d}d`
  if (d < 365) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}

// Rough quality label from release title
function qualityLabel(title: string): string {
  const t = title.toUpperCase()
  if (t.includes('2160P') || t.includes('4K') || t.includes('UHD')) return '4K'
  if (t.includes('1080P')) return '1080p'
  if (t.includes('720P')) return '720p'
  if (t.includes('480P')) return '480p'
  return ''
}

const QUALITY_COLORS: Record<string, string> = {
  '4K': 'bg-purple-900/50 text-purple-300',
  '1080p': 'bg-blue-900/50 text-blue-300',
  '720p': 'bg-green-900/40 text-green-300',
  '480p': 'bg-zinc-700 text-zinc-400',
}

type SortKey = 'seeders' | 'size' | 'age' | 'score'
type QualityFilter = 'all' | '4K' | '1080p' | '720p' | 'other'
type DurationChoice = 'quick' | 'longterm'

// Client-side language detection for display purposes (mirrors parser.ts LANGUAGE_PATTERNS)
const LANG_PATTERNS: Array<[RegExp, string]> = [
  [/\b(English|ENG)\b/i, 'EN'],
  [/\b(French|VF|VOSTFR|TRUEFRENCH)\b/i, 'FR'],
  [/\b(German|Deutsch)\b/i, 'DE'],
  [/\b(Spanish|Español|ESP)\b/i, 'ES'],
  [/\b(Italian|Italiano)\b/i, 'IT'],
  [/\b(Portuguese|Portugues)\b/i, 'PT'],
  [/\b(Dutch|NL)\b/i, 'NL'],
  [/\b(Japanese|JPN)\b/i, 'JA'],
  [/\b(Chinese|CHI)\b/i, 'ZH'],
  [/\b(Korean|KOR)\b/i, 'KO'],
  [/\b(Russian|RUS)\b/i, 'RU'],
]

function detectLang(title: string): string | null {
  for (const [re, code] of LANG_PATTERNS) {
    if (re.test(title)) return code
  }
  return null
}

type ScopeSeason = number | 'all'
type ScopeEpisode = number | 'all'

interface ScopeSeasonInfo {
  seasonNumber: number
  name: string | null
  episodeCount: number | null
}

interface ScopeEpisodeInfo {
  episodeNumber: number
  name: string | null
}

// Build the indexer search query for the chosen TV scope. Mirrors the auto-grab
// grabber's `buildSearchParams`: "Title S04E06" for a specific episode, "Title S04"
// for a whole season, and the bare title for the entire series. Embedding SxxExx in
// the free-text query is the proven path used by the working auto-grab flow, so the
// indexer aggregation layer returns releases scoped to the selection.
function buildScopedQuery(title: string, season: ScopeSeason, episode: ScopeEpisode): string {
  if (season === 'all') return title
  const s = `S${String(season).padStart(2, '0')}`
  if (episode === 'all') return `${title} ${s}`
  return `${title} ${s}E${String(episode).padStart(2, '0')}`
}

const LANGUAGE_OPTIONS = [
  { value: 'any', label: 'Any language' },
  { value: 'en',  label: 'English' },
  { value: 'fr',  label: 'French' },
  { value: 'de',  label: 'German' },
  { value: 'es',  label: 'Spanish' },
  { value: 'it',  label: 'Italian' },
  { value: 'pt',  label: 'Portuguese' },
  { value: 'nl',  label: 'Dutch' },
  { value: 'ja',  label: 'Japanese' },
  { value: 'zh',  label: 'Chinese' },
  { value: 'ko',  label: 'Korean' },
  { value: 'ru',  label: 'Russian' },
]

const AUDIO_MODE_OPTIONS = [
  { value: 'any', label: 'Any audio' },
  { value: 'dub', label: 'Dub' },
  { value: 'sub', label: 'Sub' },
]

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

interface Props {
  title: string
  year: number | null
  tmdbId: number
  mediaType: 'movie' | 'tv'
  posterPath: string | null
  overview: string | null
  isOldContent: boolean
  defaultLanguage?: string
  defaultAudioMode?: string
  defaultRetention?: string
  onClose: () => void
  onPicked: (status: 'approved' | 'pending', type: DurationChoice) => void
  // When supplied, handleSubmit calls this INSTEAD of its own POST /api/requests. Needed because
  // by the time "Search manually" is reachable from the grab-confirmation flow, a media_requests
  // row already exists for this (user, tmdb_id, media_type) — the internal POST would 409 and
  // onPicked('pending') would fire as a silent no-op with nothing actually grabbed. The override
  // routes the pick through POST /api/grab/confirm instead. Rejecting leaves the modal open with
  // submitError shown; resolving closes the modal (mirrors the internal-fetch success path).
  onSubmitOverride?: (
    picked: TorrentSearchResult,
    duration: DurationChoice,
    language: string,
    audioMode: string,
  ) => Promise<void>
}

export function TorrentPickModal({
  title, year, tmdbId, mediaType, posterPath, overview,
  isOldContent, defaultLanguage = 'any', defaultAudioMode = 'any', defaultRetention, onClose, onPicked,
  onSubmitOverride,
}: Props) {
  const [query, setQuery] = useState(title)
  const [results, setResults] = useState<TorrentSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sortKey, setSortKey] = useState<SortKey>('seeders')
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [indexerFilter, setIndexerFilter] = useState<string>('all')
  const [picked, setPicked] = useState<TorrentSearchResult | null>(null)
  const [duration, setDuration] = useState<DurationChoice>(
    defaultRetention === 'quick' || defaultRetention === 'longterm'
      ? (defaultRetention as DurationChoice)
      : (isOldContent ? 'quick' : 'longterm')
  )

  const [language, setLanguage] = useState(defaultLanguage)
  const [audioMode, setAudioMode] = useState(defaultAudioMode)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // TV scope selection — lets the user pre-scope the indexer search to an entire
  // series, a single season, or a single episode before browsing releases. Only
  // populated for mediaType === 'tv'; movies keep their single-scope flow untouched.
  const [seasons, setSeasons] = useState<ScopeSeasonInfo[]>([])
  const [scopeSeason, setScopeSeason] = useState<ScopeSeason>('all')
  const [scopeEpisode, setScopeEpisode] = useState<ScopeEpisode>('all')
  const [scopeEpisodes, setScopeEpisodes] = useState<ScopeEpisodeInfo[]>([])
  const [scopeEpisodesLoading, setScopeEpisodesLoading] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, onClose)
  // Abort controller for any in-flight search — aborts stale requests when a new
  // dropdown change fires before the previous search completes (A7-15).
  const searchAbortRef = useRef<AbortController | null>(null)

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) return
    // Cancel any in-flight search
    searchAbortRef.current?.abort()
    const ctrl = new AbortController()
    searchAbortRef.current = ctrl
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const params = new URLSearchParams({ q: q.trim(), type: mediaType })
      const res = await fetch(`/api/torrent-search?${params}`, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`Search failed (${res.status})`)
      const data = await res.json() as { results: TorrentSearchResult[] }
      setResults(data.results)
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return // superseded by a newer search
      setError(e instanceof Error ? e.message : 'Search error')
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [mediaType])

  // Auto-search on open. Deferred a tick so runSearch's loading setState runs
  // outside the effect's synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => void runSearch(title), 0)
    inputRef.current?.focus()
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the season list for the TV scope selector (no-op for movies). Depends only
  // on the stable tmdbId, and never writes a value it reads back — no render loop.
  useEffect(() => {
    if (mediaType !== 'tv') return
    let cancelled = false
    fetch(`/api/tmdb/tv/${tmdbId}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`TMDB ${r.status}`))))
      .then((data: { seasons?: ScopeSeasonInfo[] }) => {
        if (cancelled) return
        // Drop season 0 (specials) — indexers rarely have clean releases for them.
        setSeasons((data.seasons ?? []).filter(s => s.seasonNumber > 0))
      })
      .catch(() => { /* scope selector simply won't render — search still works title-wide */ })
    return () => { cancelled = true }
  }, [mediaType, tmdbId])

  // Season dropdown change — reset episode, load that season's episodes for the
  // episode dropdown, and re-run the search pre-scoped to the new selection.
  async function handleSeasonChange(value: string) {
    if (value === 'all') {
      setScopeSeason('all')
      setScopeEpisode('all')
      setScopeEpisodes([])
      const q = buildScopedQuery(title, 'all', 'all')
      setQuery(q)
      void runSearch(q)
      return
    }
    const season = parseInt(value, 10)
    setScopeSeason(season)
    setScopeEpisode('all')
    setScopeEpisodes([])
    setScopeEpisodesLoading(true)
    try {
      const r = await fetch(`/api/tmdb/tv/${tmdbId}/season/${season}`)
      if (r.ok) {
        const data = await r.json() as { episodes?: ScopeEpisodeInfo[] }
        setScopeEpisodes(data.episodes ?? [])
      }
    } catch {
      /* episode dropdown stays empty; season-pack search still works */
    } finally {
      setScopeEpisodesLoading(false)
    }
    const q = buildScopedQuery(title, season, 'all')
    setQuery(q)
    void runSearch(q)
  }

  // Episode dropdown change — re-run the search pre-scoped to SxxExx (or the season
  // pack when "All episodes" is chosen).
  function handleEpisodeChange(value: string) {
    const episode: ScopeEpisode = value === 'all' ? 'all' : parseInt(value, 10)
    setScopeEpisode(episode)
    const q = buildScopedQuery(title, scopeSeason, episode)
    setQuery(q)
    void runSearch(q)
  }

  // Indexer list for filter
  const indexers = ['all', ...Array.from(new Set(results.map(r => r.indexerName))).sort()]

  // Apply filters + sort
  const visible = results
    .filter(r => {
      if (qualityFilter !== 'all') {
        const ql = qualityLabel(r.title)
        if (qualityFilter === 'other') {
          if (['4K', '1080p', '720p'].includes(ql)) return false
        } else if (ql !== qualityFilter) return false
      }
      if (indexerFilter !== 'all' && r.indexerName !== indexerFilter) return false
      return true
    })
    .sort((a, b) => {
      if (sortKey === 'seeders') return b.seeders - a.seeders
      if (sortKey === 'size') return b.size - a.size
      if (sortKey === 'age') return new Date(b.publishDate).getTime() - new Date(a.publishDate).getTime()
      return b.score - a.score
    })

  async function handleSubmit() {
    if (!picked) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      if (onSubmitOverride) {
        await onSubmitOverride(picked, duration, language, audioMode)
        onClose()
        return
      }

      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId,
          mediaType,
          title,
          year,
          posterPath,
          overview,
          requestType: duration,
          requestMethod: 'interactive',
          language,
          audioMode,
          pickedTorrent: {
            magnetUrl: picked.magnetUrl,
            downloadUrl: picked.downloadUrl,
            infoHash: picked.infoHash,
            indexerName: picked.indexerName,
            releaseTitle: picked.title,
            seeders: picked.seeders,
            size: picked.size,
          },
        }),
      })

      // Interactive requests always return 'pending' (admin must approve)
      if (res.status === 409) { onPicked('pending', duration); return }
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      onPicked('pending', duration)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <ModalPortal>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="torrent-pick-title"
        className="flex flex-col w-full max-w-4xl max-h-[90vh] rounded-xl border border-border bg-card shadow-2xl overflow-hidden"
      >

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {posterPath && (
              <Image
                src={`https://image.tmdb.org/t/p/w92${posterPath}`}
                alt={title}
                width={40}
                height={56}
                className="h-14 w-10 rounded object-cover shrink-0"
              />
            )}
            <div className="min-w-0">
              <h2 id="torrent-pick-title" className="font-semibold text-white truncate">{title}</h2>
              <p className="text-xs text-zinc-500">{year} · {mediaType === 'movie' ? 'Movie' : 'TV Show'} · Choose a release</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 text-zinc-500 hover:text-white transition-colors text-xl leading-none"
            aria-label="Close"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {/* TV scope selector — pre-scope the indexer search to a season or episode */}
        {mediaType === 'tv' && seasons.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-zinc-800 shrink-0">
            <span className="text-xs text-zinc-500 shrink-0">Scope:</span>
            <select
              value={scopeSeason === 'all' ? 'all' : String(scopeSeason)}
              onChange={e => void handleSeasonChange(e.target.value)}
              className="rounded px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            >
              <option value="all">Entire series</option>
              {seasons.map(s => (
                <option key={s.seasonNumber} value={s.seasonNumber}>
                  {s.name ?? `Season ${s.seasonNumber}`}
                  {s.episodeCount != null ? ` (${s.episodeCount} eps)` : ''}
                </option>
              ))}
            </select>
            {scopeSeason !== 'all' && (
              <select
                value={scopeEpisode === 'all' ? 'all' : String(scopeEpisode)}
                onChange={e => handleEpisodeChange(e.target.value)}
                disabled={scopeEpisodesLoading}
                className="rounded px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:opacity-50"
              >
                <option value="all">All episodes (season pack)</option>
                {scopeEpisodes.map(ep => (
                  <option key={ep.episodeNumber} value={ep.episodeNumber}>
                    E{String(ep.episodeNumber).padStart(2, '0')}{ep.name ? ` — ${ep.name}` : ''}
                  </option>
                ))}
              </select>
            )}
            <span className="text-[10px] text-zinc-600 shrink-0">
              {scopeEpisodesLoading ? 'Loading episodes…' : 'Results are scoped to this selection.'}
            </span>
          </div>
        )}

        {/* Search bar */}
        <div className="px-5 py-3 border-b border-zinc-800 shrink-0">
          <form
            onSubmit={e => { e.preventDefault(); void runSearch(query) }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search torrent sites…"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-zinc-700 hover:bg-zinc-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 transition-colors"
            >
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
        </div>

        {/* Filters */}
        {searched && results.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 border-b border-zinc-800 shrink-0 overflow-x-auto">
            {/* Quality */}
            <div className="flex gap-1 shrink-0">
              {(['all', '4K', '1080p', '720p', 'other'] as QualityFilter[]).map(q => (
                <button
                  key={q}
                  onClick={() => setQualityFilter(q)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    qualityFilter === q ? 'bg-white text-black' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  {q === 'all' ? 'All quality' : q}
                </button>
              ))}
            </div>

            <div className="h-4 w-px bg-zinc-700 shrink-0" />

            {/* Indexer */}
            <select
              value={indexerFilter}
              onChange={e => setIndexerFilter(e.target.value)}
              className="rounded px-2 py-0.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 focus:outline-none"
            >
              {indexers.map(i => (
                <option key={i} value={i}>{i === 'all' ? 'All indexers' : i}</option>
              ))}
            </select>

            <div className="h-4 w-px bg-zinc-700 shrink-0" />

            {/* Sort */}
            <div className="flex gap-1 shrink-0">
              {([['seeders', 'Seeds'], ['size', 'Size'], ['age', 'Newest'], ['score', 'Score']] as [SortKey, string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSortKey(k)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    sortKey === k ? 'bg-zinc-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <span className="ml-auto text-xs text-zinc-600 shrink-0">{visible.length} results</span>
          </div>
        )}

        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
              Searching all indexers…
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-40 text-red-400 text-sm">
              {error}
            </div>
          )}

          {!loading && searched && !error && visible.length === 0 && (
            <div className="flex items-center justify-center h-40 text-zinc-500 text-sm">
              No results found. Try a different search or filter.
            </div>
          )}

          {!loading && visible.length > 0 && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr>
                  <th className="py-2 pl-4 pr-2 text-left text-xs font-medium text-zinc-500 w-4"></th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-zinc-500">Release</th>
                  <th className="py-2 px-2 text-left text-xs font-medium text-zinc-500 hidden sm:table-cell">Indexer</th>
                  <th className="py-2 px-2 text-right text-xs font-medium text-zinc-500">Seeds</th>
                  <th className="py-2 px-2 text-right text-xs font-medium text-zinc-500 hidden md:table-cell">Size</th>
                  <th className="py-2 px-2 text-right text-xs font-medium text-zinc-500 hidden lg:table-cell">Lang</th>
                  <th className="py-2 px-2 text-right text-xs font-medium text-zinc-500 hidden lg:table-cell">Audio</th>
                  <th className="py-2 px-2 text-right text-xs font-medium text-zinc-500 hidden lg:table-cell">Age</th>
                  <th className="py-2 pl-2 pr-4 text-right text-xs font-medium text-zinc-500">Pick</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r, i) => {
                  const ql = qualityLabel(r.title)
                  const isSelected = picked === r
                  return (
                    <tr
                      key={r.infoHash || r.title + i}
                      onClick={() => setPicked(isSelected ? null : r)}
                      className={`border-b border-zinc-800/50 cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-900/20 border-blue-800/50'
                          : 'hover:bg-zinc-900/60'
                      }`}
                    >
                      {/* Selection indicator */}
                      <td className="py-2.5 pl-4 pr-2">
                        <div className={`h-3.5 w-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isSelected ? 'border-blue-400 bg-blue-400' : 'border-zinc-600'
                        }`}>
                          {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>
                      </td>

                      {/* Title + quality badge */}
                      <td className="py-2.5 px-2 max-w-xs">
                        <div className="flex items-start gap-1.5">
                          {ql && (
                            <span className={`shrink-0 mt-0.5 rounded px-1 py-0 text-[10px] font-semibold ${QUALITY_COLORS[ql] ?? 'bg-zinc-700 text-zinc-400'}`}>
                              {ql}
                            </span>
                          )}
                          {r.upscaleWarning && (
                            <span
                              className="shrink-0 mt-0.5 rounded bg-orange-900/50 px-1 py-0 text-[10px] font-semibold text-orange-300"
                              title={r.upscaleWarning}
                            >
                              ⚠ fake 4K?
                            </span>
                          )}
                          <span className={`leading-tight text-xs line-clamp-2 ${isSelected ? 'text-white' : 'text-zinc-300'}`}>
                            {r.title}
                          </span>
                        </div>
                      </td>

                      {/* Indexer */}
                      <td className="py-2.5 px-2 hidden sm:table-cell">
                        <span className="text-xs text-zinc-500 truncate block max-w-[130px]">{r.indexerName}</span>
                      </td>

                      {/* Seeders */}
                      <td className="py-2.5 px-2 text-right">
                        <span className={`text-xs font-medium ${r.seeders > 50 ? 'text-green-400' : r.seeders > 5 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {r.seeders}
                        </span>
                      </td>

                      {/* Size */}
                      <td className="py-2.5 px-2 text-right hidden md:table-cell">
                        <span className="text-xs text-zinc-500">{formatBytes(r.size)}</span>
                      </td>

                      {/* Language badge */}
                      <td className="py-2.5 px-2 text-right hidden lg:table-cell">
                        {(() => { const l = detectLang(r.title); return l ? <span className="text-[10px] font-medium bg-zinc-700 text-zinc-300 rounded px-1">{l}</span> : <span className="text-[10px] text-zinc-700">—</span> })()}
                      </td>

                      {/* Audio (dub/sub) badge — soft preference is scored server-side for auto-pick,
                          but interactive picks bypass scoring, so this is the visual cue that lets
                          the admin verify a release actually matches before picking it. */}
                      <td className="py-2.5 px-2 text-right hidden lg:table-cell">
                        {r.audioMode ? (
                          <span className={`text-[10px] font-medium rounded px-1 ${r.audioMode === 'dub' ? 'bg-sky-900/60 text-sky-300' : 'bg-amber-900/50 text-amber-300'}`}>
                            {r.audioMode === 'dub' ? 'Dub' : 'Sub'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-zinc-700">—</span>
                        )}
                      </td>

                      {/* Age */}
                      <td className="py-2.5 px-2 text-right hidden lg:table-cell">
                        <span className="text-xs text-zinc-600">{formatAge(r.publishDate)}</span>
                      </td>

                      {/* Pick button */}
                      <td className="py-2.5 pl-2 pr-4 text-right">
                        <button
                          onClick={e => { e.stopPropagation(); setPicked(isSelected ? null : r) }}
                          className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Pick'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer — retention toggle + language + submit */}
        <div className="shrink-0 border-t border-zinc-800 px-5 py-4 flex flex-col gap-3">
          {/* Selected release summary */}
          {picked ? (
            <p className="text-xs text-zinc-400 truncate">
              <span className="text-white font-medium">{picked.title.slice(0, 70)}{picked.title.length > 70 ? '…' : ''}</span>
              {' '}· {picked.indexerName} · {picked.seeders} seeds
            </p>
          ) : (
            <p className="text-xs text-zinc-500">Select a release from the list above.</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {/* Left: Retention + Language */}
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2 items-center flex-wrap">
                <span className="text-xs text-zinc-500">Retention:</span>
                {isOldContent && (
                  <button
                    onClick={() => setDuration('quick')}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      duration === 'quick'
                        ? 'bg-amber-800/60 text-amber-300 ring-1 ring-amber-600'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    48hr
                  </button>
                )}
                <button
                  onClick={() => setDuration('longterm')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    duration === 'longterm'
                      ? 'bg-blue-900/50 text-blue-300 ring-1 ring-blue-700'
                      : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                  }`}
                >
                  Long-term
                </button>
              </div>

              <div className="flex gap-2 items-center">
                <span className="text-xs text-zinc-500">Language:</span>
                <select
                  value={language}
                  onChange={e => setLanguage(e.target.value)}
                  className="rounded px-1.5 py-0.5 text-xs bg-zinc-900 border border-zinc-700 text-zinc-300 focus:outline-none"
                >
                  {LANGUAGE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {mediaType === 'tv' && (
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-zinc-500">Audio:</span>
                  <select
                    value={audioMode}
                    onChange={e => setAudioMode(e.target.value)}
                    className="rounded px-1.5 py-0.5 text-xs bg-zinc-900 border border-zinc-700 text-zinc-300 focus:outline-none"
                  >
                    {AUDIO_MODE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <p className="text-[10px] text-zinc-600">Interactive picks always go to admin queue regardless of retention.</p>
            </div>

            {/* Right: Cancel + Submit */}
            <div className="flex gap-2 items-center self-end sm:self-auto">
              {submitError && (
                <span className="text-xs text-red-400 max-w-[180px]">{submitError}</span>
              )}
              <button
                onClick={onClose}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={!picked || submitting}
                className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-white transition-colors min-w-[110px] text-center"
              >
                {submitting ? 'Requesting…' : `Request (${duration === 'quick' ? '48hr' : 'Long-term'})`}
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
    </ModalPortal>
  )
}
