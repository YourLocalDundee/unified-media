// Server-side qBittorrent API helpers.
// All functions call qbitFetch, which handles SID cookie auth and automatic
// re-auth on 403. These must only be called from Next.js API routes or server
// components — never imported into client components.
import { qbitFetch } from './session'
import type {
  AddTorrentParams,
  MainData,
  Torrent,
  TorrentFile,
  TransferInfo,
} from './types'

// ---------------------------------------------------------------------------
// Read operations
// ---------------------------------------------------------------------------

/**
 * Get the full torrent list with optional state filter.
 */
export async function getTorrents(
  filter:
    | 'all'
    | 'downloading'
    | 'completed'
    | 'active'
    | 'paused'
    | 'stopped' = 'all'
): Promise<Torrent[]> {
  return qbitFetch<Torrent[]>(`/api/v2/torrents/info?filter=${filter}`)
}

/**
 * Get global transfer info (speeds, totals, connection status).
 */
export async function getTransferInfo(): Promise<TransferInfo> {
  return qbitFetch<TransferInfo>('/api/v2/transfer/info')
}

/**
 * Get the incremental sync payload. Pass rid=0 (or omit) for a full update.
 * Subsequent calls should pass the rid from the previous response.
 */
export async function getMainData(rid = 0): Promise<MainData> {
  return qbitFetch<MainData>(`/api/v2/sync/maindata?rid=${rid}`)
}

/**
 * Get the file list for a single torrent.
 */
export async function getTorrentFiles(hash: string): Promise<TorrentFile[]> {
  return qbitFetch<TorrentFile[]>(`/api/v2/torrents/files?hash=${hash}`)
}

// ---------------------------------------------------------------------------
// Torrent actions
// ---------------------------------------------------------------------------

/**
 * Stop (pause) torrents. Uses the qBit 5+ /stop endpoint.
 * Multiple hashes are joined with | (pipe). Pass 'all' to stop everything.
 * Note: qBit v4 used /torrents/pause — this codebase targets v5.
 */
export async function pauseTorrents(hashes: string[]): Promise<void> {
  await qbitFetch<string>('/api/v2/torrents/stop', {
    method: 'POST',
    body: new URLSearchParams({ hashes: hashes.join('|') }),
  })
}

/**
 * Start (resume) torrents. Uses the qBit 5+ /start endpoint.
 */
export async function resumeTorrents(hashes: string[]): Promise<void> {
  await qbitFetch<string>('/api/v2/torrents/start', {
    method: 'POST',
    body: new URLSearchParams({ hashes: hashes.join('|') }),
  })
}

/**
 * Delete torrents, optionally removing downloaded files from disk.
 */
export async function deleteTorrents(
  hashes: string[],
  deleteFiles = false
): Promise<void> {
  await qbitFetch<string>('/api/v2/torrents/delete', {
    method: 'POST',
    body: new URLSearchParams({
      hashes: hashes.join('|'),
      deleteFiles: String(deleteFiles),
    }),
  })
}

/**
 * Add a torrent by URL or magnet link.
 * Multiple URLs should be newline-separated in params.urls.
 */
export async function addTorrent(params: AddTorrentParams): Promise<void> {
  const body = new URLSearchParams()

  if (params.urls !== undefined) body.set('urls', params.urls)
  if (params.savepath !== undefined) body.set('savepath', params.savepath)
  if (params.category !== undefined) body.set('category', params.category)
  if (params.tags !== undefined) body.set('tags', params.tags)
  if (params.rename !== undefined) body.set('rename', params.rename)
  // Support both qBit 4 (paused) and qBit 5 (stopped)
  if (params.paused !== undefined) body.set('paused', String(params.paused))
  if (params.stopped !== undefined) body.set('stopped', String(params.stopped))
  if (params.firstLastPiecePrio !== undefined)
    body.set('firstLastPiecePrio', String(params.firstLastPiecePrio))
  if (params.sequentialDownload !== undefined)
    body.set('sequentialDownload', String(params.sequentialDownload))

  await qbitFetch<string>('/api/v2/torrents/add', { method: 'POST', body })
}

/**
 * Force a hash recheck on the given torrents.
 */
export async function recheckTorrents(hashes: string[]): Promise<void> {
  await qbitFetch<string>('/api/v2/torrents/recheck', {
    method: 'POST',
    body: new URLSearchParams({ hashes: hashes.join('|') }),
  })
}
