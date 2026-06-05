/**
 * Slide-in detail panel for the /downloads page.
 * Renders a 6-tab view (Overview, Files, Trackers, Peers, Speed, Options) for
 * the selected torrent. Each tab fetches its own data via React Query so that
 * switching tabs does not block the other tabs from being visible.
 *
 * Layout behavior:
 *   - On large screens (lg+): sits as a persistent right-side column (1/3 width)
 *   - On smaller screens: slides in from the right as a full-screen overlay with
 *     a dark backdrop dismissible by clicking outside the panel.
 */
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { formatBytes } from '@/lib/utils'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import type { Torrent } from '@/lib/qbittorrent/types'
import type { QbtTorrentProperties, QbtTrackerInfo, QbtPeerInfo, QbtFileInfo } from '@/types/torrent'
import { fmtDate } from './TorrentRow'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

async function qbitPost(path: string, body: URLSearchParams): Promise<void> {
  await fetch(`/api/qbit/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type DetailTab = 'overview' | 'files' | 'trackers' | 'peers' | 'speed' | 'options'

const TABS: { id: DetailTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'files', label: 'Files' },
  { id: 'trackers', label: 'Trackers' },
  { id: 'peers', label: 'Peers' },
  { id: 'speed', label: 'Speed' },
  { id: 'options', label: 'Options' },
]

// ---------------------------------------------------------------------------
// Overview Tab
// ---------------------------------------------------------------------------

function OverviewTab({ torrent }: { torrent: Torrent }) {
  const { data: props } = useQuery<QbtTorrentProperties>({
    queryKey: ['torrent-props', torrent.hash],
    queryFn: () => fetch(`/api/qbit/torrents/properties?hash=${torrent.hash}`).then((r) => r.json()),
    refetchInterval: 5000,
  })

  const copyHash = useCallback(() => {
    navigator.clipboard.writeText(torrent.hash).catch(() => {})
  }, [torrent.hash])

  if (!props) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: 'Hash',
      value: (
        <button
          onClick={copyHash}
          className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400 break-all"
          title="Click to copy full hash"
        >
          {torrent.hash.slice(0, 16)}…
        </button>
      ),
    },
    { label: 'Save Path', value: <span className="break-all text-xs">{props.save_path}</span> },
    { label: 'Total Size', value: formatBytes(props.total_size) },
    { label: 'Downloaded', value: formatBytes(props.total_downloaded) },
    { label: 'Uploaded', value: formatBytes(props.total_uploaded) },
    { label: 'Ratio', value: props.share_ratio.toFixed(3) },
    { label: 'Added On', value: fmtDate(props.addition_date, 'absolute') },
    { label: 'Completed On', value: props.completion_date > 0 ? fmtDate(props.completion_date, 'absolute') : '—' },
    { label: 'Created By', value: props.created_by || '—' },
    { label: 'Comment', value: props.comment || '—' },
    { label: 'Private', value: props.is_private ? 'Yes' : 'No' },
    { label: 'Pieces', value: `${props.pieces_have} / ${props.pieces_num}` },
    { label: 'Seeds', value: `${props.seeds} (${props.seeds_total} total)` },
    { label: 'Peers', value: `${props.peers} (${props.peers_total} total)` },
    { label: 'Avg DL Speed', value: formatBytes(props.dl_speed_avg) + '/s' },
    { label: 'Avg UL Speed', value: formatBytes(props.up_speed_avg) + '/s' },
    { label: 'Active Time', value: fmtSeconds(props.time_elapsed) },
    { label: 'Seeding Time', value: fmtSeconds(props.seeding_time) },
  ]

  return (
    <dl className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex gap-2 py-2 px-1">
          <dt className="w-32 shrink-0 text-xs font-medium text-gray-500 dark:text-gray-400">{label}</dt>
          <dd className="text-sm text-gray-900 dark:text-gray-100 min-w-0 flex-1">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// Files Tab
// ---------------------------------------------------------------------------

interface FileNode {
  name: string
  path: string
  isDir: boolean
  children: Record<string, FileNode>
  file?: QbtFileInfo
}

// Converts the flat file list from UMT (paths like "Folder/sub/file.mkv")
// into a nested tree structure for the collapsible file explorer.
function buildFileTree(files: QbtFileInfo[]): FileNode {
  const root: FileNode = { name: '', path: '', isDir: true, children: {} }
  for (const f of files) {
    const parts = f.name.split('/')
    let node = root
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      if (!node.children[part]) {
        node.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join('/'),
          isDir: !isLast,
          children: {},
          file: isLast ? f : undefined,
        }
      }
      node = node.children[part]
    }
  }
  return root
}

const PRIORITY_LABELS: Record<number, string> = {
  0: 'Skip',
  1: 'Normal',
  6: 'High',
  7: 'Maximum',
}

function FileNodeRow({
  node,
  hash,
  depth = 0,
}: {
  node: FileNode
  hash: string
  depth?: number
}) {
  const [expanded, setExpanded] = useState(true)
  const qc = useQueryClient()

  const setPrio = useCallback(
    async (idx: number, priority: number) => {
      await qbitPost('torrents/filePrio', new URLSearchParams({ hash, id: String(idx), priority: String(priority) }))
      qc.invalidateQueries({ queryKey: ['torrent-files', hash] })
    },
    [hash, qc]
  )

  const children = Object.values(node.children)

  return (
    <>
      {node.isDir && node.name ? (
        <div
          className="flex cursor-pointer items-center gap-1 py-1 px-1 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
          onClick={() => setExpanded((v) => !v)}
        >
          <svg
            className={`h-3 w-3 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.168 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
              clipRule="evenodd"
            />
          </svg>
          <svg className="h-4 w-4 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 0 1 2-2h5l2 2h5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Z" />
          </svg>
          <span className="text-sm text-gray-800 dark:text-gray-200">{node.name}</span>
        </div>
      ) : null}

      {node.file && (
        <div
          className="flex items-center gap-2 py-1.5 border-b border-gray-50 dark:border-gray-800/50"
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          <svg className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm text-gray-800 dark:text-gray-200">{node.name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <div className="h-1 flex-1 rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  className="h-1 rounded-full bg-blue-500"
                  style={{ width: `${(node.file.progress * 100).toFixed(1)}%` }}
                />
              </div>
              <span className="text-xs tabular-nums text-gray-400">
                {(node.file.progress * 100).toFixed(1)}%
              </span>
              <span className="text-xs text-gray-400">{formatBytes(node.file.size)}</span>
            </div>
          </div>
          <select
            value={node.file.priority}
            onChange={(e) => setPrio(node.file!.index, Number(e.target.value))}
            className="text-xs rounded border border-gray-200 bg-white px-1 py-0.5 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            {Object.entries(PRIORITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      )}

      {node.isDir && expanded && children.map((child) => (
        <FileNodeRow key={child.path} node={child} hash={hash} depth={depth + 1} />
      ))}
    </>
  )
}

function FilesTab({ hash }: { hash: string }) {
  const { data: files, isLoading } = useQuery<QbtFileInfo[]>({
    queryKey: ['torrent-files', hash],
    queryFn: () => fetch(`/api/qbit/torrents/files?hash=${hash}`).then((r) => r.json()),
    refetchInterval: 5000,
  })

  if (isLoading) return <div className="py-6 text-center text-sm text-gray-400">Loading files…</div>
  if (!files?.length) return <div className="py-6 text-center text-sm text-gray-400">No files</div>

  const tree = buildFileTree(files)
  const children = Object.values(tree.children)

  return (
    <div className="text-sm">
      {children.map((child) => (
        <FileNodeRow key={child.path} node={child} hash={hash} depth={0} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Trackers Tab
// ---------------------------------------------------------------------------

const TRACKER_STATUS: Record<number, { label: string; cls: string }> = {
  0: { label: 'Disabled', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  1: { label: 'Not contacted', cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
  2: { label: 'Working', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  3: { label: 'Updating', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  4: { label: 'Not working', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
}

function TrackersTab({ hash }: { hash: string }) {
  const qc = useQueryClient()
  const [addUrl, setAddUrl] = useState('')

  const { data: trackers, isLoading } = useQuery<QbtTrackerInfo[]>({
    queryKey: ['torrent-trackers', hash],
    queryFn: () => fetch(`/api/qbit/torrents/trackers?hash=${hash}`).then((r) => r.json()),
    refetchInterval: 5000,
  })

  const addTracker = useCallback(async () => {
    if (!addUrl.trim()) return
    await qbitPost('torrents/addTrackers', new URLSearchParams({ hash, urls: addUrl.trim() }))
    setAddUrl('')
    qc.invalidateQueries({ queryKey: ['torrent-trackers', hash] })
  }, [addUrl, hash, qc])

  const removeTracker = useCallback(async (url: string) => {
    await qbitPost('torrents/removeTrackers', new URLSearchParams({ hash, urls: url }))
    qc.invalidateQueries({ queryKey: ['torrent-trackers', hash] })
  }, [hash, qc])

  if (isLoading) return <div className="py-6 text-center text-sm text-gray-400">Loading trackers…</div>

  // qBittorrent prefixes internal pseudo-trackers (DHT, PeX, LSD) with "** ["; hide them
  const displayTrackers = (trackers ?? []).filter((t) => !t.url.startsWith('** [') )

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
              <th className="pb-1 font-medium text-gray-500">URL</th>
              <th className="pb-1 font-medium text-gray-500">Status</th>
              <th className="pb-1 font-medium text-gray-500 text-right">Tier</th>
              <th className="pb-1 font-medium text-gray-500 text-right">Seeds</th>
              <th className="pb-1 font-medium text-gray-500 text-right">Peers</th>
              <th className="pb-1 font-medium text-gray-500 text-right">DL'd</th>
              <th className="pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {displayTrackers.map((t, i) => {
              const st = TRACKER_STATUS[t.status] ?? TRACKER_STATUS[1]
              return (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50">
                  <td className="py-1.5 max-w-[8rem] truncate text-gray-700 dark:text-gray-300" title={t.url}>
                    {t.url}
                  </td>
                  <td className="py-1.5">
                    <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-gray-500">{t.tier >= 0 ? t.tier : '—'}</td>
                  <td className="py-1.5 text-right text-gray-500">{t.num_seeds}</td>
                  <td className="py-1.5 text-right text-gray-500">{t.num_leeches}</td>
                  <td className="py-1.5 text-right text-gray-500">{t.num_downloaded}</td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => removeTracker(t.url)}
                      className="text-red-400 hover:text-red-600"
                      title="Remove tracker"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )
            })}
            {displayTrackers.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-gray-400">No trackers</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add tracker */}
      <div className="flex gap-2">
        <input
          type="text"
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          placeholder="https://tracker.example.com/announce"
          className="flex-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
        <button
          onClick={addTracker}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peers Tab
// ---------------------------------------------------------------------------

function PeersTab({ hash }: { hash: string }) {
  const qc = useQueryClient()

  const { data, isLoading, refetch } = useQuery<{ peers: Record<string, QbtPeerInfo> }>({
    queryKey: ['torrent-peers', hash],
    queryFn: () =>
      fetch(`/api/qbit/sync/torrentPeers?hash=${hash}`).then((r) => r.json()),
    // Peer data is expensive to fetch; don't auto-refresh — the user clicks "Refresh" manually
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  const banPeer = useCallback(async (ip: string, port: number) => {
    await qbitPost('transfer/banPeers', new URLSearchParams({ peers: `${ip}:${port}` }))
    qc.invalidateQueries({ queryKey: ['torrent-peers', hash] })
  }, [hash, qc])

  const peers = data?.peers ? Object.values(data.peers) : []

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{peers.length} peers</span>
        <button
          onClick={() => refetch()}
          className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      {isLoading ? (
        <div className="py-4 text-center text-sm text-gray-400">Loading peers…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
                <th className="pb-1 font-medium text-gray-500">IP</th>
                <th className="pb-1 font-medium text-gray-500">Port</th>
                <th className="pb-1 font-medium text-gray-500">Client</th>
                <th className="pb-1 font-medium text-gray-500">Flags</th>
                <th className="pb-1 font-medium text-gray-500 text-right">Progress</th>
                <th className="pb-1 font-medium text-gray-500 text-right">DL</th>
                <th className="pb-1 font-medium text-gray-500 text-right">UL</th>
                <th className="pb-1"></th>
              </tr>
            </thead>
            <tbody>
              {peers.map((p, i) => (
                <tr key={i} className="border-b border-gray-50 dark:border-gray-800/50">
                  <td className="py-1.5 font-mono text-gray-700 dark:text-gray-300">{p.ip}</td>
                  <td className="py-1.5 text-gray-500">{p.port}</td>
                  <td className="py-1.5 max-w-[6rem] truncate text-gray-600 dark:text-gray-400">{p.client || '—'}</td>
                  <td className="py-1.5 font-mono text-gray-500">{p.flags}</td>
                  <td className="py-1.5 text-right text-gray-500">{(p.progress * 100).toFixed(0)}%</td>
                  <td className="py-1.5 text-right text-blue-600 dark:text-blue-400">
                    {p.dl_speed > 0 ? formatBytes(p.dl_speed) + '/s' : '—'}
                  </td>
                  <td className="py-1.5 text-right text-green-600 dark:text-green-400">
                    {p.up_speed > 0 ? formatBytes(p.up_speed) + '/s' : '—'}
                  </td>
                  <td className="py-1.5 text-right">
                    <button
                      onClick={() => banPeer(p.ip, p.port)}
                      className="text-red-400 hover:text-red-600 text-xs"
                      title="Ban peer"
                    >
                      Ban
                    </button>
                  </td>
                </tr>
              ))}
              {peers.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-gray-400">No peers</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed Chart Tab
// ---------------------------------------------------------------------------

interface SpeedPoint {
  t: number
  dl: number
  ul: number
}

function SpeedChartTab({ torrent }: { torrent: Torrent }) {
  const [chartData, setChartData] = useState<SpeedPoint[]>([])
  const prevRef = useRef<{ dl: number; ul: number } | null>(null)

  useEffect(() => {
    const curr = { dl: torrent.dlspeed, ul: torrent.upspeed }
    // Skip duplicate data points — torrent poll may fire more often than speed changes
    if (
      prevRef.current &&
      prevRef.current.dl === curr.dl &&
      prevRef.current.ul === curr.ul
    ) return

    prevRef.current = curr
    // Keep at most 60 samples (~2 minutes at 2s poll rate)
    setChartData((prev) => {
      const next = [...prev, { t: Date.now(), dl: curr.dl, ul: curr.ul }]
      return next.slice(-60)
    })
  }, [torrent.dlspeed, torrent.upspeed])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-4 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-blue-500" />
          <span className="text-gray-600 dark:text-gray-400">Download</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-green-500" />
          <span className="text-gray-600 dark:text-gray-400">Upload</span>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <XAxis dataKey="t" hide />
          <YAxis tickFormatter={(v: number) => formatBytes(v) + '/s'} width={70} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(v) => formatBytes(Number(v ?? 0)) + '/s'}
            labelFormatter={() => ''}
            contentStyle={{ fontSize: 12 }}
          />
          <Line dataKey="dl" name="Download" stroke="#3b82f6" dot={false} isAnimationActive={false} strokeWidth={1.5} />
          <Line dataKey="ul" name="Upload" stroke="#22c55e" dot={false} isAnimationActive={false} strokeWidth={1.5} />
        </LineChart>
      </ResponsiveContainer>
      {chartData.length === 0 && (
        <p className="text-center text-sm text-gray-400">Collecting data…</p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Options Tab
// ---------------------------------------------------------------------------

function OptionsTab({ torrent }: { torrent: Torrent }) {
  const qc = useQueryClient()
  const [dlLimit, setDlLimit] = useState(0)
  const [ulLimit, setUlLimit] = useState(0)
  const [ratioEnabled, setRatioEnabled] = useState(false)
  const [ratioLimit, setRatioLimit] = useState(0)

  // Refresh torrent list after changes
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['torrents'] })
  }, [qc])

  const post = useCallback(
    async (path: string, body: URLSearchParams) => {
      await qbitPost(path, body)
      invalidate()
    },
    [invalidate]
  )

  // qBittorrent expects limits in bytes/s; UI input is in KB/s so multiply by 1024
  const setDlLimitHandler = useCallback(async () => {
    await post('torrents/setDownloadLimit', new URLSearchParams({ hashes: torrent.hash, limit: String(dlLimit * 1024) }))
  }, [post, torrent.hash, dlLimit])

  const setUlLimitHandler = useCallback(async () => {
    await post('torrents/setUploadLimit', new URLSearchParams({ hashes: torrent.hash, limit: String(ulLimit * 1024) }))
  }, [post, torrent.hash, ulLimit])

  const setShareLimits = useCallback(async () => {
    await post(
      'torrents/setShareLimits',
      new URLSearchParams({
        hashes: torrent.hash,
        ratioLimit: ratioEnabled ? String(ratioLimit) : '-1',
        seedingTimeLimit: String(torrent.seeding_time ?? -1),
      })
    )
  }, [post, torrent.hash, ratioEnabled, ratioLimit, torrent.seeding_time])

  const toggleOption = useCallback(
    async (action: string, body: URLSearchParams) => {
      await post(action, body)
    },
    [post]
  )

  const Toggle = ({
    label,
    checked,
    onToggle,
  }: {
    label: string
    checked: boolean
    onToggle: () => void
  }) => (
    <label className="flex cursor-pointer items-center justify-between rounded px-1 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
      <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
      <button
        type="button"
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
          checked ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-1'
          }`}
        />
      </button>
    </label>
  )

  return (
    <div className="flex flex-col gap-4">
      {/* DL Limit */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Download Limit (KB/s, 0 = unlimited)
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={dlLimit}
            onChange={(e) => setDlLimit(Number(e.target.value))}
            className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <button onClick={setDlLimitHandler} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
            Apply
          </button>
        </div>
      </div>

      {/* UL Limit */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Upload Limit (KB/s, 0 = unlimited)
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            value={ulLimit}
            onChange={(e) => setUlLimit(Number(e.target.value))}
            className="w-28 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <button onClick={setUlLimitHandler} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
            Apply
          </button>
        </div>
      </div>

      {/* Ratio limit */}
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
          Ratio Limit
        </label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={ratioEnabled}
            onChange={(e) => setRatioEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600"
          />
          <input
            type="number"
            min={0}
            step={0.1}
            value={ratioLimit}
            disabled={!ratioEnabled}
            onChange={(e) => setRatioLimit(Number(e.target.value))}
            className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          <button onClick={setShareLimits} className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
            Apply
          </button>
        </div>
      </div>

      {/* Toggles */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
        <Toggle
          label="Super Seeding"
          checked={torrent.super_seeding ?? false}
          onToggle={() =>
            toggleOption('torrents/setSuperSeeding', new URLSearchParams({ hashes: torrent.hash, value: String(!(torrent.super_seeding ?? false)) }))
          }
        />
        <Toggle
          label="Force Start"
          checked={torrent.force_start ?? false}
          onToggle={() =>
            toggleOption('torrents/setForceStart', new URLSearchParams({ hashes: torrent.hash, value: String(!(torrent.force_start ?? false)) }))
          }
        />
        <Toggle
          label="Auto TMM"
          checked={torrent.auto_tmm}
          onToggle={() =>
            toggleOption('torrents/setAutoManagement', new URLSearchParams({ hashes: torrent.hash, enable: String(!torrent.auto_tmm) }))
          }
        />
        <Toggle
          label="Sequential Download"
          checked={torrent.seq_dl ?? false}
          onToggle={() =>
            toggleOption('torrents/toggleSequentialDownload', new URLSearchParams({ hashes: torrent.hash }))
          }
        />
        <Toggle
          label="First/Last Piece Priority"
          checked={torrent.f_l_piece_prio ?? false}
          onToggle={() =>
            toggleOption('torrents/toggleFirstLastPiecePrio', new URLSearchParams({ hashes: torrent.hash }))
          }
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DetailPanel
// ---------------------------------------------------------------------------

interface DetailPanelProps {
  torrent: Torrent | null
  onClose: () => void
}

export default function DetailPanel({ torrent, onClose }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')

  // Reset to the Overview tab whenever a different torrent is selected so
  // the user doesn't land on e.g. the Peers tab for a torrent they just clicked.
  useEffect(() => {
    if (torrent) setActiveTab('overview')
  }, [torrent?.hash])

  const isOpen = torrent !== null

  return (
    <>
      {/* Mobile / tablet overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-40 flex h-full w-full flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-300 dark:border-gray-700 dark:bg-gray-900 lg:relative lg:z-auto lg:h-auto lg:w-1/3 lg:min-w-[22rem] lg:shadow-none ${
          isOpen ? 'translate-x-0' : 'translate-x-full lg:hidden'
        }`}
      >
        {torrent && (
          <>
            {/* Panel header */}
            <div className="flex shrink-0 items-start justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100" title={torrent.name}>
                  {torrent.name}
                </p>
              </div>
              <button
                onClick={onClose}
                className="shrink-0 rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            {/* Tabs */}
            <div className="flex shrink-0 overflow-x-auto border-b border-gray-200 dark:border-gray-700">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'overview' && <OverviewTab torrent={torrent} />}
              {activeTab === 'files' && <FilesTab hash={torrent.hash} />}
              {activeTab === 'trackers' && <TrackersTab hash={torrent.hash} />}
              {activeTab === 'peers' && <PeersTab hash={torrent.hash} />}
              {activeTab === 'speed' && <SpeedChartTab torrent={torrent} />}
              {activeTab === 'options' && <OptionsTab torrent={torrent} />}
            </div>
          </>
        )}
      </aside>
    </>
  )
}
