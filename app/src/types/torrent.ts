// qBittorrent API types — field names match the API response exactly so responses
// can be assigned without mapping.

export type QbtTorrentState =
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
  | 'pausedDL'
  | 'queuedDL'
  | 'stalledDL'
  | 'checkingDL'
  | 'forcedDL'
  | 'checkingResumeData'
  | 'moving'
  | 'unknown'

export interface QbtTorrent {
  hash: string
  name: string
  magnet_uri: string
  size: number
  progress: number          // 0–1
  dlspeed: number           // bytes/s
  upspeed: number           // bytes/s
  priority: number
  num_seeds: number
  num_complete: number
  num_leechs: number
  num_incomplete: number
  ratio: number
  eta: number               // seconds
  state: QbtTorrentState
  seq_dl: boolean
  f_l_piece_prio: boolean
  category: string
  tags: string              // comma-separated
  super_seeding: boolean
  force_start: boolean
  save_path: string
  content_path: string
  added_on: number          // unix timestamp
  completion_on: number
  tracker: string
  trackers_count: number
  downloaded: number
  uploaded: number
  downloaded_session: number
  uploaded_session: number
  amount_left: number
  time_active: number
  seeding_time: number
  last_activity: number
  seen_complete: number
  total_size: number
  reannounce: number
  infohash_v1: string
  infohash_v2: string
  ratio_limit: number
  seeding_time_limit: number
  auto_tmm: boolean
  availability: number
}

export interface QbtTorrentProperties {
  save_path: string
  creation_date: number
  piece_size: number
  comment: string
  total_wasted: number
  total_uploaded: number
  total_uploaded_session: number
  total_downloaded: number
  total_downloaded_session: number
  up_limit: number
  dl_limit: number
  time_elapsed: number
  seeding_time: number
  nb_connections: number
  nb_connections_limit: number
  share_ratio: number
  addition_date: number
  completion_date: number
  created_by: string
  dl_speed_avg: number
  dl_speed: number
  eta: number
  last_seen: number
  peers: number
  peers_total: number
  pieces_have: number
  pieces_num: number
  reannounce: number
  seeds: number
  seeds_total: number
  total_size: number
  up_speed_avg: number
  up_speed: number
  is_private: boolean
  infohash_v1: string
  infohash_v2: string
}

export interface QbtTrackerInfo {
  url: string
  /** 0=disabled, 1=not contacted, 2=working, 3=updating, 4=not working */
  status: 0 | 1 | 2 | 3 | 4
  tier: number
  num_peers: number
  num_seeds: number
  num_leeches: number
  num_downloaded: number
  msg: string
}

export interface QbtPeerInfo {
  ip: string
  port: number
  client: string
  flags: string
  progress: number
  dl_speed: number
  up_speed: number
  downloaded: number
  uploaded: number
  relevance: number
  files: string
  connection: string
  country: string
  country_code: string
}

export interface QbtFileInfo {
  index: number
  name: string
  size: number
  progress: number
  /** 0=do not download, 1=normal, 6=high, 7=maximal */
  priority: 0 | 1 | 6 | 7
  is_seed: boolean
  piece_range: [number, number]
  availability: number
}

export interface QbtTransferInfo {
  dl_info_speed: number
  dl_info_data: number
  up_info_speed: number
  up_info_data: number
  dl_rate_limit: number
  up_rate_limit: number
  dht_nodes: number
  connection_status: string
  alltime_dl: number
  alltime_ul: number
  free_space_on_disk: number
}

export interface QbtPreferences {
  // Download settings
  save_path: string
  temp_path_enabled: boolean
  temp_path: string
  scan_dirs: Record<string, number>
  export_dir: string
  export_dir_fin: string
  preallocate_all: boolean
  incomplete_files_ext: boolean
  auto_tmm_enabled: boolean
  torrent_changed_tmm_enabled: boolean
  save_path_changed_tmm_enabled: boolean
  category_changed_tmm_enabled: boolean
  create_subfolder_enabled: boolean
  start_paused_enabled: boolean
  auto_delete_mode: number
  // Connection settings
  listen_port: number
  upnp: boolean
  random_port: boolean
  dl_limit: number
  up_limit: number
  max_connec: number
  max_connec_per_torrent: number
  max_uploads: number
  max_uploads_per_torrent: number
  bittorrent_protocol: number
  limit_utp_rate: boolean
  limit_tcp_overhead: boolean
  limit_lan_peers: boolean
  outgoing_ports_min: number
  outgoing_ports_max: number
  // Speed settings
  alt_dl_limit: number
  alt_up_limit: number
  scheduler_enabled: boolean
  schedule_from_hour: number
  schedule_from_min: number
  schedule_to_hour: number
  schedule_to_min: number
  scheduler_days: number
  // BitTorrent settings
  dht: boolean
  pex: boolean
  lsd: boolean
  encryption: number
  anonymous_mode: boolean
  max_ratio_enabled: boolean
  max_ratio: number
  max_seeding_time_enabled: boolean
  max_seeding_time: number
  max_inactive_seeding_time_enabled: boolean
  max_inactive_seeding_time: number
  max_ratio_act: number
  announce_to_all_trackers: boolean
  announce_to_all_tiers: boolean
  announce_ip: string
  // Queue settings
  queueing_enabled: boolean
  max_active_downloads: number
  max_active_torrents: number
  max_active_uploads: number
  dont_count_slow_torrents: boolean
  slow_torrent_dl_rate_threshold: number
  slow_torrent_ul_rate_threshold: number
  slow_torrent_inactive_timer: number
  // Proxy settings
  proxy_type: number
  proxy_ip: string
  proxy_port: number
  proxy_peer_connections: boolean
  proxy_auth_enabled: boolean
  proxy_username: string
  proxy_password: string
  proxy_torrents_only: boolean
  ip_filter_enabled: boolean
  ip_filter_path: string
  ip_filter_trackers: boolean
  banned_IPs: string
  // RSS settings
  rss_refresh_interval: number
  rss_max_articles_per_feed: number
  rss_processing_enabled: boolean
  rss_auto_downloading_enabled: boolean
  rss_download_repack_proper_episodes: boolean
  rss_smart_episode_filters: string
  // Advanced settings
  async_io_threads: number
  disk_cache: number
  disk_cache_ttl: number
  use_os_cache: boolean
  disk_queue_size: number
  enable_coalesce_read_write: boolean
  enable_piece_extent_affinity: boolean
  enable_upload_suggestions: boolean
  send_buffer_watermark: number
  send_buffer_low_watermark: number
  send_buffer_watermark_factor: number
  connection_speed: number
  socket_send_buffer_size: number
  socket_receive_buffer_size: number
  socket_backlog_size: number
  validate_https_tracker_certificate: boolean
  ssrf_mitigation: boolean
  block_peers_on_privileged_ports: boolean
  max_concurrent_http_announces: number
  stop_tracker_timeout: number
  peer_turnover: number
  peer_turnover_cutoff: number
  peer_turnover_interval: number
  request_queue_size: number
}

export interface TorrentUIPreferences {
  visibleColumns: string[]
  columnOrder: string[]
  sortColumn: string
  sortReverse: boolean
  rowsPerPage: 25 | 50 | 100 | 'all'
  refreshInterval: 1000 | 2000 | 5000 | 10000
  confirmDelete: boolean
  confirmDeleteFiles: boolean
  showSpeedInToolbar: boolean
  dateFormat: 'relative' | 'absolute'
  defaultFilter: string
  sidebarCollapsed: boolean
}
