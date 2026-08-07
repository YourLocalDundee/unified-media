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
  // Advanced — disk I/O (extended)
  hashing_threads: number
  file_pool_size: number
  checking_memory_use: number
  disk_io_type: number
  disk_io_read_mode: number
  disk_io_write_mode: number
  save_resume_data_interval: number
  resume_data_storage_type: number
  torrent_content_remove_option: number
  // Advanced — connections (extended)
  utp_tcp_mixed_mode: number
  upload_slots_behavior: number
  upload_choking_algorithm: number
  peer_tos: number
  dht_bootstrap_nodes: string
  idn_support_enabled: boolean
  enable_multi_connections_from_same_ip: boolean
  // Advanced — security (extended)
  enable_embedded_tracker: boolean
  embedded_tracker_port: number
  embedded_tracker_port_forwarding: boolean
  // Advanced — performance
  bdecode_depth_limit: number
  bdecode_token_limit: number
  recheck_completed_torrents: boolean
  resolve_peer_countries: boolean
  reannounce_when_address_changed: boolean
  memory_working_set_limit: number
  performance_warning: boolean
  // RSS (extended)
  rss_fetch_delay: number
  // WebUI settings
  web_ui_address: string
  web_ui_port: number
  web_ui_upnp: boolean
  use_https: boolean
  web_ui_https_cert_path: string
  web_ui_https_key_path: string
  web_ui_username: string
  bypass_local_auth: boolean
  bypass_auth_subnet_whitelist_enabled: boolean
  bypass_auth_subnet_whitelist: string
  web_ui_max_auth_fail_count: number
  web_ui_ban_duration: number
  web_ui_session_timeout: number
  web_ui_clickjacking_protection_enabled: boolean
  web_ui_csrf_protection_enabled: boolean
  web_ui_secure_cookie_enabled: boolean
  web_ui_host_header_validation_enabled: boolean
  web_ui_domain_list: string
  web_ui_reverse_proxy_enabled: boolean
  web_ui_reverse_proxies_list: string
  web_ui_use_custom_http_headers_enabled: boolean
  web_ui_custom_http_headers: string
  alternative_webui_enabled: boolean
  alternative_webui_path: string
  dyndns_enabled: boolean
  dyndns_service: number
  dyndns_domain: string
  dyndns_username: string
  dyndns_password: string
  // Downloads — additional
  use_category_paths_in_manual_mode: boolean
  add_to_top_of_queue: boolean
  add_stopped_enabled: boolean
  torrent_content_layout: string
  torrent_stop_condition: string
  merge_trackers: boolean
  excluded_file_names_enabled: boolean
  excluded_file_names: string
  autorun_on_torrent_added_enabled: boolean
  autorun_on_torrent_added_program: string
  autorun_enabled: boolean
  autorun_program: string
  mail_notification_enabled: boolean
  mail_notification_sender: string
  mail_notification_email: string
  mail_notification_smtp: string
  mail_notification_ssl_enabled: boolean
  mail_notification_auth_enabled: boolean
  mail_notification_username: string
  mail_notification_password: string
  // Connection — additional
  current_network_interface: string
  current_interface_address: string
  i2p_enabled: boolean
  i2p_address: string
  i2p_port: number
  i2p_mixed_mode: boolean
  i2p_inbound_quantity: number
  i2p_outbound_quantity: number
  i2p_inbound_length: number
  i2p_outbound_length: number
  proxy_bittorrent: boolean
  proxy_rss: boolean
  proxy_misc: boolean
  proxy_hostname_lookup: boolean
  upnp_lease_duration: number
  // BitTorrent — additional
  add_trackers_enabled: boolean
  add_trackers: string
  add_trackers_from_url_enabled: boolean
  add_trackers_url: string
  max_active_checking_torrents: number
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
