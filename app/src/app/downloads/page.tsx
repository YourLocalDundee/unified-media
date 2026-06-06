/**
 * /downloads — simplified single-page UMT queue viewer.
 * This is an older, self-contained page that predates the component-split
 * version (FilterSidebar, TorrentRow, DetailPanel). It still ships alongside
 * those components but only uses the raw UMT hooks directly.
 *
 * Primary differences from the component-split version:
 *   - No filter sidebar, no detail panel, no right-click context menu
 *   - Has an inline speed graph and a quick speed-limit dropdown
 *   - Responsive: table on md+, card list on mobile
 */
'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import TorrentSettingsClient from '@/app/settings/torrent/TorrentSettingsClient'
import { formatBytes } from '@/lib/utils'
// The hooks below import from @/lib/qbittorrent directly because this page
// uses client-side polling against the /api/qbit proxy route. The abstraction
// layer in src/lib/download-client is for server-side use; the browser hook
// works with raw UMT types since it talks to the qBit proxy endpoint.
import {
  useMainData,
  useAddTorrent,
  usePauseTorrents,
  useResumeTorrents,
  useDeleteTorrents,
} from '@/lib/qbittorrent/hooks'
import {
  isTorrentActive,
  isTorrentComplete,
  getTorrentStateLabel,
  getTorrentStateColor,
} from '@/lib/qbittorrent/types'
import type { Torrent, TorrentState } from '@/lib/qbittorrent/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'downloading' | 'seeding' | 'paused'

function formatEta(eta: number, state: TorrentState): string {
  if (isTorrentComplete(state)) return 'Done'
  // qBittorrent uses 8640000 (100 days) as the sentinel value for "unknown ETA"
  if (eta < 0 || eta >= 8640000) return '∞'
  if (eta === 0) return 'Done'
  const h = Math.floor(eta / 3600)
  const m = Math.floor((eta % 3600) / 60)
  const s = eta % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatSpeed(bytes: number): string {
  if (bytes === 0) return '—'
  return formatBytes(bytes) + '/s'
}

const STATE_COLOR_CLASSES: Record<
  'green' | 'blue' | 'yellow' | 'red' | 'gray',
  string
> = {
  green:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  yellow:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

function StateBadge({ state }: { state: TorrentState }) {
  const color = getTorrentStateColor(state)
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATE_COLOR_CLASSES[color]}`}
    >
      {getTorrentStateLabel(state)}
    </span>
  )
}

function ProgressBar({ progress }: { progress: number }) {
  const pct = Math.min(100, Math.max(0, progress * 100))
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        className="h-1.5 rounded-full bg-blue-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed graph
// ---------------------------------------------------------------------------

interface SpeedPoint {
  dl: number
  ul: number
}

function SpeedGraph({ history }: { history: SpeedPoint[] }) {
  const WIDTH = 60
  const HEIGHT = 48

  const maxVal = useMemo(() => {
    let m = 0
    for (const p of history) {
      if (p.dl > m) m = p.dl
      if (p.ul > m) m = p.ul
    }
    return m
  }, [history])

  const toPoints = (getter: (p: SpeedPoint) => number): string => {
    if (history.length === 0) return `0,${HEIGHT} ${WIDTH - 1},${HEIGHT}`
    return history
      .map((p, i) => {
        // x is a 0-100 percentage of the viewBox width; y is inverted (SVG origin is top-left)
        const x = (i / (WIDTH - 1)) * 100
        const y =
          maxVal === 0
            ? HEIGHT
            : HEIGHT - (getter(p) / maxVal) * (HEIGHT - 4)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  const dlPoints = toPoints((p) => p.dl)
  const ulPoints = toPoints((p) => p.ul)

  const latest = history[history.length - 1]

  return (
    <div className="relative mb-4 rounded-lg bg-zinc-900 px-3 pb-2 pt-2">
      <svg
        viewBox={`0 0 100 ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-12 w-full"
        aria-hidden="true"
      >
        {/* Baseline */}
        <line
          x1="0"
          y1={HEIGHT}
          x2="100"
          y2={HEIGHT}
          stroke="#3f3f46"
          strokeWidth="0.5"
        />
        {/* Download — blue */}
        {history.length > 1 && (
          <polyline
            points={dlPoints}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* Upload — green */}
        {history.length > 1 && (
          <polyline
            points={ulPoints}
            fill="none"
            stroke="#22c55e"
            strokeWidth="1.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* Speed labels */}
      <div className="absolute right-3 top-2 flex flex-col items-end gap-0.5 text-[10px] leading-none">
        <span className="text-blue-400">
          ↓ {latest ? formatSpeed(latest.dl) : '—'}
        </span>
        <span className="text-green-400">
          ↑ {latest ? formatSpeed(latest.ul) : '—'}
        </span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed limit dropdown
// ---------------------------------------------------------------------------

const SPEED_PRESETS: { label: string; bytes: number }[] = [
  { label: '∞ Unlimited', bytes: 0 },
  { label: '1 MB/s', bytes: 1_048_576 },
  { label: '5 MB/s', bytes: 5_242_880 },
  { label: '10 MB/s', bytes: 10_485_760 },
  { label: '25 MB/s', bytes: 26_214_400 },
  { label: '50 MB/s', bytes: 52_428_800 },
]

function SpeedLimitDropdown() {
  const [open, setOpen] = useState(false)
  const [currentLimit, setCurrentLimit] = useState<number>(0)
  const ref = useRef<HTMLDivElement>(null)

  // Load current limit on mount
  useEffect(() => {
    fetch('/api/qbit/app/preferences')
      .then((r) => r.json())
      .then((prefs) => {
        if (typeof prefs?.dl_rate_limit === 'number') {
          setCurrentLimit(prefs.dl_rate_limit)
        }
      })
      .catch(() => {/* ignore */})
  }, [])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = useCallback(async (bytes: number) => {
    setOpen(false)
    try {
      await fetch('/api/qbit/app/setPreferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          json: JSON.stringify({ dl_rate_limit: bytes }),
        }),
      })
      setCurrentLimit(bytes)
    } catch {/* ignore */}
  }, [])

  const label =
    currentLimit === 0
      ? '∞'
      : formatBytes(currentLimit) + '/s'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Set download speed limit"
        className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
      >
        <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9 3H7V7h2v4Zm0-5H7V4h2v2Z" />
        </svg>
        DL: {label}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {SPEED_PRESETS.map((preset) => (
            <button
              key={preset.bytes}
              onClick={() => handleSelect(preset.bytes)}
              className={`w-full px-3 py-1.5 text-left text-xs hover:bg-gray-100 dark:hover:bg-gray-700 ${
                currentLimit === preset.bytes
                  ? 'font-semibold text-blue-600 dark:text-blue-400'
                  : 'text-gray-700 dark:text-gray-300'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add torrent form
// ---------------------------------------------------------------------------

function AddTorrentForm({ onAdded }: { onAdded?: () => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [category, setCategory] = useState('')
  const { addTorrent, isPending } = useAddTorrent()

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!url.trim()) return
      await addTorrent(url.trim(), category.trim() || undefined)
      setUrl('')
      setCategory('')
      setOpen(false)
      onAdded?.()
    },
    [url, category, addTorrent, onAdded]
  )

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
        </svg>
        Add Torrent
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="torrent-url"
                className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                Magnet link or URL
              </label>
              <input
                id="torrent-url"
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="magnet:?xt=urn:btih:... or https://..."
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                autoFocus
              />
            </div>
            <div className="w-full sm:w-40">
              <label
                htmlFor="torrent-category"
                className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                Category (optional)
              </label>
              <input
                id="torrent-category"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. movies"
                className="w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending || !url.trim()}
                className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {isPending ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Skeleton rows (shown on first load)
// ---------------------------------------------------------------------------

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <tr key={i} className="border-b border-gray-100 dark:border-gray-800">
          <td className="w-8 px-3 py-3">
            <div className="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </td>
          <td className="max-w-xs px-3 py-3">
            <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </td>
          <td className="px-3 py-3">
            <div className="h-4 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </td>
          <td className="px-3 py-3">
            <div className="h-3 w-24 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
          </td>
          <td className="px-3 py-3">
            <div className="h-4 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </td>
          <td className="px-3 py-3">
            <div className="h-4 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </td>
          <td className="px-3 py-3">
            <div className="h-5 w-20 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700" />
          </td>
          <td className="px-3 py-3">
            <div className="flex gap-2">
              <div className="h-6 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-6 w-12 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          </td>
        </tr>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// Torrent row
// ---------------------------------------------------------------------------

interface TorrentRowProps {
  torrent: Torrent
  selected: boolean
  onSelect: (hash: string, checked: boolean) => void
  onPause: (hash: string) => void
  onResume: (hash: string) => void
  onDelete: (hash: string) => void
}

function TorrentRow({
  torrent,
  selected,
  onSelect,
  onPause,
  onResume,
  onDelete,
}: TorrentRowProps) {
  const isPaused = [
    'pausedDL',
    'pausedUP',
    'stoppedDL',
    'stoppedUP',
  ].includes(torrent.state)

  const isDownloading = [
    'downloading',
    'forcedDL',
    'metaDL',
    'forcedMetaDL',
    'stalledDL',
    'queuedDL',
  ].includes(torrent.state)

  const isSeeding = [
    'uploading',
    'forcedUP',
    'stalledUP',
    'queuedUP',
  ].includes(torrent.state)

  const showPause = isDownloading || isSeeding
  const showResume = isPaused

  const handleDelete = useCallback(() => {
    const withFiles = window.confirm(
      `Delete "${torrent.name}"?\n\nClick OK to delete torrent only.\n(Hold Shift to also delete files — not supported in this dialog, use the torrent manager for that.)`
    )
    if (withFiles) onDelete(torrent.hash)
  }, [torrent.hash, torrent.name, onDelete])

  return (
    <tr
      className={`border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50 ${
        selected ? 'bg-blue-50 dark:bg-blue-900/10' : ''
      }`}
    >
      {/* Checkbox */}
      <td className="w-8 px-3 py-2.5">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(torrent.hash, e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          aria-label={`Select ${torrent.name}`}
        />
      </td>

      {/* Name */}
      <td className="max-w-xs px-3 py-2.5">
        <span
          className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100"
          title={torrent.name}
        >
          {torrent.name}
        </span>
        {torrent.category ? (
          <span className="text-xs text-gray-400">{torrent.category}</span>
        ) : null}
      </td>

      {/* Size */}
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400">
        {formatBytes(torrent.size)}
      </td>

      {/* Progress */}
      <td className="min-w-[6rem] px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <ProgressBar progress={torrent.progress} />
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {(torrent.progress * 100).toFixed(1)}%
          </span>
        </div>
      </td>

      {/* Speed */}
      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400">
        <div className="flex flex-col">
          <span className="text-blue-600 dark:text-blue-400">
            ↓ {formatSpeed(torrent.dlspeed)}
          </span>
          <span className="text-green-600 dark:text-green-400">
            ↑ {formatSpeed(torrent.upspeed)}
          </span>
        </div>
      </td>

      {/* ETA */}
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-gray-600 dark:text-gray-400">
        {formatEta(torrent.eta, torrent.state)}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5">
        <StateBadge state={torrent.state} />
      </td>

      {/* Actions */}
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {showPause && (
            <button
              onClick={() => onPause(torrent.hash)}
              title="Pause"
              className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
            >
              Pause
            </button>
          )}
          {showResume && (
            <button
              onClick={() => onResume(torrent.hash)}
              title="Resume"
              className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
            >
              Resume
            </button>
          )}
          <button
            onClick={handleDelete}
            title="Delete"
            className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/20 dark:hover:text-red-300"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DownloadsPage() {
  const { torrents, transferInfo, isConnected, error, retry } = useMainData()
  const { pauseTorrents, isPending: isPausingBulk } = usePauseTorrents()
  const { resumeTorrents, isPending: isResumingBulk } = useResumeTorrents()
  const { deleteTorrents, isPending: isDeletingBulk } = useDeleteTorrents()

  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showSettings, setShowSettings] = useState(false)

  // Speed history for the graph — capped at 60 samples (~2 min at 2s poll rate)
  const [speedHistory, setSpeedHistory] = useState<{ dl: number; ul: number }[]>([])
  useEffect(() => {
    if (!transferInfo) return
    setSpeedHistory((prev) => {
      const next = [
        ...prev,
        { dl: transferInfo.dl_info_speed ?? 0, ul: transferInfo.ul_info_speed ?? 0 },
      ]
      return next.length > 60 ? next.slice(next.length - 60) : next
    })
  }, [transferInfo])

  // True only during the very first poll before any response (success or error) arrives;
  // used to show skeleton rows instead of "no torrents" empty state.
  const isFirstLoad = !isConnected && !error

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  const filteredTorrents = useMemo(() => {
    switch (activeTab) {
      case 'downloading':
        return torrents.filter((t) =>
          ['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL', 'stalledDL', 'queuedDL', 'checkingDL', 'allocating'].includes(t.state)
        )
      case 'seeding':
        return torrents.filter((t) =>
          ['uploading', 'forcedUP', 'stalledUP', 'queuedUP', 'checkingUP'].includes(t.state)
        )
      case 'paused':
        return torrents.filter((t) =>
          ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'].includes(t.state)
        )
      default:
        return torrents
    }
  }, [torrents, activeTab])

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  const activeTorrentCount = useMemo(
    () => torrents.filter((t) => isTorrentActive(t.state)).length,
    [torrents]
  )

  // ---------------------------------------------------------------------------
  // Selection handlers
  // ---------------------------------------------------------------------------

  const handleSelect = useCallback((hash: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(hash)
      else next.delete(hash)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (selected.size === filteredTorrents.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredTorrents.map((t) => t.hash)))
    }
  }, [selected.size, filteredTorrents])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  const handlePause = useCallback(
    (hash: string) => pauseTorrents([hash]),
    [pauseTorrents]
  )
  const handleResume = useCallback(
    (hash: string) => resumeTorrents([hash]),
    [resumeTorrents]
  )
  const handleDelete = useCallback(
    (hash: string) => deleteTorrents([hash], false),
    [deleteTorrents]
  )

  const handleBulkPause = useCallback(() => {
    pauseTorrents(Array.from(selected))
    clearSelection()
  }, [selected, pauseTorrents, clearSelection])

  const handleBulkResume = useCallback(() => {
    resumeTorrents(Array.from(selected))
    clearSelection()
  }, [selected, resumeTorrents, clearSelection])

  const handleBulkDelete = useCallback(() => {
    const count = selected.size
    if (!window.confirm(`Delete ${count} torrent${count !== 1 ? 's' : ''}?`)) return
    deleteTorrents(Array.from(selected), false)
    clearSelection()
  }, [selected, deleteTorrents, clearSelection])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const tabs: { id: FilterTab; label: string }[] = [
    { id: 'all', label: `All (${torrents.length})` },
    {
      id: 'downloading',
      label: `Downloading (${torrents.filter((t) => ['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL', 'stalledDL', 'queuedDL', 'checkingDL', 'allocating'].includes(t.state)).length})`,
    },
    {
      id: 'seeding',
      label: `Seeding (${torrents.filter((t) => ['uploading', 'forcedUP', 'stalledUP', 'queuedUP', 'checkingUP'].includes(t.state)).length})`,
    },
    {
      id: 'paused',
      label: `Paused (${torrents.filter((t) => ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'].includes(t.state)).length})`,
    },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Downloads
              </h1>
              <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
                UMT download queue
              </p>
            </div>

            {/* Stats bar */}
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {/* Connection status */}
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    isConnected
                      ? 'bg-green-500'
                      : isFirstLoad
                      ? 'bg-yellow-400 animate-pulse'
                      : 'bg-red-500'
                  }`}
                />
                <span
                  className={
                    isConnected
                      ? 'text-green-700 dark:text-green-400'
                      : 'text-gray-500 dark:text-gray-400'
                  }
                >
                  {isConnected
                    ? 'Connected'
                    : isFirstLoad
                    ? 'Connecting…'
                    : 'Disconnected'}
                </span>
              </span>

              {transferInfo && (
                <>
                  <span className="text-blue-600 dark:text-blue-400">
                    ↓ {formatSpeed(transferInfo.dl_info_speed)}
                  </span>
                  <span className="text-green-600 dark:text-green-400">
                    ↑ {formatSpeed(transferInfo.ul_info_speed)}
                  </span>
                  <span className="text-gray-600 dark:text-gray-400">
                    {activeTorrentCount} active
                  </span>
                  {typeof transferInfo.free_space_on_disk === 'number' && (
                    <span className="text-gray-500 dark:text-gray-400">
                      💾 Free: {formatBytes(transferInfo.free_space_on_disk)}
                    </span>
                  )}
                  <SpeedLimitDropdown />
                </>
              )}
              <button
                onClick={() => setShowSettings((v) => !v)}
                title="UMT Settings"
                className="flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                ⚙ Settings
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        {/* Disconnected banner */}
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
            <div className="flex items-center gap-2">
              <svg
                className="h-4 w-4 flex-shrink-0 text-red-500"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm font-medium text-red-700 dark:text-red-400">
                UMT unreachable
              </span>
              <span className="hidden text-xs text-red-600 dark:text-red-500 sm:inline">
                — {error}
              </span>
            </div>
            <button
              onClick={retry}
              className="rounded-md border border-red-300 bg-white px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 focus:outline-none focus:ring-2 focus:ring-red-500"
            >
              Retry
            </button>
          </div>
        )}

        {/* Add torrent form */}
        <AddTorrentForm />

        {/* Filter tabs */}
        <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-gray-800">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors focus:outline-none ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-800 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Speed graph */}
        <SpeedGraph history={speedHistory} />

        {/* Torrent table — desktop only */}
        <div className="hidden md:block overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/80 dark:border-gray-800 dark:bg-gray-800/50">
                  <th className="w-8 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={
                        filteredTorrents.length > 0 &&
                        selected.size === filteredTorrents.length
                      }
                      onChange={handleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Name
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Size
                  </th>
                  <th className="min-w-[6rem] px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Progress
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Speed
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    ETA
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Status
                  </th>
                  <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {isFirstLoad ? (
                  <SkeletonRows />
                ) : filteredTorrents.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                    >
                      {torrents.length === 0
                        ? 'No torrents. Add one above.'
                        : `No torrents in "${activeTab}" view.`}
                    </td>
                  </tr>
                ) : (
                  filteredTorrents.map((torrent) => (
                    <TorrentRow
                      key={torrent.hash}
                      torrent={torrent}
                      selected={selected.has(torrent.hash)}
                      onSelect={handleSelect}
                      onPause={handlePause}
                      onResume={handleResume}
                      onDelete={handleDelete}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mobile card list — shown only on small screens */}
        <div className="block md:hidden space-y-3">
          {isFirstLoad ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 animate-pulse"
                >
                  <div className="mb-2 h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="mb-3 h-3 w-16 rounded-full bg-gray-200 dark:bg-gray-700" />
                  <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700" />
                </div>
              ))}
            </div>
          ) : filteredTorrents.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              {torrents.length === 0
                ? 'No torrents. Add one above.'
                : `No torrents in "${activeTab}" view.`}
            </p>
          ) : (
            filteredTorrents.map((torrent) => {
              const isPaused = ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'].includes(torrent.state)
              const isDownloading = ['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL', 'stalledDL', 'queuedDL'].includes(torrent.state)
              const isSeeding = ['uploading', 'forcedUP', 'stalledUP', 'queuedUP'].includes(torrent.state)
              const showPause = isDownloading || isSeeding
              const showResume = isPaused
              return (
                <div
                  key={torrent.hash}
                  className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
                >
                  {/* Name + badge */}
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span
                      className="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
                      title={torrent.name}
                    >
                      {torrent.name}
                    </span>
                    <StateBadge state={torrent.state} />
                  </div>

                  {/* Progress bar */}
                  <div className="mb-1">
                    <ProgressBar progress={torrent.progress} />
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {(torrent.progress * 100).toFixed(1)}%
                  </span>

                  {/* Size + speed row */}
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                    <span>{formatBytes(torrent.size)} · ETA {formatEta(torrent.eta, torrent.state)}</span>
                    <span className="flex gap-2">
                      <span className="text-blue-600 dark:text-blue-400">↓ {formatSpeed(torrent.dlspeed)}</span>
                      <span className="text-green-600 dark:text-green-400">↑ {formatSpeed(torrent.upspeed)}</span>
                    </span>
                  </div>

                  {/* Action buttons */}
                  <div className="mt-3 flex items-center gap-2">
                    {showPause && (
                      <button
                        onClick={() => handlePause(torrent.hash)}
                        className="min-h-[44px] flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                      >
                        Pause
                      </button>
                    )}
                    {showResume && (
                      <button
                        onClick={() => handleResume(torrent.hash)}
                        className="min-h-[44px] flex-1 rounded-md border border-blue-300 bg-blue-50 px-3 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(torrent.hash)}
                      className="min-h-[44px] flex-1 rounded-md border border-red-300 bg-red-50 px-3 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* UMT Settings slide-over */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/60" onClick={() => setShowSettings(false)} />
          <div className="w-full max-w-2xl bg-zinc-950 border-l border-zinc-800 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 sticky top-0 bg-zinc-950">
              <h2 className="text-sm font-semibold text-white">UMT Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-zinc-400 hover:text-white">✕</button>
            </div>
            <div className="flex-1 p-4">
              <TorrentSettingsClient />
            </div>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky bottom-0 border-t border-gray-200 bg-white px-4 py-3 shadow-lg dark:border-gray-700 dark:bg-gray-900">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {selected.size} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkPause}
                disabled={isPausingBulk}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                Pause All
              </button>
              <button
                onClick={handleBulkResume}
                disabled={isResumingBulk}
                className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Resume All
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isDeletingBulk}
                className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                Delete Selected
              </button>
              <button
                onClick={clearSelection}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 focus:outline-none"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
