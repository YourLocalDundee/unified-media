/**
 * Single row in the /downloads torrent table. Renders a dynamic set of columns
 * based on the user's TorrentUIPreferences (which columns are visible). Each
 * column's content is produced by the Cell switch so adding a new column only
 * requires a new case there plus a new key in the ColumnKey union.
 *
 * Also renders the right-click context menu (ContextMenu), which is positioned
 * at the cursor coordinates using fixed positioning so it escapes any overflow
 * clipping on the table container.
 *
 * Exports fmtDate, fmtEta, fmtTimeActive, and STATE_COLOR_CLASSES so DetailPanel
 * can reuse the same formatting without duplicating the logic.
 */
'use client'

import { useCallback, useState, useRef, useEffect } from 'react'
import { formatBytes } from '@/lib/utils'
import type { Torrent, TorrentState } from '@/lib/qbittorrent/types'
import { getTorrentStateLabel, getTorrentStateColor } from '@/lib/qbittorrent/types'
import type { TorrentUIPreferences } from '@/types/torrent'

// ---------------------------------------------------------------------------
// Progress bar colors by state
// ---------------------------------------------------------------------------

function getProgressBarColor(state: TorrentState): string {
  if (['downloading', 'forcedDL', 'metaDL'].includes(state)) return 'bg-blue-500'
  if (['uploading', 'stalledUP', 'forcedUP'].includes(state)) return 'bg-green-500'
  if (['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'].includes(state)) return 'bg-gray-400'
  if (['error', 'missingFiles'].includes(state)) return 'bg-red-500'
  if (['checkingDL', 'checkingUP', 'checkingResumeData', 'allocating', 'moving'].includes(state))
    return 'bg-yellow-500'
  if (['queuedDL', 'queuedUP'].includes(state)) return 'bg-slate-400'
  return 'bg-blue-500'
}

const STATE_COLOR_CLASSES: Record<'green' | 'blue' | 'yellow' | 'red' | 'gray', string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

function fmtEta(seconds: number, state: TorrentState): string {
  if (['uploading', 'stalledUP', 'pausedUP', 'forcedUP', 'stoppedUP'].includes(state)) return 'Done'
  if (seconds < 0 || seconds >= 8640000) return '∞'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function fmtDate(timestamp: number, format: 'relative' | 'absolute'): string {
  if (!timestamp || timestamp < 0) return '—'
  const date = new Date(timestamp * 1000)
  if (format === 'absolute') return date.toLocaleString()
  const diff = Date.now() - date.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function fmtTimeActive(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface ContextMenuProps {
  x: number
  y: number
  torrent: Torrent
  onPause: () => void
  onResume: () => void
  onDelete: () => void
  onClose: () => void
}

function ContextMenu({ x, y, torrent, onPause, onResume, onDelete, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const isPaused = ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'].includes(torrent.state)
  const isActive = ['downloading', 'forcedDL', 'metaDL', 'uploading', 'forcedUP', 'stalledDL', 'stalledUP'].includes(torrent.state)

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    onClose()
  }

  const items = [
    isActive
      ? { label: 'Pause', action: () => { onPause(); onClose() } }
      : null,
    isPaused
      ? { label: 'Resume', action: () => { onResume(); onClose() } }
      : null,
    { label: 'Delete', action: () => { onDelete(); onClose() }, danger: true },
    null, // separator
    { label: 'Copy Magnet Link', action: () => copyToClipboard(torrent.magnet_uri ?? '') },
    { label: 'Copy Hash', action: () => copyToClipboard(torrent.hash) },
    { label: 'Copy Name', action: () => copyToClipboard(torrent.name) },
    { label: 'Copy Save Path', action: () => copyToClipboard(torrent.save_path) },
  ]

  return (
    <div
      ref={menuRef}
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }}
      className="w-48 rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={i} className="my-1 border-t border-gray-100 dark:border-gray-700" />
        ) : (
          <button
            key={i}
            onClick={item.action}
            className={`flex w-full items-center px-3 py-1.5 text-sm ${
              'danger' in item && item.danger
                ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
                : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {item.label}
          </button>
        )
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Column renderer
// ---------------------------------------------------------------------------

type ColumnKey =
  | 'name' | 'status' | 'size' | 'progress' | 'dlspeed' | 'upspeed' | 'eta'
  | 'ratio' | 'num_seeds' | 'num_leechs' | 'added_on' | 'category' | 'tags'
  | 'save_path' | 'completed' | 'time_active' | 'uploaded' | 'downloaded'
  | 'availability'

interface CellProps {
  col: ColumnKey
  torrent: Torrent
  prefs: TorrentUIPreferences
}

function Cell({ col, torrent, prefs }: CellProps) {
  switch (col) {
    case 'name':
      return (
        <div className="flex flex-col min-w-0">
          <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100" title={torrent.name}>
            {torrent.name}
          </span>
          {torrent.category ? (
            <span className="text-xs text-gray-400 truncate">{torrent.category}</span>
          ) : null}
        </div>
      )
    case 'status': {
      const color = getTorrentStateColor(torrent.state)
      return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATE_COLOR_CLASSES[color]}`}>
          {getTorrentStateLabel(torrent.state)}
        </span>
      )
    }
    case 'size':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{formatBytes(torrent.size)}</span>
    case 'progress': {
      const pct = Math.min(100, Math.max(0, torrent.progress * 100))
      const barColor = getProgressBarColor(torrent.state)
      return (
        <div className="flex flex-col gap-0.5 min-w-[5rem]">
          <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-gray-500 tabular-nums">{pct.toFixed(1)}%</span>
        </div>
      )
    }
    case 'dlspeed':
      return (
        <span className="whitespace-nowrap text-xs text-blue-600 dark:text-blue-400 tabular-nums">
          {torrent.dlspeed > 0 ? formatBytes(torrent.dlspeed) + '/s' : '—'}
        </span>
      )
    case 'upspeed':
      return (
        <span className="whitespace-nowrap text-xs text-green-600 dark:text-green-400 tabular-nums">
          {torrent.upspeed > 0 ? formatBytes(torrent.upspeed) + '/s' : '—'}
        </span>
      )
    case 'eta':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{fmtEta(torrent.eta, torrent.state)}</span>
    case 'ratio':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">{torrent.ratio.toFixed(3)}</span>
    case 'num_seeds':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">{torrent.num_seeds}</span>
    case 'num_leechs':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400 tabular-nums">{torrent.num_leechs}</span>
    case 'added_on':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{fmtDate(torrent.added_on, prefs.dateFormat)}</span>
    case 'category':
      return (
        <span className="text-xs text-gray-600 dark:text-gray-400">
          {torrent.category || '—'}
        </span>
      )
    case 'tags':
      return (
        <div className="flex flex-wrap gap-1">
          {torrent.tags
            ? torrent.tags.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                <span key={tag} className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  {tag}
                </span>
              ))
            : <span className="text-sm text-gray-400">—</span>}
        </div>
      )
    case 'save_path':
      return <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[10rem]" title={torrent.save_path}>{torrent.save_path || '—'}</span>
    case 'completed':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{formatBytes(torrent.completed ?? 0)}</span>
    case 'time_active':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{fmtTimeActive(torrent.time_active)}</span>
    case 'uploaded':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{formatBytes(torrent.uploaded ?? 0)}</span>
    case 'downloaded':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{formatBytes(torrent.downloaded ?? 0)}</span>
    case 'availability':
      return <span className="whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">{((torrent.availability ?? 0) * 100).toFixed(1)}%</span>
    default:
      return <span className="text-sm text-gray-400">—</span>
  }
}

// ---------------------------------------------------------------------------
// TorrentRow
// ---------------------------------------------------------------------------

interface TorrentRowProps {
  torrent: Torrent & { magnet_uri?: string; availability?: number }
  selected: boolean
  prefs: TorrentUIPreferences
  visibleCols: ColumnKey[]
  onSelect: (hash: string, e: React.MouseEvent) => void
  onOpen: (hash: string) => void
  onPause: (hash: string) => void
  onResume: (hash: string) => void
  onDelete: (hash: string, withFiles: boolean) => void
}

export default function TorrentRow({
  torrent,
  selected,
  prefs,
  visibleCols,
  onSelect,
  onOpen,
  onPause,
  onResume,
  onDelete,
}: TorrentRowProps) {
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleDelete = useCallback(() => {
    if (!prefs.confirmDelete) {
      onDelete(torrent.hash, false)
      return
    }
    if (window.confirm(`Delete "${torrent.name}"?`)) {
      const withFiles = prefs.confirmDeleteFiles
        ? window.confirm('Also delete downloaded files?')
        : false
      onDelete(torrent.hash, withFiles)
    }
  }, [torrent.hash, torrent.name, prefs.confirmDelete, prefs.confirmDeleteFiles, onDelete])

  const isPaused = ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'].includes(torrent.state)

  return (
    <>
      <tr
        className={`border-b border-gray-100 dark:border-gray-800 cursor-pointer transition-colors ${
          selected
            ? 'bg-blue-50 dark:bg-blue-900/10'
            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
        }`}
        onContextMenu={handleContextMenu}
        onClick={() => onOpen(torrent.hash)}
      >
        {/* Checkbox */}
        <td className="w-8 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => {}}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(torrent.hash, e as unknown as React.MouseEvent)
            }}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            aria-label={`Select ${torrent.name}`}
          />
        </td>

        {/* Dynamic columns */}
        {visibleCols.map((col) => (
          <td key={col} className="px-3 py-2.5 max-w-xs">
            <Cell col={col} torrent={torrent} prefs={prefs} />
          </td>
        ))}
      </tr>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          torrent={torrent}
          onPause={() => onPause(torrent.hash)}
          onResume={() => onResume(torrent.hash)}
          onDelete={handleDelete}
          onClose={() => setCtxMenu(null)}
        />
      )}
    </>
  )
}

export type { ColumnKey, CellProps }
export { fmtEta, fmtDate, fmtTimeActive, STATE_COLOR_CLASSES }
