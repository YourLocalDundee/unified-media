export type TorrentState =
  | 'error'
  | 'missingFiles'
  | 'uploading'
  | 'pausedUP'
  | 'queuedUP'
  | 'stalledUP'
  | 'checkingUP'
  | 'forcedUP'
  | 'allocating'
  | 'downloading'
  | 'metaDL'
  | 'forcedMetaDL'
  | 'pausedDL'
  | 'queuedDL'
  | 'stalledDL'
  | 'checkingDL'
  | 'forcedDL'
  | 'checkingResumeData'
  | 'moving'
  | 'unknown'
  | 'stoppedDL'
  | 'stoppedUP'

export interface Torrent {
  hash: string
  name: string
  size: number
  progress: number        // 0.0 - 1.0
  dlspeed: number         // bytes/s
  upspeed: number         // bytes/s
  num_seeds: number
  num_leechs: number
  state: TorrentState
  eta: number             // seconds (-1 = unknown)
  category: string
  tags: string
  save_path: string
  completion_on: number   // unix timestamp
  added_on: number        // unix timestamp
  ratio: number
  completed: number       // bytes
  downloaded: number      // bytes
  uploaded: number        // bytes
  priority: number
  auto_tmm: boolean
  tracker: string
  trackers_count: number
  amount_left: number     // bytes
  time_active: number     // seconds
  seeding_time: number    // seconds
  // Extended fields (qBittorrent API v2)
  magnet_uri: string
  availability: number
  super_seeding: boolean
  force_start: boolean
  seq_dl: boolean
  f_l_piece_prio: boolean
  total_size: number
  content_path: string
  last_activity: number
  seen_complete: number
  downloaded_session: number
  uploaded_session: number
  reannounce: number
  infohash_v1: string
  infohash_v2: string
  ratio_limit: number
  seeding_time_limit: number
  num_complete: number
  num_incomplete: number
}

export interface TransferInfo {
  dl_info_speed: number   // bytes/s
  ul_info_speed: number   // bytes/s
  dl_info_data: number    // total bytes downloaded this session
  ul_info_data: number    // total bytes uploaded this session
  dl_rate_limit: number
  ul_rate_limit: number
  dht_nodes: number
  connection_status: 'connected' | 'firewalled' | 'disconnected'
  free_space_on_disk?: number  // bytes free on the save path's disk
}

export interface MainData {
  rid: number
  full_update: boolean
  torrents?: Record<string, Partial<Torrent>>
  torrents_removed?: string[]
  categories?: Record<string, { name: string; savePath: string }>
  tags?: string[]
  server_state?: Partial<TransferInfo & {
    free_space_on_disk: number
    global_ratio: string
    alltime_dl: number
    alltime_ul: number
  }>
}

export interface TorrentFile {
  index: number
  name: string
  size: number
  progress: number
  priority: number
  is_seed: boolean
  piece_range: [number, number]
  availability: number
}

export interface AddTorrentParams {
  urls?: string           // newline-separated magnet/HTTP URLs
  savepath?: string
  category?: string
  tags?: string           // comma-separated
  rename?: string
  paused?: boolean        // qBit v4 — stop on add
  stopped?: boolean       // qBit v5 — stop on add
  firstLastPiecePrio?: boolean
  sequentialDownload?: boolean
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

export function isTorrentActive(state: TorrentState): boolean {
  return [
    'downloading',
    'forcedDL',
    'metaDL',
    'forcedMetaDL',
    'uploading',
    'forcedUP',
    'stalledDL',
    'stalledUP',
  ].includes(state)
}

export function isTorrentComplete(state: TorrentState): boolean {
  return [
    'uploading',
    'stalledUP',
    'pausedUP',
    'queuedUP',
    'forcedUP',
    'stoppedUP',
    'checkingUP',
  ].includes(state)
}

export function getTorrentStateLabel(state: TorrentState): string {
  const labels: Record<TorrentState, string> = {
    error: 'Error',
    missingFiles: 'Missing Files',
    uploading: 'Seeding',
    pausedUP: 'Paused',
    queuedUP: 'Queued',
    stalledUP: 'Stalled',
    checkingUP: 'Checking',
    forcedUP: 'Forced Upload',
    allocating: 'Allocating',
    downloading: 'Downloading',
    metaDL: 'Fetching Metadata',
    forcedMetaDL: 'Fetching Metadata',
    pausedDL: 'Paused',
    queuedDL: 'Queued',
    stalledDL: 'Stalled',
    checkingDL: 'Checking',
    forcedDL: 'Forced DL',
    checkingResumeData: 'Resuming',
    moving: 'Moving',
    unknown: 'Unknown',
    stoppedDL: 'Stopped',
    stoppedUP: 'Stopped',
  }
  return labels[state] ?? state
}

export function getTorrentStateColor(
  state: TorrentState
): 'green' | 'blue' | 'yellow' | 'red' | 'gray' {
  if (
    ['downloading', 'forcedDL', 'metaDL', 'forcedMetaDL'].includes(state)
  )
    return 'blue'
  if (['uploading', 'forcedUP', 'stalledUP'].includes(state)) return 'green'
  if (
    [
      'pausedDL',
      'pausedUP',
      'stoppedDL',
      'stoppedUP',
      'queuedDL',
      'queuedUP',
    ].includes(state)
  )
    return 'gray'
  if (['error', 'missingFiles'].includes(state)) return 'red'
  if (
    [
      'checkingDL',
      'checkingUP',
      'checkingResumeData',
      'allocating',
      'moving',
      'stalledDL',
    ].includes(state)
  )
    return 'yellow'
  return 'gray'
}
