'use client'

import { useState, useEffect, useCallback } from 'react'
import type { QbtTorrentProperties, QbtFileInfo, QbtTrackerInfo, QbtPeerInfo } from '@/types/torrent'
import { formatBytes } from '@/lib/utils'

type DetailTab = 'overview' | 'files' | 'trackers' | 'peers'

function fmt(bytes: number) { return formatBytes(bytes) }
function fmtSpeed(bytes: number) { return bytes > 0 ? `${fmt(bytes)}/s` : '0 B/s' }

const TRACKER_STATUS = ['Disabled', 'Not contacted', 'Working', 'Updating', 'Not working']

interface Props {
  hash: string
  colSpan: number
  onClose: () => void
}

export function TorrentDetailPanel({ hash, colSpan, onClose }: Props) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [props, setProps] = useState<QbtTorrentProperties | null>(null)
  const [files, setFiles] = useState<QbtFileInfo[]>([])
  const [trackers, setTrackers] = useState<QbtTrackerInfo[]>([])
  const [peers, setPeers] = useState<QbtPeerInfo[]>([])
  const [loading, setLoading] = useState(true)
  // Bug 5: distinguish "the client returned an empty list" from "the fetch failed". A silent "0"
  // sent us chasing a non-bug for a round; now a failed fetch shows an explicit error instead.
  const [error, setError] = useState<string | null>(null)

  const fetchOverview = useCallback(async () => {
    try {
      const [propsRes, filesRes, trackersRes] = await Promise.all([
        fetch(`/api/qbit/torrents/properties?hash=${hash}`),
        fetch(`/api/qbit/torrents/files?hash=${hash}`),
        fetch(`/api/qbit/torrents/trackers?hash=${hash}`),
      ])
      if (!filesRes.ok) throw new Error(`files HTTP ${filesRes.status}`)
      // A successful response that isn't JSON (e.g. the login HTML shell on an expired session)
      // throws here and surfaces as an error rather than rendering a misleading empty list.
      const filesJson = await filesRes.json() as QbtFileInfo[]
      setFiles(Array.isArray(filesJson) ? filesJson : [])
      if (propsRes.ok) setProps(await propsRes.json() as QbtTorrentProperties)
      if (trackersRes.ok) setTrackers(await trackersRes.json() as QbtTrackerInfo[])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load torrent detail')
    }
  }, [hash])

  const fetchPeers = useCallback(async () => {
    const res = await fetch(`/api/qbit/sync/torrentPeers?hash=${hash}`)
    if (res.ok) {
      const data = await res.json() as { peers?: Record<string, QbtPeerInfo> }
      setPeers(Object.values(data.peers ?? {}))
    }
  }, [hash])

  useEffect(() => {
    setLoading(true)
    setTab('overview')
    setProps(null)
    setFiles([])
    setTrackers([])
    setPeers([])
    setError(null)
    fetchOverview().finally(() => setLoading(false))
  }, [fetchOverview])

  useEffect(() => {
    if (tab === 'peers') fetchPeers()
  }, [tab, fetchPeers])

  useEffect(() => {
    const id = setInterval(() => {
      if (tab === 'overview' || tab === 'files') fetchOverview()
      else if (tab === 'peers') fetchPeers()
    }, 2000)
    return () => clearInterval(id)
  }, [tab, fetchOverview, fetchPeers])

  async function setPriority(fileIndex: number, priority: 0 | 1 | 6 | 7) {
    await fetch('/api/qbit/torrents/filePrio', {
      method: 'POST',
      body: new URLSearchParams({ hash, id: String(fileIndex), priority: String(priority) }),
    })
    setFiles(prev => prev.map(f => f.index === fileIndex ? { ...f, priority } : f))
  }

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div className="border-t border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/60">
          {/* Tab bar */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-1.5 dark:border-gray-700">
            <div className="flex gap-0.5">
              {(['overview', 'files', 'trackers', 'peers'] as DetailTab[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    tab === t
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700'
                  }`}
                >
                  {t === 'files' ? `Files (${files.length})` : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs"
              aria-label="Close detail panel"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="max-h-72 overflow-y-auto p-4">
            {loading && <p className="text-xs text-gray-400">Loading…</p>}

            {/* Fetch error — distinct from a genuinely-empty list (Bug 5). */}
            {!loading && error && (
              <p className="rounded bg-red-900/30 px-3 py-2 text-xs text-red-300">
                Couldn’t load torrent detail from the client: {error}. Retrying…
              </p>
            )}

            {/* Overview */}
            {!loading && !error && tab === 'overview' && props && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-4">
                {([
                  ['Download speed', fmtSpeed(props.dl_speed)],
                  ['Upload speed', fmtSpeed(props.up_speed)],
                  ['Seeds', `${props.seeds} / ${props.seeds_total}`],
                  ['Peers', `${props.peers} / ${props.peers_total}`],
                  ['Connections', `${props.nb_connections} / ${props.nb_connections_limit}`],
                  ['Share ratio', props.share_ratio.toFixed(3)],
                  ['Downloaded', fmt(props.total_downloaded)],
                  ['Uploaded', fmt(props.total_uploaded)],
                  ['Wasted', fmt(props.total_wasted)],
                  ['Total size', fmt(props.total_size)],
                  ['Pieces', `${props.pieces_have} / ${props.pieces_num}`],
                  ['Piece size', props.piece_size > 0 ? fmt(props.piece_size) : '—'],
                  ['Avg DL speed', fmtSpeed(props.dl_speed_avg)],
                  ['Avg UL speed', fmtSpeed(props.up_speed_avg)],
                  ['Private', props.is_private ? 'Yes' : 'No'],
                  ['Save path', props.save_path],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-500">{label}</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100 break-all">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Files */}
            {!loading && !error && tab === 'files' && (
              files.length === 0
                ? <p className="text-xs text-gray-400">This torrent has no files reported by the client.</p>
                : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left">
                        <th className="pb-1.5 pr-4 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Name</th>
                        <th className="pb-1.5 pr-4 text-[10px] uppercase tracking-wide text-gray-500 font-medium whitespace-nowrap">Size</th>
                        <th className="pb-1.5 pr-4 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Progress</th>
                        <th className="pb-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Priority</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map(f => {
                        const filename = f.name.split('/').pop() ?? f.name
                        const folder = f.name.includes('/') ? f.name.split('/').slice(0, -1).join('/') + '/' : null
                        return (
                          <tr
                            key={f.index}
                            className={`border-t border-gray-100 dark:border-gray-800 ${f.priority === 0 ? 'opacity-40' : ''}`}
                          >
                            <td className="py-1.5 pr-4 max-w-xs">
                              <span className="block truncate text-gray-900 dark:text-gray-100" title={f.name}>
                                {filename}
                              </span>
                              {folder && <span className="block truncate text-gray-400">{folder}</span>}
                            </td>
                            <td className="py-1.5 pr-4 whitespace-nowrap text-gray-500">{fmt(f.size)}</td>
                            <td className="py-1.5 pr-4">
                              <div className="flex items-center gap-1.5">
                                <div className="h-1.5 w-20 rounded-full bg-gray-200 dark:bg-gray-700">
                                  <div
                                    className="h-1.5 rounded-full bg-blue-500"
                                    style={{ width: `${Math.min(f.progress * 100, 100).toFixed(0)}%` }}
                                  />
                                </div>
                                <span className="text-gray-500">{(f.progress * 100).toFixed(0)}%</span>
                              </div>
                            </td>
                            <td className="py-1.5">
                              <select
                                value={f.priority}
                                onChange={e => void setPriority(f.index, Number(e.target.value) as 0 | 1 | 6 | 7)}
                                className="rounded border border-gray-300 bg-white px-1 py-0.5 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                              >
                                <option value={0}>Skip</option>
                                <option value={1}>Normal</option>
                                <option value={6}>High</option>
                                <option value={7}>Max</option>
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
            )}

            {/* Trackers */}
            {!loading && !error && tab === 'trackers' && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Tracker</th>
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Status</th>
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Seeds</th>
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Peers</th>
                    <th className="pb-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {trackers
                    .filter(t => !t.url.startsWith('** ['))
                    .map((t, i) => (
                      <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                        <td className="py-1.5 pr-3 max-w-xs">
                          <span className="block truncate text-gray-900 dark:text-gray-100" title={t.url}>{t.url}</span>
                        </td>
                        <td className="py-1.5 pr-3">
                          <span className={`rounded px-1.5 py-0.5 font-medium ${
                            t.status === 2 ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : t.status === 4 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
                          }`}>
                            {TRACKER_STATUS[t.status] ?? 'Unknown'}
                          </span>
                        </td>
                        <td className="py-1.5 pr-3 text-gray-500">{t.num_seeds < 0 ? '—' : t.num_seeds}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{t.num_peers < 0 ? '—' : t.num_peers}</td>
                        <td className="py-1.5 text-gray-400 max-w-xs truncate" title={t.msg}>{t.msg || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}

            {/* Peers */}
            {tab === 'peers' && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">IP</th>
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Client</th>
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Progress</th>
                    <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Down</th>
                    <th className="pb-1.5 text-[10px] uppercase tracking-wide text-gray-500 font-medium">Up</th>
                  </tr>
                </thead>
                <tbody>
                  {peers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-gray-400">No peers connected</td>
                    </tr>
                  ) : peers.map((p, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      <td className="py-1.5 pr-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">{p.ip}:{p.port}</td>
                      <td className="py-1.5 pr-3 text-gray-500 max-w-xs truncate">{p.client || '—'}</td>
                      <td className="py-1.5 pr-3 text-gray-500">{(p.progress * 100).toFixed(0)}%</td>
                      <td className="py-1.5 pr-3 text-blue-600 dark:text-blue-400">{fmtSpeed(p.dl_speed)}</td>
                      <td className="py-1.5 text-green-600 dark:text-green-400">{fmtSpeed(p.up_speed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}
