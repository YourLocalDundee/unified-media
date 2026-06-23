'use client'

import Image from 'next/image'
import { useState, useEffect, useCallback } from 'react'
import { formatDateShort } from '@/lib/utils'
import type { NativeRequestWithUser, RequestStatus, PreferredRelease } from '@/lib/requests/types'
import type { ScoredCandidate, GrabResultRow } from '@/lib/automation/grab-results'
import type { TorrentSearchResult } from '@/app/api/torrent-search/route'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RequestsTableProps {
  requests: NativeRequestWithUser[]
  allRequests: NativeRequestWithUser[]  // unfiltered, for slot counting
  isAdmin: boolean
  currentUserId: string
}

// ---------------------------------------------------------------------------
// Quick slot limits (mirrors auto-approve.ts)
// ---------------------------------------------------------------------------

const QUICK_LIMITS = { movie: 1, tv: 2 } as const

// ---------------------------------------------------------------------------
// Status badge record
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<RequestStatus, { label: string; className: string }> = {
  pending: { label: 'Pending', className: 'bg-yellow-600/30 text-yellow-300' },
  approved: { label: 'Approved', className: 'bg-blue-600/30 text-blue-300' },
  declined: { label: 'Declined', className: 'bg-red-600/30 text-red-300' },
  available: { label: 'Available', className: 'bg-green-600/30 text-green-300' },
  expired: { label: 'Expired', className: 'bg-zinc-600/30 text-zinc-400' },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmdbImageUrl(path: string, size = 'w92') {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

// Use shared formatDateShort from utils (A20-06)
const formatDate = formatDateShort

function formatBytes(bytes: number) {
  if (bytes === 0) return '—'
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatSpeed(bytesPerSec: number): string {
  return (bytesPerSec / 1048576).toFixed(1) + ' MB/s'
}

function formatEta(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

function friendlyState(state: string): string {
  const lower = state.toLowerCase()
  if (lower.includes('upload') || lower === 'seeding') return 'Complete'
  if (lower === 'downloading' || lower === 'forceddl') return 'Downloading'
  if (lower.includes('stalled')) return 'Stalled'
  if (lower.includes('queue') || lower === 'queued') return 'Queued'
  if (lower.includes('check')) return 'Checking'
  if (lower.includes('paused')) return 'Paused'
  if (lower === 'imported') return 'Imported'
  if (lower === 'error') return 'Error'
  return state
}

function isComplete(progress: number | null, state: string | null): boolean {
  if (progress === 1) return true
  if (state) {
    const lower = state.toLowerCase()
    if (lower.includes('upload') || lower === 'seeding' || lower === 'imported') return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Scope badge helper
// ---------------------------------------------------------------------------

// SQLite returns snake_case column names — the NativeRequest type uses camelCase
// but runtime keys from the DB (via r.*) are scope_type / scope_seasons / scope_episodes.
// We read both spellings so the helper works regardless of whether the data came
// from a direct DB query or a hand-constructed object.
type AnyNativeRequest = NativeRequestWithUser & {
  scope_type?: string | null
  scope_seasons?: string | null
  scope_episodes?: string | null
  scope_label?: string | null
}

function formatScope(req: AnyNativeRequest): string | null {
  if (req.media_type === 'movie') return null

  // Accept snake_case (from DB) or camelCase (from constructed objects)
  const scopeType = (req.scope_type ?? req.scopeType) as string | null | undefined
  if (!scopeType || scopeType === 'movie') return null

  // Arc grabs (Bug 7) store a human label ("Impel Down") alongside an episode list — show it
  // instead of the raw episode range so the user sees the arc they actually picked.
  const label = (req.scope_label ?? null) as string | null
  if (label) return label

  if (scopeType === 'full') return 'Full Series'

  if (scopeType === 'seasons') {
    const raw = (req.scope_seasons ?? req.scopeSeasons) as string | number[] | null | undefined
    let seasons: number[] = []
    if (Array.isArray(raw)) {
      seasons = raw as number[]
    } else if (typeof raw === 'string') {
      try { seasons = JSON.parse(raw) as number[] } catch { seasons = [] }
    }
    if (seasons.length === 0) return null
    if (seasons.length === 1) return `Season ${seasons[0]}`
    return `Seasons ${seasons.join(', ')}`
  }

  if (scopeType === 'episodes') {
    const raw = (req.scope_episodes ?? req.scopeEpisodes) as string | Array<{s:number;e:number}> | null | undefined
    let episodes: Array<{s: number; e: number}> = []
    if (Array.isArray(raw)) {
      episodes = raw as Array<{s: number; e: number}>
    } else if (typeof raw === 'string') {
      try { episodes = JSON.parse(raw) as Array<{s: number; e: number}> } catch { episodes = [] }
    }
    if (episodes.length === 0) return null
    if (episodes.length === 1) {
      const { s, e } = episodes[0]
      return `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`
    }
    // Group by season; within each season check if episodes are consecutive
    const bySeason = new Map<number, number[]>()
    for (const { s, e } of episodes) {
      if (!bySeason.has(s)) bySeason.set(s, [])
      bySeason.get(s)!.push(e)
    }
    const parts: string[] = []
    for (const [s, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
      const sorted = [...eps].sort((a, b) => a - b)
      const pad = (n: number) => String(n).padStart(2, '0')
      const sp = `S${pad(s)}`
      // Consecutive if every step is exactly 1
      const consecutive = sorted.every((e, i) => i === 0 || e === sorted[i - 1] + 1)
      if (consecutive && sorted.length > 1) {
        parts.push(`${sp}E${pad(sorted[0])}–E${pad(sorted[sorted.length - 1])}`)
      } else {
        for (const e of sorted) parts.push(`${sp}E${pad(e)}`)
      }
    }
    return parts.join(', ')
  }

  return null
}

// ---------------------------------------------------------------------------
// Per-user slot computation
// ---------------------------------------------------------------------------

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
// SlotMeter sub-component
// ---------------------------------------------------------------------------

function SlotMeter({ label, used, max }: { label: string; used: number; max: number }) {
  const full = used >= max
  const pct = Math.min((used / max) * 100, 100)
  return (
    <div className="flex-1 rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-3 min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 mb-1.5">{label}</p>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${full ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-sm font-bold tabular-nums ${full ? 'text-red-400' : 'text-zinc-300'}`}>
          {used}/{max}
        </span>
      </div>
      {full && (
        <p className="text-[10px] text-red-400 mt-1">Slot full — delete a request to free it</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DownloadProgress sub-component
// ---------------------------------------------------------------------------

interface ProgressData {
  grabbed: boolean
  hash: string | null
  progress: number | null
  state: string | null
  dlspeed: number | null
  eta: number | null
  indexer: string | null
  releaseTitle: string | null
}

function DownloadProgress({ requestId }: { requestId: number }) {
  const [data, setData] = useState<ProgressData | null>(null)

  useEffect(() => {
    // A6-18: self-scheduling poll loop instead of a fixed setInterval so we can
    // (1) STOP once the item reaches a terminal state (complete/imported) and
    // (2) apply a modest backoff that grows the interval up to a cap while the
    // download is still in progress, easing load on the qBit proxy.
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const BASE_INTERVAL = 5000
    const MAX_INTERVAL = 30000
    let interval = BASE_INTERVAL

    async function poll() {
      let terminal = false
      try {
        const res = await fetch(`/api/requests/${requestId}/progress`)
        if (res.ok) {
          const json: ProgressData = await res.json()
          if (!cancelled) setData(json)
          // Stop polling once the download is done/imported — nothing changes after.
          terminal = isComplete(json.progress, json.state)
        }
      } catch {
        // network error — silently ignore, will retry on the next tick
      }
      if (cancelled || terminal) return
      // A6-18: gentle backoff (1.5x per tick, capped) to reduce polling pressure.
      interval = Math.min(Math.round(interval * 1.5), MAX_INTERVAL)
      timer = setTimeout(poll, interval)
    }

    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [requestId])

  if (!data) {
    return (
      <p className="text-xs text-zinc-500 mt-1 animate-pulse">Loading…</p>
    )
  }

  if (!data.grabbed) {
    return (
      <p className="text-xs text-zinc-500 mt-1">Searching…</p>
    )
  }

  // Torrent was grabbed but qBittorrent has no info yet (just submitted or already imported)
  if (data.progress === null && data.state === null) {
    return (
      <p className="text-xs text-zinc-400 mt-1">Grabbed — awaiting queue</p>
    )
  }

  if (isComplete(data.progress, data.state)) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="h-1 flex-1 rounded-full bg-zinc-700">
          <div className="h-full w-full rounded-full bg-green-500" />
        </div>
        <span className="text-xs font-medium text-green-400 whitespace-nowrap">Complete</span>
      </div>
    )
  }

  const pct = data.progress != null ? Math.round(data.progress * 100) : 0
  const stateLabel = data.state ? friendlyState(data.state) : 'Unknown'
  const isStalled = data.state?.toLowerCase().includes('stalled') ?? false

  return (
    <div className="mt-1.5 space-y-1">
      {/* Progress bar */}
      <div className="flex items-center gap-1.5">
        <div className="h-1 flex-1 rounded-full bg-zinc-700">
          <div
            className={`h-full rounded-full transition-all duration-500 ${isStalled ? 'bg-yellow-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-zinc-400 tabular-nums w-8 text-right">{pct}%</span>
      </div>
      {/* State + speed + ETA */}
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <span className={isStalled ? 'text-yellow-500' : 'text-zinc-400'}>{stateLabel}</span>
        {data.dlspeed != null && data.dlspeed > 0 && (
          <span className="text-blue-400">{formatSpeed(data.dlspeed)}</span>
        )}
        {data.eta != null && (
          <span className="text-zinc-500">ETA {formatEta(data.eta)}</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// GrabResultsPanel sub-component
// ---------------------------------------------------------------------------

interface GrabResultsPanelProps {
  requestId: number
  status: RequestStatus
  adminMode: boolean
}

function GrabResultsPanel({ requestId, status, adminMode }: GrabResultsPanelProps) {
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

  // A6-18: load on mount via an effect instead of calling load() in the render
  // body (which fired a fetch + setState during render). Re-runs if the panel is
  // re-keyed to a different request. Deferred a tick so load()'s loading setState
  // runs outside the effect's synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [load])

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
        <td colSpan={9} className="px-6 py-4 text-sm text-muted-foreground bg-card">
          Loading grab results...
        </td>
      </tr>
    )
  }

  // Bug 1: an admin can re-search / override regardless of request status (the server route is
  // requireAdmin-gated). Non-admins keep the original approved-only behavior.
  const canSearch = adminMode || status === 'approved'

  return (
    <tr>
      <td colSpan={9} className="bg-card border-b border-border px-4 pb-4 pt-3">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Grab Results
            {data && (
              <span className="ml-2 font-normal text-zinc-600">
                — last searched {formatDate(data.searched_at)}, {data.total_found} candidate{data.total_found !== 1 ? 's' : ''}
              </span>
            )}
          </span>
          {canSearch && (
            <button
              onClick={() => void handleResearch()}
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
                        <td className="py-2 px-2 text-right">
                          {c.result.seeders > 0
                            ? <span className="text-zinc-400">{c.result.seeders}</span>
                            : <span className="text-red-400" title="0 seeds — dead, won't download">0 ⚠</span>}
                        </td>
                        <td className="py-2 px-2 text-right text-zinc-500">{formatBytes(c.result.size)}</td>
                        <td className="py-2 px-2 text-right">
                          {/* Score is the soft auto-pick rank; releases are de-prioritized, never
                              removed — so always show the number, never a hard "Rejected" label. */}
                          <span className={c.score < 0 ? 'text-zinc-500' : 'text-zinc-300'}>{Math.round(c.score)}</span>
                        </td>
                        <td className="py-2 pl-2 pr-3 text-right">
                          {c.selected ? (
                            <span className="text-blue-400 text-xs">Selected</span>
                          ) : canSearch ? (
                            <button
                              onClick={() => void handleOverride(c)}
                              disabled={isOverriding || researchBusy}
                              className="bg-zinc-700 hover:bg-zinc-600 text-white rounded px-2 py-0.5 text-xs transition-colors disabled:opacity-50"
                            >
                              {isOverriding ? '…' : 'Grab'}
                            </button>
                          ) : null}
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
// PreferredReleasePanel sub-component
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
      <td colSpan={9} className="bg-card border-b border-border px-4 pb-4 pt-3">
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
// RequestRow
// ---------------------------------------------------------------------------

interface RowProps {
  request: NativeRequestWithUser
  isAdmin: boolean
  isOwner: boolean
  adminMode: boolean
  userSlots: { movie: number; tv: number } | undefined
  localStatus: RequestStatus | null
  expanded: boolean
  onToggleExpand: (id: number) => void
  onUpdate: (id: number, status: RequestStatus) => void
  onDelete: (id: number) => void
  onApprove: (id: number) => void
  onDecline: (id: number) => void
  onApproved: (id: number, status: RequestStatus) => void
  busy: boolean
}

function RequestRow({
  request,
  isAdmin,
  isOwner,
  adminMode,
  userSlots,
  localStatus,
  expanded,
  onToggleExpand,
  onUpdate: _onUpdate, // received from parent; row uses onApprove/onDecline/onApproved directly
  onDelete,
  onApprove,
  onDecline,
  onApproved,
  busy,
}: RowProps) {
  const effectiveStatus: RequestStatus = localStatus ?? request.status
  const badge = STATUS_BADGE[effectiveStatus]

  const preferredRelease: PreferredRelease | null = (() => {
    if (!request.preferred_release) return null
    try { return JSON.parse(request.preferred_release) as PreferredRelease } catch { return null }
  })()

  const scopeStr = formatScope(request as AnyNativeRequest)

  const canExpand = adminMode && (
    effectiveStatus === 'approved' ||
    effectiveStatus === 'available' ||
    (effectiveStatus === 'pending' && preferredRelease !== null)
  )

  return (
    <>
      <tr
        className={`border-b border-zinc-800 transition-colors ${canExpand ? 'cursor-pointer hover:bg-zinc-900/50' : 'hover:bg-zinc-900/50'} ${expanded ? 'bg-zinc-900/30' : ''}`}
        onClick={canExpand ? () => onToggleExpand(request.id) : undefined}
      >
        {/* Poster */}
        <td className="py-3 pl-4 pr-3 w-14">
          {request.poster_path ? (
            <Image
              src={tmdbImageUrl(request.poster_path, 'w92')}
              alt={request.title}
              width={44}
              height={64}
              className="h-16 w-11 rounded object-cover"
            />
          ) : (
            <div className="h-16 w-11 rounded bg-zinc-800 flex items-center justify-center text-zinc-600 text-[10px] text-center px-1">
              No image
            </div>
          )}
        </td>

        {/* Title */}
        <td className="py-3 px-3">
          <p className="font-medium text-white leading-tight">{request.title}</p>
          {request.year && (
            <p className="text-xs text-zinc-500 mt-0.5">{request.year}</p>
          )}
          {scopeStr && (
            <span className="text-[10px] text-zinc-500 font-mono">{scopeStr}</span>
          )}
          {adminMode && (
            <p className="text-[10px] text-zinc-500 mt-0.5">by {request.username}</p>
          )}
          {adminMode && canExpand && (
            <p className="text-xs text-zinc-600 mt-0.5">
              {expanded
                ? (effectiveStatus === 'pending' && preferredRelease ? '▲ hide pick' : '▲ hide results')
                : (effectiveStatus === 'pending' && preferredRelease ? '▼ view pick' : '▼ show results')}
            </p>
          )}
          {!adminMode && effectiveStatus === 'approved' && (
            <DownloadProgress requestId={request.id} />
          )}
        </td>

        {/* Type */}
        <td className="py-3 px-3 hidden sm:table-cell">
          <span className="text-sm text-zinc-400">
            {request.media_type === 'movie' ? 'Movie' : 'TV Show'}
          </span>
        </td>

        {/* Status badge */}
        <td className="py-3 px-3">
          <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${badge.className}`}>
            {badge.label}
          </span>
        </td>

        {/* Req. Type */}
        <td className="py-3 px-3 hidden sm:table-cell">
          <div className="flex flex-col gap-0.5">
            <span className={`inline-flex rounded px-2 py-0.5 text-xs font-semibold ${
              request.request_type === 'quick'
                ? 'bg-amber-900/40 text-amber-300'
                : 'bg-blue-900/30 text-blue-400'
            }`}>
              {request.request_type === 'quick' ? 'Quick (48h)' : 'Long-term'}
            </span>
            {adminMode && (
              <>
                <span className="text-[10px] text-zinc-500">
                  {request.request_method === 'interactive' ? 'Interactive pick' : 'Auto-pick'}
                </span>
                {request.language && request.language !== 'any' && (
                  <span className="text-[10px] text-zinc-600 uppercase">{request.language}</span>
                )}
              </>
            )}
          </div>
        </td>

        {/* Date */}
        <td className="py-3 px-3 text-sm text-zinc-500 hidden lg:table-cell whitespace-nowrap">
          {formatDate(request.created_at)}
        </td>

        {/* Actions */}
        <td className="py-3 pl-3 pr-4 text-right" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-2">
            {adminMode && effectiveStatus === 'pending' && (
              <>
                <button
                  onClick={() => onApprove(request.id)}
                  disabled={busy}
                  className="rounded bg-blue-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? '…' : 'Approve'}
                </button>
                <button
                  onClick={() => onDecline(request.id)}
                  disabled={busy}
                  className="rounded bg-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-600 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? '…' : 'Decline'}
                </button>
              </>
            )}
            {(isOwner || isAdmin) && (
              <button
                onClick={() => onDelete(request.id)}
                disabled={busy}
                className="rounded bg-red-600/20 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-600/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                  request.request_type === 'quick' &&
                  (effectiveStatus === 'approved' || effectiveStatus === 'available')
                    ? 'Delete to free quick slot'
                    : 'Delete request'
                }
              >
                {busy ? '…' : 'Delete'}
              </button>
            )}
          </div>
        </td>
      </tr>

      {expanded && adminMode && effectiveStatus === 'pending' && preferredRelease && (
        <PreferredReleasePanel
          release={preferredRelease}
          retention={request.request_type}
          language={request.language ?? 'any'}
          requestId={request.id}
          mediaType={request.media_type}
          scopeLabel={scopeStr}
          onApproved={(status) => onApproved(request.id, status)}
        />
      )}
      {expanded && adminMode && (effectiveStatus === 'approved' || effectiveStatus === 'available') && (
        <GrabResultsPanel requestId={request.id} status={effectiveStatus} adminMode={adminMode} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// RequestsTable (main export)
// ---------------------------------------------------------------------------

export default function RequestsTable({
  requests: initialRequests,
  allRequests: initialAllRequests,
  isAdmin,
  currentUserId,
}: RequestsTableProps) {
  const [rows, setRows] = useState<NativeRequestWithUser[]>(initialRequests)
  const [allRows, setAllRows] = useState<NativeRequestWithUser[]>(initialAllRequests)
  const [adminMode, setAdminMode] = useState(false)
  const [localStatuses, setLocalStatuses] = useState<Record<number, RequestStatus>>({})
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set())
  const [expandedId, setExpandedId] = useState<number | null>(null)

  // Restore admin mode from localStorage on mount. Deferred a tick so the restore
  // setState runs outside the effect's synchronous commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!isAdmin) return
    const id = setTimeout(() => {
      const stored = localStorage.getItem('unified-requests-admin-mode')
      if (stored === 'true') setAdminMode(true)
    }, 0)
    return () => clearTimeout(id)
  }, [isAdmin])

  function toggleAdminMode() {
    setAdminMode(prev => {
      const next = !prev
      localStorage.setItem('unified-requests-admin-mode', String(next))
      if (!next) setExpandedId(null)
      return next
    })
  }

  function setLocalStatus(id: number, status: RequestStatus) {
    setLocalStatuses(prev => ({ ...prev, [id]: status }))
  }

  function setBusy(id: number, on: boolean) {
    setBusyIds(prev => {
      const next = new Set(prev)
      on ? next.add(id) : next.delete(id)
      return next
    })
  }

  function handleUpdate(id: number, status: RequestStatus) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    setAllRows(prev => prev.map(r => r.id === id ? { ...r, status } : r))
    setLocalStatus(id, status)
  }

  async function handleDelete(id: number) {
    if (adminMode) {
      if (!confirm('Delete this request? This cannot be undone.')) return
      setBusy(id, true)
      try {
        const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' })
        if (res.ok || res.status === 204) {
          setRows(prev => prev.filter(r => r.id !== id))
          setAllRows(prev => prev.filter(r => r.id !== id))
          setLocalStatuses(prev => {
            const next = { ...prev }
            delete next[id]
            return next
          })
          if (expandedId === id) setExpandedId(null)
        }
      } finally {
        setBusy(id, false)
      }
    } else {
      // Non-admin: optimistic delete, no confirm, no revert on failure
      setRows(prev => prev.filter(r => r.id !== id))
      setAllRows(prev => prev.filter(r => r.id !== id))
      fetch(`/api/requests/${id}`, { method: 'DELETE' }).catch(() => {
        // silently ignore network errors
      })
    }
  }

  async function handleApprove(id: number) {
    setBusy(id, true)
    try {
      const res = await fetch(`/api/requests/${id}/approve`, { method: 'POST' })
      if (res.ok) {
        handleUpdate(id, 'approved')
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
        handleUpdate(id, 'declined')
      }
    } finally {
      setBusy(id, false)
    }
  }

  function handleToggleExpand(id: number) {
    setExpandedId(prev => prev === id ? null : id)
  }

  // Derived values
  const activeQuick = allRows.filter(r =>
    r.user_id === currentUserId &&
    r.request_type === 'quick' &&
    (r.status === 'approved' || r.status === 'available')
  )
  const movieSlotsUsed = activeQuick.filter(r => r.media_type === 'movie').length
  const tvSlotsUsed = activeQuick.filter(r => r.media_type === 'tv').length
  const userSlotsMap = (adminMode && isAdmin) ? computeUserSlots(allRows, localStatuses) : {}
  const showSlotMeter = !adminMode && allRows.some(r =>
    r.user_id === currentUserId && r.request_type === 'quick'
  )

  return (
    <>
      {/* Controls bar: slot meter + admin toggle */}
      <div className="mb-4 flex items-start gap-4 flex-wrap">
        {showSlotMeter && (
          <div className="flex gap-3 flex-1 min-w-0">
            <SlotMeter label="Quick Movies" used={movieSlotsUsed} max={QUICK_LIMITS.movie} />
            <SlotMeter label="Quick TV Shows" used={tvSlotsUsed} max={QUICK_LIMITS.tv} />
          </div>
        )}
        {isAdmin && (
          <button
            onClick={toggleAdminMode}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
              adminMode
                ? 'bg-purple-600/30 text-purple-300 hover:bg-purple-600/40 border border-purple-700/50'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300 border border-zinc-700'
            }`}
          >
            {/* Toggle pill */}
            <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${adminMode ? 'bg-purple-500' : 'bg-zinc-600'}`}>
              <span className={`absolute inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${adminMode ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </span>
            Admin Controls
          </button>
        )}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg bg-zinc-900 text-zinc-500">
          No requests found.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="py-3 pl-4 pr-3 text-xs font-medium uppercase tracking-wide text-zinc-500 w-14">Poster</th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Title</th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden sm:table-cell">Type</th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Status</th>
                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden sm:table-cell">Req. Type</th>

                <th className="py-3 px-3 text-xs font-medium uppercase tracking-wide text-zinc-500 hidden lg:table-cell">Date</th>
                <th className="py-3 pl-3 pr-4 text-xs font-medium uppercase tracking-wide text-zinc-500 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(request => (
                <RequestRow
                  key={request.id}
                  request={request}
                  isAdmin={isAdmin}
                  isOwner={request.user_id === currentUserId}
                  adminMode={adminMode && isAdmin}
                  userSlots={userSlotsMap[request.user_id]}
                  localStatus={localStatuses[request.id] ?? null}
                  expanded={expandedId === request.id}
                  onToggleExpand={handleToggleExpand}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onApprove={handleApprove}
                  onDecline={handleDecline}
                  onApproved={(id, status) => handleUpdate(id, status)}
                  busy={busyIds.has(request.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
