export enum TorrentState {
  Downloading = 'Downloading',
  Uploading = 'Uploading',
  Paused = 'Paused',
  Stopped = 'Stopped',
  Checking = 'Checking',
  Queued = 'Queued',
  Stalled = 'Stalled',
  Error = 'Error',
  Unknown = 'Unknown',
}

export interface Torrent {
  hash: string
  name: string
  state: TorrentState
  progress: number      // 0.0-1.0
  dlspeed: number       // bytes/s
  upspeed: number       // bytes/s
  size: number
  downloaded: number
  eta: number           // seconds, -1 = unknown
  category: string
  savePath: string
  addedOn: number       // unix timestamp
}

export interface TransferInfo {
  dlSpeed: number
  upSpeed: number
  dlTotal: number
  upTotal: number
  freeSpace: number
}

export interface MaindataResult {
  torrents: Record<string, Partial<Torrent>>
  removed: string[]
  serverState: Partial<TransferInfo>
  isFullUpdate: boolean
  rid: number
}

export interface AddTorrentPayload {
  urls?: string
  savePath?: string
  category?: string
  tags?: string
  paused?: boolean
}

export interface TorrentFilter {
  status?: 'all' | 'downloading' | 'completed' | 'active' | 'paused' | 'stopped'
  category?: string
  tag?: string
}

export interface DownloadClient {
  getTorrents(filter?: TorrentFilter): Promise<Torrent[]>
  getTransferInfo(): Promise<TransferInfo>
  pollMaindata(rid?: number): Promise<MaindataResult>
  addTorrent(payload: AddTorrentPayload): Promise<void>
  deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void>
  pauseTorrents(hashes: string[]): Promise<void>
  resumeTorrents(hashes: string[]): Promise<void>
}
