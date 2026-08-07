// Deluge implementation of the DownloadClient interface.
//
// Deluge-web exposes a single JSON-RPC endpoint (`/json`) speaking `{ method, params, id }`.
// Auth is a two-step handshake unlike qBittorrent:
//   1. auth.login(password) → sets a `_session_id` cookie we must echo back.
//   2. web.connected() → if the WebUI isn't attached to a daemon yet, web.get_hosts()
//      then web.connect(hostId). Without this every core.* call fails "not connected".
// The session cookie + connected state are cached on the instance and re-established on
// any auth failure, mirroring the qBittorrent client's single-retry-on-auth-loss pattern.
//
// Deluge has no incremental sync; web.update_ui returns a full torrent map + stats each
// call, so pollMaindata() returns a full snapshot (isFullUpdate = true, removed = []).

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

const JSON_PATH = '/json'

function mapState(state: string | undefined): TorrentState {
  switch (state) {
    case 'Downloading': return TS.Downloading
    case 'Seeding': return TS.Uploading
    case 'Paused': return TS.Paused
    case 'Checking': return TS.Checking
    case 'Queued': return TS.Queued
    case 'Error': return TS.Error
    case 'Allocating':
    case 'Moving': return TS.Checking
    default: return TS.Unknown
  }
}

interface RawDelugeTorrent {
  name?: string
  state?: string
  progress?: number             // 0-100
  download_payload_rate?: number // bytes/s
  upload_payload_rate?: number   // bytes/s
  total_size?: number
  total_done?: number
  eta?: number                   // seconds (0 = unknown/done)
  save_path?: string
  time_added?: number            // unix seconds (float)
  label?: string
}

const UI_FIELDS = [
  'name', 'state', 'progress', 'download_payload_rate', 'upload_payload_rate',
  'total_size', 'total_done', 'eta', 'save_path', 'time_added', 'label',
]

function normalise(hash: string, raw: RawDelugeTorrent): Torrent {
  return {
    hash: hash.toLowerCase(),
    name: raw.name ?? '',
    state: mapState(raw.state),
    progress: (raw.progress ?? 0) / 100,
    dlspeed: raw.download_payload_rate ?? 0,
    upspeed: raw.upload_payload_rate ?? 0,
    size: raw.total_size ?? 0,
    downloaded: raw.total_done ?? 0,
    eta: raw.eta != null && raw.eta > 0 ? raw.eta : -1,
    category: raw.label ?? '',
    savePath: raw.save_path ?? '',
    addedOn: raw.time_added ?? 0,
  }
}

function matchesFilter(t: Torrent, status: NonNullable<TorrentFilter['status']>): boolean {
  switch (status) {
    case 'all': return true
    case 'downloading': return t.state === TS.Downloading
    case 'completed': return t.progress >= 1
    case 'active': return t.dlspeed > 0 || t.upspeed > 0
    case 'paused':
    case 'stopped': return t.state === TS.Paused
    default: return true
  }
}

export class DelugeClient implements DownloadClient {
  private readonly url: string
  private readonly password: string
  private cookie = ''

  constructor(url: string, password?: string) {
    this.url = url.replace(/\/$/, '')
    this.password = password ?? ''
  }

  // Low-level JSON-RPC call. Does NOT (re)auth — callers go through ensureSession().
  private async call<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    const res = await fetch(`${this.url}${JSON_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: JSON.stringify({ method, params, id: 1 }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Deluge ${method}: ${res.status}`)

    // Capture a refreshed session cookie if the server rotated it.
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) {
      const m = setCookie.match(/_session_id=[^;]+/)
      if (m) this.cookie = m[0]
    }

    const json = (await res.json()) as { result: T; error: { message?: string } | null }
    if (json.error) throw new Error(`Deluge ${method}: ${json.error.message ?? 'rpc error'}`)
    return json.result
  }

  // Establish (or repair) login + daemon connection. Idempotent — cheap when already up.
  private async ensureSession(): Promise<void> {
    const ok = this.cookie ? await this.call<boolean>('auth.check_session').catch(() => false) : false
    if (!ok) {
      const loggedIn = await this.call<boolean>('auth.login', [this.password])
      if (!loggedIn) throw new Error('Deluge login failed: invalid password')
    }

    const connected = await this.call<boolean>('web.connected')
    if (!connected) {
      const hosts = await this.call<[string, string, number, string][]>('web.get_hosts')
      if (!hosts || hosts.length === 0) throw new Error('Deluge: no daemon hosts available')
      await this.call('web.connect', [hosts[0][0]])
    }
  }

  // Run an RPC with one re-auth retry if the session/connection dropped.
  private async rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    await this.ensureSession()
    try {
      return await this.call<T>(method, params)
    } catch (err) {
      // Session may have expired between ensureSession and the call — reset and retry once.
      if (err instanceof Error && /not connected|session|login|403|401/i.test(err.message)) {
        this.cookie = ''
        await this.ensureSession()
        return this.call<T>(method, params)
      }
      throw err
    }
  }

  async getTorrents(filter?: TorrentFilter): Promise<Torrent[]> {
    const ui = await this.rpc<{ torrents: Record<string, RawDelugeTorrent> }>('web.update_ui', [
      UI_FIELDS,
      {},
    ])
    const all = Object.entries(ui.torrents ?? {}).map(([hash, raw]) => normalise(hash, raw))
    const status = filter?.status ?? 'all'
    return status === 'all' ? all : all.filter((t) => matchesFilter(t, status))
  }

  async getTransferInfo(): Promise<TransferInfo> {
    const ui = await this.rpc<{ stats?: { download_rate?: number; upload_rate?: number } }>(
      'web.update_ui',
      [[], {}],
    )
    const free = await this.rpc<number>('core.get_free_space').catch(() => 0)
    const session = await this.rpc<{ total_download?: number; total_upload?: number }>(
      'core.get_session_status',
      [['total_download', 'total_upload']],
    ).catch(() => ({}) as { total_download?: number; total_upload?: number })
    return {
      dlSpeed: ui.stats?.download_rate ?? 0,
      upSpeed: ui.stats?.upload_rate ?? 0,
      dlTotal: session.total_download ?? 0,
      upTotal: session.total_upload ?? 0,
      freeSpace: free,
    }
  }

  async pollMaindata(): Promise<MaindataResult> {
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
    const uri = payload.urls
    if (!uri) return
    const options: Record<string, unknown> = {}
    if (payload.savePath !== undefined) options.download_location = payload.savePath
    if (payload.paused !== undefined) options.add_paused = payload.paused

    // Magnet vs .torrent URL use different core methods.
    const method = uri.startsWith('magnet:') ? 'core.add_torrent_magnet' : 'core.add_torrent_url'
    try {
      await this.rpc(method, [uri, options])
    } catch (err) {
      // Deluge raises on an already-added torrent — treat as a no-op success (parity with qBit 409).
      if (err instanceof Error && /already/i.test(err.message)) return
      throw err
    }
  }

  async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    // core.remove_torrent takes a single id; loop. Best-effort per hash so one failure
    // doesn't abort the rest.
    for (const h of hashes) {
      try {
        await this.rpc('core.remove_torrent', [h.toLowerCase(), deleteFiles])
      } catch (err) {
        process.stderr.write(`[deluge] remove_torrent ${h} failed: ${err}\n`)
      }
    }
  }

  async pauseTorrents(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return
    await this.rpc('core.pause_torrent', [hashes.map((h) => h.toLowerCase())])
  }

  async resumeTorrents(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return
    await this.rpc('core.resume_torrent', [hashes.map((h) => h.toLowerCase())])
  }
}
