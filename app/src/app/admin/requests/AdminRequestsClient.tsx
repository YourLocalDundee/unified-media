'use client'

import { useState, useCallback } from 'react'
import type { NativeRequestWithUser, RequestStatus, PreferredRelease } from '@/lib/requests/types'
import type { ScoredCandidate, GrabResultRow } from '@/lib/automation/grab-results'
import type { TorrentSearchResult } from '@/app/api/torrent-search/route'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'pending' | 'approved' | 'declined' | 'available' | 'expired'

const FILTER_TABS: { value: FilterTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
  { value: 'available', label: 'Available' },
  { value: 'expired', label: 'Expired' },
]

const STATUS_BADGE: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-600/30 text-yellow-300' },
  approved: { label: 'Approved', className: 'bg-blue-600/30 text-blue-300' },
  declined: { label: 'Declined', className: 'bg-red-600/30 text-red-300' },
  available: { label: 'Available', className: 'bg-green-600/30 text-green-300' },
  expired: { label: 'Expired', className: 'bg-zinc-600/30 text-zinc-400' },
}

function tmdbImageUrl(path: string, size = 'w92') {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

// Formats the scope fields (stored as snake_case in the DB row) into a human-readable string.
// Returns null for movies or when scope is absent/full-series-default.
function formatScope(req: NativeRequestWithUser): string | null {
  if (req.media_type !== 'tv') return null
  // DB rows come back with snake_case keys; the TS type uses camelCase as an aspirational alias.
  const raw = req as unknown as Record<string, unknown>
  const scopeType = (raw.scope_type ?? raw.scopeType) as string | null | undefined
  if (!scopeType || scopeType === 'movie') return null
  if (scopeType === 'full') return 'Full Series'
  if (scopeType === 'seasons') {
    const raw_seasons = raw.scope_seasons ?? raw.scopeSeasons
    let seasons: number[] = []
    if (typeof raw_seasons === 'string') {
      try { seasons = JSON.parse(raw_seasons) as number[] } catch { /* ignore */ }
    } else if (Array.isArray(raw_seasons)) {
      seasons = raw_seasons as number[]
    }
    if (seasons.length === 0) return null
    return `Seasons: ${seasons.join(', ')}`
  }
  if (scopeType === 'episodes') {
    const raw_eps = raw.scope_episodes ?? raw.scopeEpisodes
    let eps: Array<{ s: number; e: number }> = []
    if (typeof raw_eps === 'string') {
      try { eps = JSON.parse(raw_eps) as Array<{ s: number; e: number }> } catch { /* ignore */ }
    } else if (Array.isArray(raw_eps)) {
      eps = raw_eps as Array<{ s: number; e: number }>
    }
    if (eps.length === 0) return null
    return `Episodes: ${eps.map(ep => `S${String(ep.s).padStart(2, '0')}E${String(ep.e).padStart(2, '0')}`).join(', ')}`
  }
  return null
}

function formatTimestamp(ms: number) {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '—'
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// ---------------------------------------------------------------------------
// Grab results panel
// ---------------------------------------------------------------------------

interface GrabResultsPanelProps {
  requestId: number
  status: RequestStatus
}

function GrabResultsPanel({ requestId, status }: GrabResultsPanelProps) {
  const [data, setData] = useState<GrabResultRow | null | undefined>(undefined) // undefined = not loaded
  const [loading, setLoading] = useState(false)
  const [researchBusy, setResearchBusy] = useState(false)
  const [overrideBusy, setOverrideBusy] = useState<string | null>(null) // infoHash of candidate being overridden
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/requests/${requestId}/grab-results`)
      const json = await res.json() as { results: GrabResultRow | null }
      setData(json.results)
    } finally {
      setLoading(false)
    }
  }, [requestId])

  // Load on first render of the panel
  if (data === undefined && !loading) {
    load()
  }

  async function handleResearch() {
    setResearchBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/requests/${requestId}/grab`, { method: 'POST' })
      const json = await res.json() as { status?: string; error?: string }
      if (json.status === 'grabbed') {
        setMessage('Torrent added to download client.')
      } else if (json.status === 'not_found') {
        setMessage('No matching releases found.')
      } else {
        setMessage(json.error ?? 'Search failed.')
      }
      await load()
    } finally {
      setResearchBusy(false)
    }
  }

  async function handleOverride(candidate: ScoredCandidate) {
    const key = candidate.result.infoHash || candidate.result.title
    setOverrideBusy(key)
    setMessage(null)
    try {
      const res = await fetch(`/api/requests/${requestId}/grab`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magnetUrl: candidate.result.magnetUrl || candidate.result.downloadUrl,
          title: candidate.result.title,
          indexerName: candidate.result.indexerName,
          infoHash: candidate.result.infoHash,
        }),
      })
      const json = await res.json() as { status?: string; error?: string }
      setMessage(json.status === 'grabbed' ? 'Override added to download client.' : (json.error ?? 'Override failed.'))
      await load()
    } finally {
      setOverrideBusy(null)
    }
  }

  if (loading && data === undefined) {
    return (
      <tr>
        <td colSpan={8} className="px-6 py-4 text-sm text-muted-foreground bg-card">
          Loading grab results...
        </td>
      </tr>
    )
  }

  const canSearch = status === 'approved'

  return (
    <tr>
      <td colSpan={8} className="bg-card border-b border-border px-4 pb-4 pt-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Grab Results
            {data && (
              <span className="ml-2 font-normal text-zinc-600">
                — last searched {formatTimestamp(data.searched_at)}, {data.total_found} candidate{data.total_found !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          {canSearch && (
            <button
              onClick={handleResearch}
              disabled={researchBusy || loading}
              className="bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {researchBusy ? 'Searching…' : 'Re-Search'}
            </button>
          )}
        </div>

        {message && (
          <p className="mb-3 text-xs text-zinc-300 bg-zinc-800 rounded px-3 py-2">{message}</p>
        )}

        {!data ? (
          <p className="text-sm text-zinc-600">
            {canSearch
              ? 'No grab has been attempted yet. Click Re-Search to trigger an immediate search.'
              : 'Grab results are only available for approved requests.'}
          </p>
        ) : data.candidates.length === 0 ? (
          <p className="text-sm text-zinc-600">Search ran but found zero results from all indexers.</p>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900">
                  <th className="py-2 pl-3 pr-2 text-zinc-500 font-medium uppercase tracking-wide w-5"></th>
                  <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide">Release</th>
                  <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide">Indexer</th>
                  <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide text-right">Seeds</th>
                  <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide text-right">Size</th>
                  <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide text-right">Score</th>
                  <th className="py-2 pl-2 pr-3 text-zinc-500 font-medium uppercase tracking-wide text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {[...data.candidates]
                  .sort((a, b) => b.score - a.score)
                  .map((c, i) => {
                    const key = c.result.infoHash || c.result.title + i
                    const isOverriding = overrideBusy === (c.result.infoHash || c.result.title)
                    return (
                      <tr
                        key={key}
                        className={`border-b border-zinc-800/60 ${c.selected ? 'bg-blue-900/10' : 'hover:bg-zinc-900/40'}`}
                      >
                        <td className="py-2 pl-3 pr-2 text-center">
                          {c.selected && (
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-400" title="Selected" />
                          )}
                        </td>
                        <td className="py-2 px-2 text-zinc-300 max-w-xs">
                          <span className="line-clamp-2 leading-tight">{c.result.title}</span>
                        </td>
                        <td className="py-2 px-2 text-zinc-500">{c.result.indexerName}</td>
                        <td className="py-2 px-2 text-right text-zinc-400">{c.result.seeders}</td>
                        <td className="py-2 px-2 text-right text-zinc-500">{formatBytes(c.result.size)}</td>
                        <td className="py-2 px-2 text-right">
                          <span className={c.score < 0 ? 'text-red-400' : 'text-zinc-400'}>
                            {c.score < 0 ? 'Rejected' : c.score}
                          </span>
                        </td>
                        <td className="py-2 pl-2 pr-3 text-right">
                          {!c.selected && canSearch && (
                            <button
                              onClick={() => handleOverride(c)}
                              disabled={isOverriding || researchBusy}
                              className="bg-zinc-700 hover:bg-zinc-600 text-white rounded px-2 py-0.5 text-xs transition-colors disabled:opacity-50"
                            >
                              {isOverriding ? '…' : 'Override'}
                            </button>
                          )}
                          {c.selected && (
                            <span className="text-blue-400 text-xs">Selected</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Preferred release panel (pending requests where user pre-selected a torrent)
// ---------------------------------------------------------------------------

function PreferredReleasePanel({
  release,
  retention,
  language,
  requestId,
  mediaType,
  scopeLabel,
  onApproved,
}: {
  release: PreferredRelease
  retention: string
  language: string
  requestId: number
  mediaType: string
  scopeLabel: string | null
  onApproved: (status: RequestStatus) => void
}) {
  const [approvingPick, setApprovingPick] = useState(false)
  const [approvingAuto, setApprovingAuto] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<TorrentSearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [pickedOverride, setPickedOverride] = useState<TorrentSearchResult | null>(null)
  const [submittingOverride, setSubmittingOverride] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const busy = approvingPick || approvingAuto || submittingOverride

  async function approveWithPick() {
    setApprovingPick(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, { method: 'POST' })
      if (res.ok) onApproved('approved')
      else setMessage('Approval failed.')
    } finally { setApprovingPick(false) }
  }

  async function approveAutoSearch() {
    setApprovingAuto(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignorePreferred: true }),
      })
      if (res.ok) onApproved('approved')
      else setMessage('Approval failed.')
    } finally { setApprovingAuto(false) }
  }

  async function runSearch() {
    if (!searchQuery.trim()) return
    setSearchLoading(true)
    setSearchError(null)
    setPickedOverride(null)
    try {
      const params = new URLSearchParams({ q: searchQuery.trim(), type: mediaType })
      const res = await fetch(`/api/torrent-search?${params}`)
      if (!res.ok) throw new Error(`Search failed (${res.status})`)
      const data = await res.json() as { results: TorrentSearchResult[] }
      setSearchResults(data.results.sort((a, b) => b.seeders - a.seeders))
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Search error')
    } finally {
      setSearchLoading(false)
    }
  }

  async function approveWithOverride() {
    if (!pickedOverride) return
    setSubmittingOverride(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          overrideRelease: {
            magnetUrl: pickedOverride.magnetUrl,
            downloadUrl: pickedOverride.downloadUrl,
            infoHash: pickedOverride.infoHash,
            indexerName: pickedOverride.indexerName,
            releaseTitle: pickedOverride.title,
            seeders: pickedOverride.seeders,
            size: pickedOverride.size,
          },
        }),
      })
      if (res.ok) onApproved('approved')
      else setMessage('Override approval failed.')
    } finally { setSubmittingOverride(false) }
  }

  return (
    <tr>
      <td colSpan={8} className="bg-card border-b border-border px-4 pb-4 pt-3">
        <div className="mb-2 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            User&apos;s Selected Release
          </span>
          <span className="text-[10px] bg-amber-900/30 text-amber-400 rounded px-1.5 py-0.5">
            {retention === 'quick' ? '48hr retention' : 'Long-term'}
          </span>
          {language && language !== 'any' && (
            <span className="text-[10px] bg-zinc-800 text-zinc-400 rounded px-1.5 py-0.5 uppercase">
              {language} only
            </span>
          )}
          {scopeLabel && (
            <span className="text-[10px] bg-blue-900/30 text-blue-400 rounded px-1.5 py-0.5">
              {scopeLabel}
            </span>
          )}
        </div>

        <div className="overflow-x-auto rounded border border-zinc-800 mb-3">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="py-2 pl-3 pr-2 text-zinc-500 font-medium uppercase tracking-wide">Release</th>
                <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide">Indexer</th>
                <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide text-right">Seeds</th>
                <th className="py-2 pl-2 pr-3 text-zinc-500 font-medium uppercase tracking-wide text-right">Size</th>
              </tr>
            </thead>
            <tbody>
              <tr className="bg-blue-900/10 border-b border-zinc-800/60">
                <td className="py-2 pl-3 pr-2 text-zinc-300 max-w-xs">
                  <span className="line-clamp-2 leading-tight">{release.releaseTitle}</span>
                  {release.magnetUrl && (
                    <span className="ml-1 text-[10px] text-zinc-600">[magnet]</span>
                  )}
                </td>
                <td className="py-2 px-2 text-zinc-500">{release.indexerName}</td>
                <td className="py-2 px-2 text-right text-zinc-400">{release.seeders}</td>
                <td className="py-2 pl-2 pr-3 text-right text-zinc-500">{formatBytes(release.size)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {message && (
          <p className="mb-3 text-xs bg-zinc-800 rounded px-3 py-2 text-zinc-300">{message}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => void approveWithPick()}
            disabled={busy}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {approvingPick ? 'Approving…' : 'Approve (use pick)'}
          </button>
          <button
            onClick={() => void approveAutoSearch()}
            disabled={busy}
            className="bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {approvingAuto ? 'Approving…' : 'Approve (auto-search)'}
          </button>
          <button
            onClick={() => { setShowSearch(s => !s); setSearchResults([]); setPickedOverride(null) }}
            disabled={busy}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {showSearch ? 'Hide search' : 'Pick different release'}
          </button>
        </div>

        {showSearch && (
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <form
              onSubmit={e => { e.preventDefault(); void runSearch() }}
              className="flex gap-2 mb-3"
            >
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search for a different release…"
                className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500"
              />
              <button
                type="submit"
                disabled={searchLoading}
                className="rounded bg-zinc-700 hover:bg-zinc-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 transition-colors"
              >
                {searchLoading ? 'Searching…' : 'Search'}
              </button>
            </form>

            {searchError && (
              <p className="text-xs text-red-400 mb-2">{searchError}</p>
            )}

            {searchResults.length > 0 && (
              <>
                <div className="overflow-x-auto rounded border border-zinc-800 mb-3">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900">
                        <th className="py-2 pl-3 pr-2 w-5"></th>
                        <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide">Release</th>
                        <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide hidden sm:table-cell">Indexer</th>
                        <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide text-right">Seeds</th>
                        <th className="py-2 px-2 text-zinc-500 font-medium uppercase tracking-wide text-right hidden md:table-cell">Size</th>
                        <th className="py-2 pl-2 pr-3 text-zinc-500 font-medium uppercase tracking-wide text-right">Pick</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchResults.slice(0, 15).map((r, i) => {
                        const isSelected = pickedOverride === r
                        return (
                          <tr
                            key={r.infoHash || r.title + i}
                            onClick={() => setPickedOverride(isSelected ? null : r)}
                            className={`border-b border-zinc-800/60 cursor-pointer transition-colors ${
                              isSelected ? 'bg-blue-900/20' : 'hover:bg-zinc-900/40'
                            }`}
                          >
                            <td className="py-2 pl-3 pr-2 text-center">
                              <div className={`h-3 w-3 rounded-full border-2 inline-flex items-center justify-center ${
                                isSelected ? 'border-blue-400 bg-blue-400' : 'border-zinc-600'
                              }`}>
                                {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                              </div>
                            </td>
                            <td className="py-2 px-2 text-zinc-300 max-w-xs">
                              <span className="line-clamp-2 leading-tight">{r.title}</span>
                            </td>
                            <td className="py-2 px-2 text-zinc-500 hidden sm:table-cell">{r.indexerName}</td>
                            <td className="py-2 px-2 text-right text-zinc-400">{r.seeders}</td>
                            <td className="py-2 px-2 text-right text-zinc-500 hidden md:table-cell">{formatBytes(r.size)}</td>
                            <td className="py-2 pl-2 pr-3 text-right">
                              <button
                                onClick={e => { e.stopPropagation(); setPickedOverride(isSelected ? null : r) }}
                                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                                  isSelected ? 'bg-blue-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
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
                </div>
                {pickedOverride && (
                  <button
                    onClick={() => void approveWithOverride()}
                    disabled={submittingOverride}
                    className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {submittingOverride
                      ? 'Approving…'
                      : `Approve with "${pickedOverride.title.slice(0, 40)}${pickedOverride.title.length > 40 ? '…' : ''}"`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Quick slot limits (mirrors auto-approve.ts) + per-user slot computation
// ---------------------------------------------------------------------------

const QUICK_LIMITS = { movie: 1, tv: 2 } as const

function computeUserSlots(
  requests: NativeRequestWithUser[],
  localStatuses: Record<number, RequestStatus>
): Record<string, { movie: number; tv: number }> {
  const result: Record<string, { movie: number; tv: number }> = {}
  for (const r of requests) {
    const effectiveStatus = localStatuses[r.id] ?? r.status
    if (
      r.request_type === 'quick' &&
      (effectiveStatus === 'approved' || effectiveStatus === 'available')
    ) {
      if (!result[r.user_id]) result[r.user_id] = { movie: 0, tv: 0 }
      if (r.media_type === 'movie') result[r.user_id].movie++
      else if (r.media_type === 'tv') result[r.user_id].tv++
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

interface RowProps {
  req: NativeRequestWithUser
  localStatus: RequestStatus | null
  expanded: boolean
  onToggleExpand: (id: number) => void
  onApprove: (id: number) => void
  onDecline: (id: number) => void
  onDelete: (id: number) => void
  onApproved: (id: number, status: RequestStatus) => void
  busy: boolean
  userSlots: { movie: number; tv: number } | undefined
}

function RequestRow({ req, localStatus, expanded, onToggleExpand, onApprove, onDecline, onDelete, onApproved, busy, userSlots }: RowProps) {
  const effectiveStatus: RequestStatus = localStatus ?? req.status
  const badge = STATUS_BADGE[effectiveStatus]

  const preferredRelease: PreferredRelease | null = (() => {
    if (!req.preferred_release) return null
    try { return JSON.parse(req.preferred_release) as PreferredRelease } catch { return null }
  })()

  // Pending rows with a pre-selected release are expandable (to show the pick)
  // Approved/available rows are expandable (to show grab results)
  const canExpand = effectiveStatus === 'approved' || effectiveStatus === 'available'
    || (effectiveStatus === 'pending' && preferredRelease !== null)

  return (
    <>
      <tr
        className={`border-b border-zinc-800 transition-colors ${canExpand ? 'cursor-pointer hover:bg-zinc-900/50' : 'hover:bg-zinc-900/50'} ${expanded ? 'bg-zinc-900/30' : ''}`}
        onClick={canExpand ? () => onToggleExpand(req.id) : undefined}
      >
        {/* Poster */}
        <td className="py-3 pl-4 pr-3 w-14">
          {req.poster_path ? (
            <img
              src={tmdbImageUrl(req.poster_path, 'w92')}
              alt={req.title}
              className="h-16 w-11 rounded object-cover"
            />
          ) : (
            <div className="h-16 w-11 rounded bg-zinc-800 flex items-center justify-center text-zinc-600 text-[10px] text-center px-1">
              No image
            </div>
          )}
        </td>

        {/* Title + Year + Scope */}
        <td className="py-3 px-3">
          <p className="font-medium text-white leading-tight">{req.title}</p>
          {req.year && <p className="text-xs text-zinc-500 mt-0.5">{req.year}</p>}
          {(() => { const scope = formatScope(req); return scope ? <p className="text-xs text-blue-400/80 mt-0.5">{scope}</p> : null })()}
          {canExpand && !preferredRelease && (
            <p className="text-xs text-zinc-600 mt-0.5">{expanded ? '▲ hide results' : '▼ show results'}</p>
          )}
          {preferredRelease && effectiveStatus === 'pending' && (
            <p className="text-xs text-amber-400/70 mt-0.5">{expanded ? '▲ hide pick' : '▼ view pick'}</p>
          )}
        </td>

        {/* Type */}
        <td className="py-3 px-3 text-sm text-zinc-400 hidden sm:table-cell">
          {req.media_type === 'movie' ? 'Movie' : 'TV Show'}
        </td>

        {/* Requester + quick slot usage */}
        <td className="py-3 px-3 text-sm text-zinc-400 hidden md:table-cell">
          <div className="flex flex-col gap-0.5">
            <span>{req.username}</span>
            {userSlots && (userSlots.movie > 0 || userSlots.tv > 0) && (
              <div className="flex gap-1 flex-wrap mt-0.5">
                {userSlots.movie > 0 && (
                  <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${
                    userSlots.movie >= QUICK_LIMITS.movie
                      ? 'bg-red-900/50 text-red-400'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    Movie {userSlots.movie}/{QUICK_LIMITS.movie}
                  </span>
                )}
                {userSlots.tv > 0 && (
                  <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium ${
                    userSlots.tv >= QUICK_LIMITS.tv
                      ? 'bg-red-900/50 text-red-400'
                      : 'bg-amber-900/30 text-amber-400'
                  }`}>
                    TV {userSlots.tv}/{QUICK_LIMITS.tv}
                  </span>
                )}
              </div>
            )}
          </div>
        </td>

        {/* Date */}
        <td className="py-3 px-3 text-sm text-zinc-500 hidden lg:table-cell whitespace-nowrap">
          {formatTimestamp(req.created_at)}
        </td>

        {/* Status badge */}
        <td className="py-3 px-3">
          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
            {badge.label}
          </span>
        </td>

        {/* Retention + Method */}
        <td className="py-3 px-3 hidden sm:table-cell">
          <div className="flex flex-col gap-0.5">
            <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
              req.request_type === 'quick'
                ? 'bg-amber-900/40 text-amber-300'
                : 'bg-blue-900/30 text-blue-400'
            }`}>
              {req.request_type === 'quick' ? '48hr' : 'Long-term'}
            </span>
            <span className="text-[10px] text-zinc-500">
              {req.request_method === 'interactive' ? 'Interactive pick' : 'Auto-pick'}
            </span>
            {req.language && req.language !== 'any' && (
              <span className="text-[10px] text-zinc-600 uppercase">{req.language}</span>
            )}
          </div>
        </td>

        {/* Actions */}
        <td className="py-3 pl-3 pr-4 text-right" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {effectiveStatus === 'pending' && (
              <>
                <button
                  onClick={() => onApprove(req.id)}
                  disabled={busy}
                  className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  onClick={() => onDecline(req.id)}
                  disabled={busy}
                  className="bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
                >
                  Decline
                </button>
              </>
            )}
            <button
              onClick={() => onDelete(req.id)}
              disabled={busy}
              className="bg-red-900/40 hover:bg-red-900/70 text-red-400 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>

      {expanded && effectiveStatus === 'pending' && preferredRelease && (
        <PreferredReleasePanel
          release={preferredRelease}
          retention={req.request_type}
          language={req.language ?? 'any'}
          requestId={req.id}
          mediaType={req.media_type}
          scopeLabel={formatScope(req)}
          onApproved={(status) => onApproved(req.id, status)}
        />
      )}
      {expanded && (effectiveStatus === 'approved' || effectiveStatus === 'available') && (
        <GrabResultsPanel requestId={req.id} status={effectiveStatus} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

interface AdminRequestsClientProps {
  initialRequests: NativeRequestWithUser[]
}

export default function AdminRequestsClient({ initialRequests }: AdminRequestsClientProps) {
  const [requests, setRequests] = useState<NativeRequestWithUser[]>(initialRequests)
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [localStatuses, setLocalStatuses] = useState<Record<number, RequestStatus>>({})
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [expandedId, setExpandedId] = useState<number | null>(null)

  function setBusy(id: number, on: boolean) {
    setBusyIds((prev) => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  function setLocalStatus(id: number, status: RequestStatus) {
    setLocalStatuses((prev) => ({ ...prev, [id]: status }))
  }

  function handleToggleExpand(id: number) {
    setExpandedId(prev => prev === id ? null : id)
  }

  async function handleApprove(id: number) {
    setBusy(id, true)
    try {
      const res = await fetch(`/api/requests/${id}/approve`, { method: 'POST' })
      if (res.ok) {
        setLocalStatus(id, 'approved')
      }
    } finally {
      setBusy(id, false)
    }
  }

  async function handleDecline(id: number) {
    if (!confirm('Decline this request?')) return
    setBusy(id, true)
    try {
      const res = await fetch(`/api/requests/${id}/decline`, { method: 'POST' })
      if (res.ok) {
        setLocalStatus(id, 'declined')
      }
    } finally {
      setBusy(id, false)
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Delete this request? This cannot be undone.')) return
    setBusy(id, true)
    try {
      const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        setRequests((prev) => prev.filter((r) => r.id !== id))
        setLocalStatuses((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        if (expandedId === id) setExpandedId(null)
      }
    } finally {
      setBusy(id, false)
    }
  }

  const visibleRequests = requests.filter((req) => {
    if (activeFilter === 'all') return true
    const effectiveStatus = localStatuses[req.id] ?? req.status
    return effectiveStatus === activeFilter
  })

  // Per-user quick slot counts, updated reactively as requests are approved/deleted.
  const userSlotsMap = computeUserSlots(requests, localStatuses)

  return (
    <>
      {/* Filter tabs */}
      <div className="mb-6 flex gap-1 flex-wrap">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveFilter(tab.value)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeFilter === tab.value
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {visibleRequests.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500">
          No requests found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="py-3 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-zinc-500 w-14">
                  Poster
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Title
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden sm:table-cell">
                  Media
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden md:table-cell">
                  Requested By
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden lg:table-cell">
                  Date
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Status
                </th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden sm:table-cell">
                  Req. Type
                </th>
                <th className="py-3 pl-3 pr-4 text-xs font-medium uppercase tracking-wide text-zinc-500 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((req) => (
                <RequestRow
                  key={req.id}
                  req={req}
                  localStatus={localStatuses[req.id] ?? null}
                  expanded={expandedId === req.id}
                  onToggleExpand={handleToggleExpand}
                  onApprove={handleApprove}
                  onDecline={handleDecline}
                  onDelete={handleDelete}
                  onApproved={(id, status) => setLocalStatus(id, status)}
                  busy={busyIds.has(req.id)}
                  userSlots={userSlotsMap[req.user_id]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
