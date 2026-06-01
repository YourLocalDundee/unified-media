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

// ---------------------------------------------------------------------------
// Session management (self-contained; does not import from @/lib/qbittorrent/session)
// ---------------------------------------------------------------------------

interface SessionCache {
  sid: string
  expiresAt: number
}

// Raw qBittorrent API response shapes — intentionally loose since we only
// access the fields we care about.
interface RawTorrent {
  hash?: string
  name?: string
  state?: string
  progress?: number
  dlspeed?: number
  upspeed?: number
  size?: number
  downloaded?: number
  eta?: number
  category?: string
  save_path?: string
  added_on?: number
}

interface RawServerState {
  dl_info_speed?: number
  ul_info_speed?: number
  dl_info_data?: number
  ul_info_data?: number
  free_space_on_disk?: number
  [key: string]: unknown
}

interface RawMainData {
  rid: number
  full_update: boolean
  torrents?: Record<string, RawTorrent>
  torrents_removed?: string[]
  server_state?: RawServerState
}

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

function mapState(raw: string | undefined): TorrentState {
  switch (raw) {
    case 'downloading':
    case 'forcedDL':
    case 'metaDL':
    case 'forcedMetaDL':
      return TS.Downloading
    case 'uploading':
    case 'forcedUP':
      return TS.Uploading
    case 'pausedDL':
    case 'pausedUP':
      return TS.Paused
    case 'stoppedDL':
    case 'stoppedUP':
      return TS.Stopped
    case 'checkingDL':
    case 'checkingUP':
    case 'checkingResumeData':
      return TS.Checking
    case 'queuedDL':
    case 'queuedUP':
      return TS.Queued
    case 'stalledDL':
    case 'stalledUP':
      return TS.Stalled
    case 'error':
    case 'missingFiles':
      return TS.Error
    default:
      return TS.Unknown
  }
}

// ---------------------------------------------------------------------------
// Field normalisation helpers
// ---------------------------------------------------------------------------

function normaliseTorrent(raw: RawTorrent): Torrent {
  return {
    hash: raw.hash ?? '',
    name: raw.name ?? '',
    state: mapState(raw.state),
    progress: raw.progress ?? 0,
    dlspeed: raw.dlspeed ?? 0,
    upspeed: raw.upspeed ?? 0,
    size: raw.size ?? 0,
    downloaded: raw.downloaded ?? 0,
    eta: raw.eta ?? -1,
    category: raw.category ?? '',
    savePath: raw.save_path ?? '',
    addedOn: raw.added_on ?? 0,
  }
}

function normalisePartialTorrent(raw: RawTorrent): Partial<Torrent> {
  const out: Partial<Torrent> = {}
  if (raw.hash !== undefined) out.hash = raw.hash
  if (raw.name !== undefined) out.name = raw.name
  if (raw.state !== undefined) out.state = mapState(raw.state)
  if (raw.progress !== undefined) out.progress = raw.progress
  if (raw.dlspeed !== undefined) out.dlspeed = raw.dlspeed
  if (raw.upspeed !== undefined) out.upspeed = raw.upspeed
  if (raw.size !== undefined) out.size = raw.size
  if (raw.downloaded !== undefined) out.downloaded = raw.downloaded
  if (raw.eta !== undefined) out.eta = raw.eta
  if (raw.category !== undefined) out.category = raw.category
  if (raw.save_path !== undefined) out.savePath = raw.save_path
  if (raw.added_on !== undefined) out.addedOn = raw.added_on
  return out
}

function normaliseServerState(raw: RawServerState | undefined): Partial<TransferInfo> {
  if (!raw) return {}
  const out: Partial<TransferInfo> = {}
  if (raw.dl_info_speed !== undefined) out.dlSpeed = raw.dl_info_speed
  if (raw.ul_info_speed !== undefined) out.upSpeed = raw.ul_info_speed
  if (raw.dl_info_data !== undefined) out.dlTotal = raw.dl_info_data
  if (raw.ul_info_data !== undefined) out.upTotal = raw.ul_info_data
  if (raw.free_space_on_disk !== undefined) out.freeSpace = raw.free_space_on_disk
  return out
}

// ---------------------------------------------------------------------------
// QBittorrentClient
// ---------------------------------------------------------------------------

export class QBittorrentClient implements DownloadClient {
  private readonly url: string
  private readonly username: string
  private readonly password: string
  private sessionCache: SessionCache | null = null

  constructor(url: string, username?: string, password?: string) {
    this.url = url.replace(/\/$/, '')
    this.username = username ?? 'admin'
    this.password = password ?? ''
  }

  // ---- Session ----------------------------------------------------------

  private async login(): Promise<string> {
    const body = new URLSearchParams({
      username: this.username,
      password: this.password,
    })

    const res = await fetch(`${this.url}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })

    if (!res.ok) throw new Error(`qBittorrent login failed: ${res.status}`)

    // qBittorrent returns 200 with body "Fails." on wrong credentials
    const text = await res.text()
    if (text.trim() === 'Fails.') {
      throw new Error('qBittorrent login failed: invalid credentials')
    }

    const setCookie = res.headers.get('set-cookie') ?? ''
    const sidMatch = setCookie.match(/SID=([^;]+)/)
    if (!sidMatch) throw new Error('qBittorrent login: no SID in response')

    return sidMatch[1]
  }

  private async getSession(): Promise<string> {
    const now = Date.now()
    if (this.sessionCache && this.sessionCache.expiresAt > now) {
      return this.sessionCache.sid
    }
    const sid = await this.login()
    this.sessionCache = { sid, expiresAt: now + 25 * 60 * 1000 } // 25-minute TTL
    return sid
  }

  private clearSession(): void {
    this.sessionCache = null
  }

  private async apiFetch<T = unknown>(
    path: string,
    options?: { method?: 'GET' | 'POST'; body?: URLSearchParams }
  ): Promise<T> {
    const sid = await this.getSession()
    const method = options?.method ?? 'GET'

    const headers: HeadersInit = { Cookie: `SID=${sid}` }
    if (method === 'POST' && options?.body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    const res = await fetch(`${this.url}${path}`, {
      method,
      headers,
      body: options?.body,
      cache: 'no-store',
    })

    if (res.status === 403) {
      // Re-auth once on 403
      this.clearSession()
      const newSid = await this.getSession()
      const retryHeaders: HeadersInit = { Cookie: `SID=${newSid}` }
      if (method === 'POST' && options?.body) {
        retryHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
      }
      const retryRes = await fetch(`${this.url}${path}`, {
        method,
        headers: retryHeaders,
        body: options?.body,
        cache: 'no-store',
      })
      if (!retryRes.ok) {
        throw new Error(`qBittorrent ${method} ${path}: ${retryRes.status}`)
      }
      const ct = retryRes.headers.get('content-type') ?? ''
      return ct.includes('application/json')
        ? retryRes.json()
        : (retryRes.text() as unknown as T)
    }

    if (!res.ok) throw new Error(`qBittorrent ${method} ${path}: ${res.status}`)

    const ct = res.headers.get('content-type') ?? ''
    return ct.includes('application/json')
      ? res.json()
      : (res.text() as unknown as T)
  }

  // ---- DownloadClient interface -----------------------------------------

  async getTorrents(filter?: TorrentFilter): Promise<Torrent[]> {
    const status = filter?.status ?? 'all'
    const raw = await this.apiFetch<RawTorrent[]>(
      `/api/v2/torrents/info?filter=${status}`
    )
    return raw.map(normaliseTorrent)
  }

  async getTransferInfo(): Promise<TransferInfo> {
    const raw = await this.apiFetch<RawServerState>('/api/v2/transfer/info')
    return {
      dlSpeed: raw.dl_info_speed ?? 0,
      upSpeed: raw.ul_info_speed ?? 0,
      dlTotal: raw.dl_info_data ?? 0,
      upTotal: raw.ul_info_data ?? 0,
      freeSpace: raw.free_space_on_disk ?? 0,
    }
  }

  async pollMaindata(rid = 0): Promise<MaindataResult> {
    const raw = await this.apiFetch<RawMainData>(
      `/api/v2/sync/maindata?rid=${rid}`
    )

    const torrents: Record<string, Partial<Torrent>> = {}
    for (const [hash, partial] of Object.entries(raw.torrents ?? {})) {
      torrents[hash] = normalisePartialTorrent(partial)
    }

    return {
      torrents,
      removed: raw.torrents_removed ?? [],
      serverState: normaliseServerState(raw.server_state),
      isFullUpdate: raw.full_update,
      rid: raw.rid,
    }
  }

  async addTorrent(payload: AddTorrentPayload): Promise<void> {
    const body = new URLSearchParams()
    if (payload.urls !== undefined) body.set('urls', payload.urls)
    if (payload.savePath !== undefined) body.set('savepath', payload.savePath)
    if (payload.category !== undefined) body.set('category', payload.category)
    if (payload.tags !== undefined) body.set('tags', payload.tags)
    if (payload.paused !== undefined) body.set('paused', String(payload.paused))
    await this.apiFetch<string>('/api/v2/torrents/add', { method: 'POST', body })
  }

  async deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
    await this.apiFetch<string>('/api/v2/torrents/delete', {
      method: 'POST',
      body: new URLSearchParams({
        hashes: hashes.join('|'),
        deleteFiles: String(deleteFiles),
      }),
    })
  }

  async pauseTorrents(hashes: string[]): Promise<void> {
    // qBit v5: /torrents/stop is the pause endpoint
    await this.apiFetch<string>('/api/v2/torrents/stop', {
      method: 'POST',
      body: new URLSearchParams({ hashes: hashes.join('|') }),
    })
  }

  async resumeTorrents(hashes: string[]): Promise<void> {
    // qBit v5: /torrents/start is the resume endpoint
    await this.apiFetch<string>('/api/v2/torrents/start', {
      method: 'POST',
      body: new URLSearchParams({ hashes: hashes.join('|') }),
    })
  }
}
