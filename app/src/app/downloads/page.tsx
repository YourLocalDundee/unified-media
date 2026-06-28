'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import TorrentSettingsClient from '@/app/settings/torrent/TorrentSettingsClient'
import { TorrentDetailPanel } from './TorrentDetailPanel'
import { formatBytes } from '@/lib/utils'
import { useFocusTrap } from '@/hooks/useFocusTrap'
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
// UI prefs (mirrors TorrentSettingsClient — same key, same shape)
// ---------------------------------------------------------------------------

const UI_PREFS_KEY = 'unified-torrent-prefs'

interface UIPrefs {
  rowsPerPage: 25 | 50 | 100 | 'all'
  sortColumn: string
  sortReverse: boolean
  confirmDelete: boolean
  confirmDeleteFiles: boolean
}

// Default sort is newest-first. Under the uniform comparator below reverse=false=ascending and
// reverse=true=descending, so the added_on default carries reverse=true (descending = newest first).
const DEFAULT_UI_PREFS: UIPrefs = {
  rowsPerPage: 50,
  sortColumn: 'added_on',
  sortReverse: true,
  confirmDelete: true,
  confirmDeleteFiles: true,
}

function loadUIPrefs(): UIPrefs {
  if (typeof window === 'undefined') return DEFAULT_UI_PREFS
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return DEFAULT_UI_PREFS
    const stored = JSON.parse(raw) as Partial<UIPrefs>
    const prefs = { ...DEFAULT_UI_PREFS, ...stored }
    // Migrate the legacy default: the pre-uniform-sort code stored {added_on,false} but sorted numbers
    // descending when not reversed, so that meant newest-first. Under the new asc=reverse:false rule it
    // would flip to oldest-first, so normalize the old default back to newest-first.
    if (stored.sortColumn === 'added_on' && stored.sortReverse === false) prefs.sortReverse = true
    return prefs
  } catch {
    return DEFAULT_UI_PREFS
  }
}

// STATUS sort priority (feature): a downloads view reads best when problems and active transfers float
// to the top and finished/paused sink — NOT alphabetical. Lower rank = higher when ascending. Cross-
// checked against VueTorrent's TorrentState ordering; the one deviation is surfacing errors at the top
// (rank 0) because they're actionable, where VueTorrent lists them last.
const STATE_PRIORITY: Record<string, number> = {
  error: 0, missingFiles: 0,
  downloading: 1, forcedDL: 1,
  metaDL: 2, forcedMetaDL: 2,
  stalledDL: 3,
  queuedDL: 4,
  allocating: 5, checkingDL: 5, checkingResumeData: 5, moving: 5,
  uploading: 6, forcedUP: 6,
  stalledUP: 7,
  queuedUP: 8, checkingUP: 8,
  pausedDL: 9, pausedUP: 9, stoppedDL: 9, stoppedUP: 9,
  unknown: 10,
}
const statePriority = (s: string): number => STATE_PRIORITY[s] ?? 10

// Uniform comparator (feature). reverse=false=ascending, reverse=true=descending — matching the
// Settings → Interface tab's asc/desc dropdown. State sorts by STATE_PRIORITY, name by locale, the
// rest numerically. Ties break by name then hash so the 2s poll never reshuffles equal rows.
function sortTorrents(torrents: Torrent[], column: string, reverse: boolean): Torrent[] {
  const asc = (a: Torrent, b: Torrent): number => {
    let c = 0
    if (column === 'state') c = statePriority(a.state) - statePriority(b.state)
    else if (column === 'name') c = a.name.localeCompare(b.name)
    else {
      const av = (a as unknown as Record<string, unknown>)[column]
      const bv = (b as unknown as Record<string, unknown>)[column]
      if (typeof av === 'number' && typeof bv === 'number') c = av - bv
      else if (typeof av === 'string' && typeof bv === 'string') c = av.localeCompare(bv)
    }
    if (c === 0) c = a.name.localeCompare(b.name)
    if (c === 0) c = a.hash.localeCompare(b.hash)
    return c
  }
  return [...torrents].sort((a, b) => (reverse ? -asc(a, b) : asc(a, b)))
}

// Clickable column header that cycles sort on click (asc → desc → default) and shows the active
// direction arrow (▲ ascending / ▼ descending). aria-sort is set for screen readers.
function SortHeader({
  label,
  column,
  sortColumn,
  sortReverse,
  onSort,
  className = '',
}: {
  label: string
  column: string
  sortColumn: string
  sortReverse: boolean
  onSort: (column: string) => void
  className?: string
}) {
  const active = sortColumn === column
  return (
    <th
      className={`px-3 py-2.5 ${className}`}
      aria-sort={active ? (sortReverse ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
      >
        {label}
        <span className="w-2 text-[10px] leading-none">{active ? (sortReverse ? '▼' : '▲') : ''}</span>
      </button>
    </th>
  )
}

// ---------------------------------------------------------------------------
// Delete confirm modal (replaces window.confirm — A7-05)
// ---------------------------------------------------------------------------

interface DeleteConfirmProps {
  name: string
  allowDeleteFiles: boolean
  onConfirm: (deleteFiles: boolean) => void
  onCancel: () => void
}

function DeleteConfirmModal({ name, allowDeleteFiles, onConfirm, onCancel }: DeleteConfirmProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, onCancel)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <h2 id="delete-confirm-title" className="mb-2 text-base font-semibold text-foreground">
          Delete torrent?
        </h2>
        <p
          className="mb-5 truncate text-sm text-muted-foreground"
          title={name}
        >
          {name}
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => onConfirm(false)}
            className="w-full rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Delete torrent only
          </button>
          {allowDeleteFiles && (
            <button
              onClick={() => onConfirm(true)}
              className="w-full rounded-lg border border-red-500/60 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-500 hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-500 dark:text-red-400"
            >
              Delete torrent + files
            </button>
          )}
          <button
            onClick={onCancel}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { addTorrent, isPending } = useAddTorrent()

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!url.trim()) return
      setSubmitError(null)
      try {
        await addTorrent(url.trim(), category.trim() || undefined)
      } catch {
        // A7-04: a failed add must NOT clear the inputs or close the form.
        setSubmitError('Could not add torrent. Check the link and try again.')
        return
      }
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
          {/* A7-04 / A16: surface a failed add inline; aria-live announces it. */}
          {submitError && (
            <p
              role="alert"
              className="mt-2 text-xs font-medium text-red-600 dark:text-red-400"
            >
              {submitError}
            </p>
          )}
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

// Wraps TorrentRow + its optional TorrentDetailPanel. Needed because <tbody>
// cannot contain a React fragment with a key in older JSX transforms — a function
// component returning Fragment gets the key on the component boundary, not the DOM.
function TorrentDetailFragment({
  torrent,
  selected,
  expanded,
  onSelect,
  onPause,
  onResume,
  onRequestDelete,
  onToggleDetail,
  onCloseDetail,
}: TorrentRowProps & { onCloseDetail: () => void }) {
  return (
    <>
      <TorrentRow
        torrent={torrent}
        selected={selected}
        expanded={expanded}
        onSelect={onSelect}
        onPause={onPause}
        onResume={onResume}
        onRequestDelete={onRequestDelete}
        onToggleDetail={onToggleDetail}
      />
      {expanded && (
        <TorrentDetailPanel
          hash={torrent.hash}
          name={torrent.name}
          colSpan={8}
          onClose={onCloseDetail}
        />
      )}
    </>
  )
}

interface TorrentRowProps {
  torrent: Torrent
  selected: boolean
  expanded: boolean
  onSelect: (hash: string, checked: boolean) => void
  onPause: (hash: string) => void
  onResume: (hash: string) => void
  onRequestDelete: (hash: string, name: string) => void
  onToggleDetail: (hash: string) => void
}

function TorrentRow({
  torrent,
  selected,
  expanded,
  onSelect,
  onPause,
  onResume,
  onRequestDelete,
  onToggleDetail,
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

  return (
    <tr
      className={`border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50 ${
        selected ? 'bg-blue-50 dark:bg-blue-900/10' : ''
      } ${expanded ? 'border-b-0 bg-gray-50/80 dark:bg-gray-800/30' : ''}`}
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

      {/* Name — click to expand detail panel */}
      <td className="max-w-xs px-3 py-2.5 cursor-pointer" onClick={() => onToggleDetail(torrent.hash)}>
        <span
          className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100"
          title={torrent.name}
        >
          {expanded ? '▼ ' : '▶ '}{torrent.name}
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
            onClick={() => onRequestDelete(torrent.hash, torrent.name)}
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

  // Load UI prefs from localStorage (A8-H3: wire Interface tab settings to this page)
  const [uiPrefs, setUIPrefs] = useState<UIPrefs>(DEFAULT_UI_PREFS)
  useEffect(() => {
    // Deferred a tick so the initial restore setState runs outside the effect's
    // synchronous commit path (react-hooks/set-state-in-effect).
    const id = setTimeout(() => setUIPrefs(loadUIPrefs()), 0)
    // Re-load whenever settings are saved in the slide-over
    const handler = () => setUIPrefs(loadUIPrefs())
    window.addEventListener('storage', handler)
    return () => { clearTimeout(id); window.removeEventListener('storage', handler) }
  }, [])

  // Click-to-cycle header sort: 1st click ascending, 2nd descending, 3rd back to the default
  // (added_on desc). Kept in uiPrefs state (so the 2s poll never clobbers it) and persisted to the
  // same localStorage key (so it survives reload and stays in sync with the Settings Interface tab).
  const cycleSort = useCallback((column: string) => {
    setUIPrefs((prev) => {
      let nextColumn = column
      let nextReverse = false // ascending
      if (prev.sortColumn === column) {
        if (!prev.sortReverse) nextReverse = true // asc → desc
        else { nextColumn = DEFAULT_UI_PREFS.sortColumn; nextReverse = DEFAULT_UI_PREFS.sortReverse } // desc → default
      }
      const next = { ...prev, sortColumn: nextColumn, sortReverse: nextReverse }
      try { localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
      return next
    })
  }, [])

  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedHash, setExpandedHash] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const settingsDialogRef = useRef<HTMLDivElement>(null)
  const closeSettings = useCallback(() => setShowSettings(false), [])
  useFocusTrap(settingsDialogRef, showSettings, closeSettings)
  // A7-04: surfaces a failed pause/resume/delete action (the action hooks now
  // throw on a non-2xx response). Announced via an aria-live region below.
  const [actionError, setActionError] = useState<string | null>(null)

  // A7-05: delete confirm modal state (replaces window.confirm)
  const [pendingDelete, setPendingDelete] = useState<{ hashes: string[]; name: string } | null>(null)

  // Speed history for the graph — capped at 60 samples (~2 min at 2s poll rate)
  const [speedHistory, setSpeedHistory] = useState<{ dl: number; ul: number }[]>([])
  useEffect(() => {
    if (!transferInfo) return
    // Deferred a tick so the history-append setState runs outside the effect's
    // synchronous commit path (react-hooks/set-state-in-effect).
    const id = setTimeout(() => {
      setSpeedHistory((prev) => {
        const next = [
          ...prev,
          { dl: transferInfo.dl_info_speed ?? 0, ul: transferInfo.up_info_speed ?? 0 },
        ]
        return next.length > 60 ? next.slice(next.length - 60) : next
      })
    }, 0)
    return () => clearTimeout(id)
  }, [transferInfo])

  // True only during the very first poll before any response (success or error) arrives;
  // used to show skeleton rows instead of "no torrents" empty state.
  const isFirstLoad = !isConnected && !error

  // ---------------------------------------------------------------------------
  // Filtering + sorting + pagination (A8-H3)
  // ---------------------------------------------------------------------------

  const filteredTorrents = useMemo(() => {
    let result: Torrent[]
    switch (activeTab) {
      case 'downloading':
        result = torrents.filter((t) =>
          ['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL', 'stalledDL', 'queuedDL', 'checkingDL', 'allocating'].includes(t.state)
        )
        break
      case 'seeding':
        result = torrents.filter((t) =>
          ['uploading', 'forcedUP', 'stalledUP', 'queuedUP', 'checkingUP'].includes(t.state)
        )
        break
      case 'paused':
        result = torrents.filter((t) =>
          ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'].includes(t.state)
        )
        break
      default:
        result = torrents
    }
    // Apply sort from Interface prefs
    result = sortTorrents(result, uiPrefs.sortColumn, uiPrefs.sortReverse)
    // Apply rowsPerPage limit
    if (uiPrefs.rowsPerPage !== 'all') result = result.slice(0, uiPrefs.rowsPerPage)
    return result
  }, [torrents, activeTab, uiPrefs.sortColumn, uiPrefs.sortReverse, uiPrefs.rowsPerPage])

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

  // A7-04: each action now reports a failure instead of silently no-oping.
  const handlePause = useCallback(
    (hash: string) => {
      setActionError(null)
      pauseTorrents([hash]).catch(() => setActionError('Failed to pause torrent.'))
    },
    [pauseTorrents]
  )
  const handleResume = useCallback(
    (hash: string) => {
      setActionError(null)
      resumeTorrents([hash]).catch(() => setActionError('Failed to resume torrent.'))
    },
    [resumeTorrents]
  )

  // A7-05 + A8-H3: request delete opens the custom modal (skipped when confirmDelete=false)
  const handleRequestDelete = useCallback(
    (hash: string, name: string) => {
      if (!uiPrefs.confirmDelete) {
        // Skip confirm — delete immediately, no files
        setActionError(null)
        deleteTorrents([hash], false).catch(() => setActionError('Failed to delete torrent.'))
        return
      }
      setPendingDelete({ hashes: [hash], name })
    },
    [uiPrefs.confirmDelete, deleteTorrents]
  )

  const handleToggleDetail = useCallback((hash: string) => {
    setExpandedHash(prev => prev === hash ? null : hash)
  }, [])

  const handleBulkPause = useCallback(() => {
    setActionError(null)
    pauseTorrents(Array.from(selected)).catch(() => setActionError('Failed to pause selected torrents.'))
    clearSelection()
  }, [selected, pauseTorrents, clearSelection])

  const handleBulkResume = useCallback(() => {
    setActionError(null)
    resumeTorrents(Array.from(selected)).catch(() => setActionError('Failed to resume selected torrents.'))
    clearSelection()
  }, [selected, resumeTorrents, clearSelection])

  const handleBulkDelete = useCallback(() => {
    const count = selected.size
    if (!uiPrefs.confirmDelete) {
      setActionError(null)
      deleteTorrents(Array.from(selected), false).catch(() =>
        setActionError('Failed to delete selected torrents.')
      )
      clearSelection()
      return
    }
    setPendingDelete({
      hashes: Array.from(selected),
      name: `${count} torrent${count !== 1 ? 's' : ''}`,
    })
    clearSelection()
  }, [selected, deleteTorrents, clearSelection, uiPrefs.confirmDelete])

  // Called by DeleteConfirmModal
  const handleConfirmDelete = useCallback(
    (deleteFiles: boolean) => {
      if (!pendingDelete) return
      setActionError(null)
      deleteTorrents(pendingDelete.hashes, deleteFiles).catch(() =>
        setActionError('Failed to delete torrent.')
      )
      setPendingDelete(null)
    },
    [pendingDelete, deleteTorrents]
  )

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
              {/* Connection status (A16: polite live region for status changes) */}
              <span className="flex items-center gap-1.5" aria-live="polite">
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
                    ↓ {formatSpeed(transferInfo.dl_info_speed ?? 0)}
                  </span>
                  <span className="text-green-600 dark:text-green-400">
                    ↑ {formatSpeed(transferInfo.up_info_speed ?? 0)}
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
        {/* A7-04 / A16: action errors are announced assertively to screen readers. */}
        <div aria-live="assertive" className="sr-only">
          {actionError ?? ''}
        </div>
        {/* A7-04: failed pause/resume/delete banner (dismissible). */}
        {actionError && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
            <span className="text-sm font-medium text-red-700 dark:text-red-400">
              {actionError}
            </span>
            <button
              onClick={() => setActionError(null)}
              className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:text-red-400 dark:hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-500"
              aria-label="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}
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
                  <SortHeader label="Name" column="name" sortColumn={uiPrefs.sortColumn} sortReverse={uiPrefs.sortReverse} onSort={cycleSort} />
                  <SortHeader label="Size" column="size" sortColumn={uiPrefs.sortColumn} sortReverse={uiPrefs.sortReverse} onSort={cycleSort} />
                  <SortHeader label="Progress" column="progress" sortColumn={uiPrefs.sortColumn} sortReverse={uiPrefs.sortReverse} onSort={cycleSort} className="min-w-[6rem]" />
                  <SortHeader label="Speed" column="dlspeed" sortColumn={uiPrefs.sortColumn} sortReverse={uiPrefs.sortReverse} onSort={cycleSort} />
                  <SortHeader label="ETA" column="eta" sortColumn={uiPrefs.sortColumn} sortReverse={uiPrefs.sortReverse} onSort={cycleSort} />
                  <SortHeader label="Status" column="state" sortColumn={uiPrefs.sortColumn} sortReverse={uiPrefs.sortReverse} onSort={cycleSort} />
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
                    <TorrentDetailFragment
                      key={torrent.hash}
                      torrent={torrent}
                      selected={selected.has(torrent.hash)}
                      expanded={expandedHash === torrent.hash}
                      onSelect={handleSelect}
                      onPause={handlePause}
                      onResume={handleResume}
                      onRequestDelete={handleRequestDelete}
                      onToggleDetail={handleToggleDetail}
                      onCloseDetail={() => setExpandedHash(null)}
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
                      onClick={() => handleRequestDelete(torrent.hash, torrent.name)}
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
          <div
            ref={settingsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="umt-settings-title"
            className="w-full max-w-2xl bg-background border-l border-border overflow-y-auto flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background">
              <h2 id="umt-settings-title" className="text-sm font-semibold text-foreground">UMT Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <span aria-hidden="true">✕</span>
              </button>
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

      {/* A7-05: delete confirm modal */}
      {pendingDelete && (
        <DeleteConfirmModal
          name={pendingDelete.name}
          allowDeleteFiles={uiPrefs.confirmDeleteFiles}
          onConfirm={handleConfirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}
