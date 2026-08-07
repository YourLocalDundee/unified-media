// Transmission implementation of the DownloadClient interface.
//
// Transmission's RPC is a single POST endpoint (`/transmission/rpc`) speaking JSON
// `{ method, arguments, tag }`. Its CSRF protection is the X-Transmission-Session-Id
// header: the first request after a (re)start returns HTTP 409 with the current id in
// the `X-Transmission-Session-Id` response header; we capture it and retry. Optional
// HTTP Basic auth is supported when a username is configured.
//
// Transmission has no incremental-sync endpoint, so pollMaindata() returns a full
// snapshot each call (isFullUpdate = true, removed = []) — the maindata consumer
// replaces its state wholesale on a full update, so this is correct, just less terse
// than qBittorrent's rid-based deltas.

// This file runs only on the server (used only in API routes / server actions)

import type {
  AddTorrentPayload,
  DownloadClient,
  MaindataResult,
  Torrent,
  TorrentFilter,
  TorrentState,
  TransferInfo,
} from './types'
import { TorrentState as TS } from './types'

const RPC_PATH = '/transmission/rpc'

// Transmission status enum (libtransmission). 0 stopped, 1 check-wait, 2 checking,
// 3 download-wait, 4 downloading, 5 seed-wait, 6 seeding.
function mapState(status: number | undefined): TorrentState {
  switch (status) {
    case 0: return TS.Paused      // stopped by user
    case 1: return TS.Queued      // queued to verify
    case 2: return TS.Checking
    case 3: return TS.Queued      // queued to download
    case 4: return TS.Downloading
    case 5: return TS.Queued      // queued to seed
    case 6: return TS.Uploading
    default: return TS.Unknown
  }
}

interface RawTransmissionTorrent {
  hashString?: string
  name?: string
  status?: number
  percentDone?: number       // 0.0-1.0
  rateDownload?: number       // bytes/s
  rateUpload?: number         // bytes/s
  totalSize?: number          // bytes
  downloadedEver?: number     // bytes
  eta?: number                // seconds, -1/-2 = unknown
  downloadDir?: string
  addedDate?: number          // unix seconds
}

// Fields requested on every torrent-get. Kept minimal — only what the Torrent shape needs.
const TORRENT_FIELDS = [
  'hashString', 'name', 'status', 'percentDone', 'rateDownload', 'rateUpload',
  'totalSize', 'downloadedEver', 'eta', 'downloadDir', 'addedDate',
]

function normalise(raw: RawTransmissionTorrent): Torrent {
  return {
    hash: (raw.hashString ?? '').toLowerCase(),
    name: raw.name ?? '',
    state: mapState(raw.status),
    progress: raw.percentDone ?? 0,
    dlspeed: raw.rateDownload ?? 0,
    upspeed: raw.rateUpload ?? 0,
    size: raw.totalSize ?? 0,
    downloaded: raw.downloadedEver ?? 0,
    eta: raw.eta != null && raw.eta >= 0 ? raw.eta : -1,
    category: '',                 // Transmission "labels" are multi-valued; not mapped to a single category
    savePath: raw.downloadDir ?? '',
    addedOn: raw.addedDate ?? 0,
  }
}

// Client-side status filter (Transmission's torrent-get has no server-side status filter).
function matchesFilter(t: Torrent, status: NonNullable<TorrentFilter['status']>): boolean {
  switch (status) {
    case 'all': return true
    case 'downloading': return t.state === TS.Downloading
    case 'completed': return t.progress >= 1
    case 'active': return t.dlspeed > 0 || t.upspeed > 0
    case 'paused':
    case 'stopped': return t.state === TS.Paused || t.state === TS.Stopped
    default: return true
  }
}

export class TransmissionClient implements DownloadClient {
  private readonly url: string
  private readonly auth?: string
  private sessionId = ''

  constructor(url: string, username?: string, password?: string) {
    this.url = url.replace(/\/$/, '')
    if (username) {
      this.auth = 'Basic ' + Buffer.from(`${username}:${password ?? ''}`).toString('base64')
    }
  }

  private async rpc<T = Record<string, unknown>>(
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const doFetch = () =>
      fetch(`${this.url}${RPC_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Transmission-Session-Id': this.sessionId,
          ...(this.auth ? { Authorization: this.auth } : {}),
        },
        body: JSON.stringify({ method, arguments: args }),
        cache: 'no-store',
      })

    let res = await doFetch()
    if (res.status === 409) {
      // CSRF token rotated/missing — adopt the server-supplied id and retry once.
      this.sessionId = res.headers.get('X-Transmission-Session-Id') ?? ''
      res = await doFetch()
    }
    if (!res.ok) throw new Error(`Transmission ${method}: ${res.status}`)

    const json = (await res.json()) as { result: string; arguments?: T }
    if (json.result !== 'success') throw new Error(`Transmission ${method}: ${json.result}`)
    return (json.arguments ?? ({} as T))
  }

  async getTorrents(filter?: TorrentFilter): Promise<Torrent[]> {
    const { torrents } = await this.rpc<{ torrents: RawTransmissionTorrent[] }>('torrent-get', {
      fields: TORRENT_FIELDS,
    })
    const all = (torrents ?? []).map(normalise)
    const status = filter?.status ?? 'all'
    return status === 'all' ? all : all.filter((t) => matchesFilter(t, status))
  }

  async getTransferInfo(): Promise<TransferInfo> {
    const stats = await this.rpc<{
      downloadSpeed?: number
      uploadSpeed?: number
      'cumulative-stats'?: { downloadedBytes?: number; uploadedBytes?: number }
    }>('session-stats')

    // free space lives on session-get's download-dir-free-space (Transmission 4 also
    // returns it directly; fall back to 0 if absent).
    let freeSpace = 0
    try {
      const session = await this.rpc<{ 'download-dir-free-space'?: number }>('session-get', {
        fields: ['download-dir-free-space'],
      })
      freeSpace = session['download-dir-free-space'] ?? 0
    } catch {
      /* best effort — speeds matter more than free space */
    }

    return {
      dlSpeed: stats.downloadSpeed ?? 0,
      upSpeed: stats.uploadSpeed ?? 0,
      dlTotal: stats['cumulative-stats']?.downloadedBytes ?? 0,
      upTotal: stats['cumulative-stats']?.uploadedBytes ?? 0,
      freeSpace,
    }
  }

  async pollMaindata(): Promise<MaindataResult> {
    // No incremental sync in Transmission — return a full snapshot each call.
    const torrentsArr = await this.getTorrents()
    const transfer = await this.getTransferInfo()
    const torrents: Record<string, Partial<Torrent>> = {}
    for (const t of torrentsArr) torrents[t.hash] = t
    return {
      torrents,
      removed: [],
      serverState: transfer,
      isFullUpdate: true,
      rid: 0,
    }
  }

  async addTorrent(payload: AddTorrentPayload): Promise<void> {
    const args: Record<string, unknown> = {}
    if (payload.urls !== undefined) args.filename = payload.urls // magnet or http(s) .torrent URL
    if (payload.savePath !== undefined) args['download-dir'] = payload.savePath
    if (payload.paused !== undefined) args.paused = payload.paused
    try {
      await this.rpc('torrent-add', args)
    } catch (err) {
      // A duplicate add reports result "duplicate torrent" — treat as a no-op success,
      // mirroring the qBittorrent 409 handling so the grabber doesn't retry forever.
      if (err instanceof Error && /duplicate/i.test(err.message)) return
      throw err
    }
  }

  async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    if (hashes.length === 0) return
    await this.rpc('torrent-remove', {
      ids: hashes.map((h) => h.toLowerCase()),
      'delete-local-data': deleteFiles,
    })
  }

  async pauseTorrents(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return
    await this.rpc('torrent-stop', { ids: hashes.map((h) => h.toLowerCase()) })
  }

  async resumeTorrents(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return
    await this.rpc('torrent-start', { ids: hashes.map((h) => h.toLowerCase()) })
  }
}
