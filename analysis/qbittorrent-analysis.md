# VueTorrent Source Analysis
> For use by an engineer building a unified Next.js/React frontend that integrates qBittorrent management

---

## Tech Stack

VueTorrent v2.34.0 is a Vue 3 SPA that ships as a replacement WebUI served directly from qBittorrent's built-in web server.

| Concern | Library | Version |
|---|---|---|
| UI framework | Vue 3 | ^3.5.34 |
| Component library | Vuetify 4 | ^4.0.7 |
| State management | Pinia 3 | ^3.0.4 |
| State persistence | pinia-persistence-plugin | ^0.0.7 |
| HTTP client | axios | ^1.15.2 |
| Router | vue-router 5 | ^5.0.7 |
| i18n | vue-i18n 11 | ^11.4.4 |
| Charts | apexcharts + vue3-apexcharts | ^5.12.0 / ^1.11.1 |
| Piece canvas renderer | pixi.js | ^8.18.1 |
| Drag-and-drop | vuedraggable | ^4.1.0 |
| Date handling | dayjs | ^1.11.13 |
| Toast notifications | vue3-toastify | ^0.2.9 |
| Composables | @vueuse/core + @vueuse/components | ^14.3.0 |
| Async task management | vue-concurrency | ^5.0.3 |
| Build | Vite 7 + vue-tsc | — |
| PWA | vite-plugin-pwa | ^1.2.0 |

**Key architectural points:**
- Entirely client-side SPA; no server-side rendering.
- During development, Vite proxies `/api` and `/backend` to `http://localhost:8080` (configurable via `VITE_QBITTORRENT_TARGET`).
- In production the SPA is embedded inside qBittorrent's webUI zip and requests to `/api/v2/*` go to the same origin.
- All API calls use `axios` with `baseURL: 'api/v2'` and `Content-Type: application/x-www-form-urlencoded` for POST requests (data encoded as `URLSearchParams`).
- The app has a `MockProvider` that generates fake torrents (controlled by `VITE_USE_MOCK_PROVIDER` env var), useful for UI development without a running qBittorrent instance.

---

## Directory Structure

```
src/
├── main.ts                     # App entry point; mounts Vue, registers plugins
├── App.vue                     # Root component; wraps router-view
│
├── plugins/
│   ├── router.ts               # Vue Router setup; hash history; auth guard
│   ├── pinia.ts                # Pinia setup with persistence plugin
│   ├── vuetify.ts              # Vuetify theme registration
│   ├── i18n.ts                 # vue-i18n setup
│   ├── dayjs.ts                # dayjs locale setup
│   └── toastify.ts             # vue3-toastify defaults
│
├── services/
│   ├── backend.ts              # BackendProvider: optional VueTorrent-specific config store
│   ├── Github.ts               # GitHub release check (update notifications)
│   └── qbit/
│       ├── index.ts            # Exports singleton: selects QBitProvider or MockProvider
│       ├── IProvider.ts        # TypeScript interface: complete contract for all API methods
│       ├── QbitProvider.ts     # Real implementation: maps methods → axios HTTP calls
│       └── MockProvider.ts     # Fake implementation using @faker-js/faker
│
├── stores/                     # Pinia stores (one file per domain)
│   ├── app.ts                  # Auth state, qBittorrent version, login/logout
│   ├── maindata.ts             # Polling loop; consumes sync/maindata; fans out to other stores
│   ├── torrents.ts             # Torrent list, filtering, sorting, torrent actions
│   ├── dashboard.ts            # Pagination, multi-select, display mode
│   ├── torrentDetail.ts        # Single-torrent detail tab + properties cache
│   ├── content.ts              # Torrent file tree; file priority; rename
│   ├── categories.ts           # Category CRUD; syncs from maindata
│   ├── tags.ts                 # Tag CRUD; syncs from maindata
│   ├── trackers.ts             # Tracker list per torrent; syncs from maindata
│   ├── preferences.ts          # App preferences (qBittorrent settings)
│   ├── addTorrents.ts          # Add-torrent dialog form state
│   ├── navbar.ts               # Speed graph data buffers (dl/ul history)
│   ├── sidebar.ts              # Sidebar widget config
│   ├── dialog.ts               # Dynamic dialog registry
│   ├── rss.ts                  # RSS feeds and rules
│   ├── searchEngine.ts         # Search plugin management
│   ├── torrentCreator.ts       # Torrent creator task management
│   ├── logs.ts                 # Application log entries
│   ├── cookies.ts              # HTTP cookies manager
│   ├── externalIp.ts           # External IP detection
│   ├── history.ts              # Input history (e.g., save paths)
│   ├── global.ts               # Global keyboard shortcuts
│   └── vuetorrent.ts           # All VueTorrent UI preferences (persisted to localStorage)
│
├── pages/
│   ├── Login.vue               # Login form
│   ├── Dashboard.vue           # Main torrent list page
│   ├── TorrentDetail.vue       # Single-torrent detail (tabs: Overview, Content, Trackers, Peers)
│   ├── Settings.vue            # qBittorrent + VueTorrent settings
│   ├── SearchEngine.vue        # Plugin-based torrent search
│   ├── RssArticles.vue         # RSS feed articles view
│   ├── Logs.vue                # Application logs
│   ├── TorrentCreator.vue      # .torrent file creator
│   ├── CookiesManager.vue      # HTTP cookie manager
│   └── MagnetHandler.vue       # Handles magnet: protocol via PWA file handler
│
├── components/
│   ├── AddPanel.vue            # Bottom bar showing pending torrent count
│   ├── TorrentSearchbar.vue    # Search input bar
│   ├── DnDZone.vue             # Drag-and-drop .torrent file zone
│   ├── Core/                   # Reusable generic UI components
│   ├── Dashboard/
│   │   ├── DashboardItems/     # Per-property display cells (speed, size, duration, etc.)
│   │   ├── Views/
│   │   │   ├── List/           # ListView + ListTorrent (default mobile view)
│   │   │   ├── Grid/           # GridView + GridTorrent (card grid view)
│   │   │   └── Table/          # TableView + TableTorrent (desktop data table)
│   │   ├── RightClick.vue      # Context menu for torrent actions
│   │   └── Toolbar.vue         # Top toolbar (select all, bulk actions)
│   ├── Dialogs/                # All modal dialogs
│   │   ├── AddTorrentDialog.vue
│   │   ├── AddTorrentParamsForm.vue
│   │   ├── ShareLimitDialog.vue
│   │   ├── SpeedLimitDialog.vue
│   │   ├── MoveTorrentDialog.vue
│   │   ├── RenameTorrentDialog.vue
│   │   ├── CategoryFormDialog.vue
│   │   ├── TagFormDialog.vue
│   │   ├── Confirm/            # Generic confirm dialogs
│   │   └── ...
│   ├── Navbar/
│   │   ├── Navbar.vue
│   │   ├── Sidebar.vue
│   │   ├── SideWidgets/        # Speed graph, free space, stats, filters
│   │   └── TopWidgets/         # Action buttons, active filter chips
│   ├── TorrentDetail/
│   │   ├── Overview.vue        # Summary stats
│   │   ├── Content/            # File tree (Content.vue + ContentNode.vue)
│   │   ├── Info/               # Detailed property panels
│   │   ├── Trackers.vue        # Tracker list with status
│   │   ├── Peers.vue           # Peer list
│   │   ├── TagsAndCategories.vue
│   │   └── PieceCanvas.vue     # Pixi.js piece availability bitmap
│   ├── Settings/               # Settings page tab components
│   └── RSS/                    # RSS feed/rule components
│
├── composables/                # Shared Vue composable logic
│   ├── BackendSync.ts          # Syncs Pinia store state to optional backend config API
│   ├── TorrentBuilder.ts       # Converts RawQbitTorrent → Torrent (adds computed fields)
│   ├── TreeBuilder.ts          # Builds folder tree from flat TorrentFile list
│   ├── SearchQuery.ts          # Fuzzy/substring filter over any array
│   ├── ArrayPagination.ts      # Paginator for arrays
│   ├── Dialog.ts               # Dialog open/close helper
│   └── TableResize.ts          # Column resize logic
│
├── constants/
│   ├── qbit/                   # Enums matching qBittorrent API string/int values
│   │   ├── TorrentState.ts
│   │   ├── FilterState.ts
│   │   ├── FilePriority.ts
│   │   ├── TrackerStatus.ts
│   │   ├── ConnectionStatus.ts
│   │   ├── LogType.ts
│   │   ├── PieceState.ts
│   │   ├── AppPreferences.ts   # Many sub-enums for preferences fields
│   │   ├── DirectoryContentMode.ts
│   │   ├── TorrentFormat.ts
│   │   └── TorrentOperatingMode.ts
│   └── vuetorrent/             # UI-only enums and defaults
│
├── types/
│   ├── qbit/
│   │   ├── models/             # Interfaces matching qBittorrent API response shapes
│   │   ├── payloads/           # Interfaces for request parameters
│   │   └── responses/          # Compound response types (maindata, peers, search)
│   └── vuetorrent/             # App-specific types (VT Torrent view model, tree nodes)
│
├── helpers/                    # Pure utility functions (formatters, comparators, etc.)
├── locales/                    # i18n JSON files
├── themes/                     # Vuetify theme definitions
└── styles/                     # Global SCSS
```

---

## qBittorrent Web API Reference

All requests are relative to `api/v2/`. GET requests use query params; POST requests use `application/x-www-form-urlencoded` bodies (JSON payloads are string-encoded in a `json` field for `setPreferences`).

Multiple hashes are joined with `|` (pipe). Hash `all` means all torrents.

### Authentication

| Method | Path | Body params | Response | Description |
|---|---|---|---|---|
| POST | `/auth/login` | `username`, `password` | `"Ok."` (200) or `"Fails."` (200 with 403 body) | Establishes session cookie `SID`. Returns HTTP 200 even on failure; check body text. |
| POST | `/auth/logout` | — | `"Ok."` | Invalidates the session cookie. |

**Auth notes:**
- qBittorrent returns a `Set-Cookie: SID=...` on successful login. All subsequent requests must include this cookie.
- A `403 Forbidden` response on any API call means the session has expired. VueTorrent handles this in `maindata.ts` by redirecting to login.
- qBittorrent also supports an `Authorization: Bearer <api_key>` header if a Web API key is configured via `/app/rotateAPIKey`.
- No CSRF token is required by default (CSRF protection can be enabled in preferences).

---

### App Controller (`/app/`)

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| GET | `/app/version` | — | `"v5.0.3"` (string) | qBittorrent application version. |
| GET | `/app/buildInfo` | — | `BuildInfo` object | Qt/libtorrent/OpenSSL versions, platform, bitness. |
| GET | `/app/preferences` | — | `AppPreferences` object | Full application settings (~100 fields). |
| POST | `/app/setPreferences` | `json=<JSON string>` | `"Ok."` | Partial update of preferences. Only include fields to change. |
| POST | `/app/shutdown` | — | `"Ok."` | Shutdown the qBittorrent process. |
| GET | `/app/networkInterfaceList` | — | `Array<{name, value}>` | Available network interfaces. |
| GET | `/app/networkInterfaceAddressList` | `iface` (string) | `string[]` | IP addresses for a given interface. |
| POST | `/app/sendTestEmail` | — | `"Ok."` | Sends a test notification email. |
| POST | `/app/getDirectoryContent` | `dirPath`, `mode?` (`all`\|`files`\|`dirs`) | `string[]` or 400/404 | Lists server filesystem contents at path. |
| GET | `/app/cookies` | — | `Cookie[]` | All stored HTTP cookies. |
| POST | `/app/setCookies` | `cookies=<JSON array>` | `"Ok."` | Replace all stored cookies. |
| POST | `/app/rotateAPIKey` | — | `{apiKey: string}` | Generate/rotate a Web API key. |
| POST | `/app/deleteAPIKey` | — | `"Ok."` | Delete the current Web API key. |

**BuildInfo shape:**
```typescript
{
  bitness: number,       // 32 or 64
  boost: string,
  libtorrent: string,    // e.g. "2.0.10"
  openssl: string,
  platform: 'windows' | 'macos' | 'linux' | 'unknown',
  qt: string,
  zlib: string
}
```

---

### Auth Controller (`/auth/`)

Covered above.

---

### Log Controller (`/log/`)

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| GET | `/log/main` | `last_known_id?`, `info?`, `normal?`, `warning?`, `critical?` | `Log[]` | Application log entries. `info`/`normal`/`warning`/`critical` are booleans (filter by type). |

**Log shape:**
```typescript
{ id: number, message: string, timestamp: number, type: LogType }
// LogType: NORMAL=1, INFO=2, WARNING=4, CRITICAL=8
```

---

### Sync Controller (`/sync/`)

These are the most important endpoints — they power the real-time update loop.

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| GET | `/sync/maindata` | `rid?` (number) | `MaindataResponse` | **Primary polling endpoint.** Returns full or partial update of torrents, categories, tags, trackers, and server state. |
| GET | `/sync/torrentPeers` | `hash`, `rid?` | `TorrentPeersResponse` | Incremental update of peers for a single torrent. |

**MaindataResponse:**

On the first call (no `rid`), or when the server's internal state has been fully reset, the response includes `full_update: true` and contains complete snapshots:

```typescript
// Full update
{
  full_update: true,
  rid: number,           // pass this as rid on next call
  server_state: ServerState,
  categories?: Record<string, Category>,
  tags?: string[],
  torrents?: Record<string, RawTorrent>,  // key = infohash
  trackers?: Record<string, string[]>     // key = tracker URL, value = hashes
}

// Partial update (subsequent calls with matching rid)
{
  rid: number,
  server_state?: Partial<ServerState>,
  categories?: Record<string, Partial<Category>>,
  categories_removed?: string[],
  tags?: string[],
  tags_removed?: string[],
  torrents?: Record<string, Partial<RawTorrent>>,
  torrents_removed?: string[],
  trackers?: Record<string, string[]>,
  trackers_removed?: string[]
}
```

**ServerState shape (key fields):**
```typescript
{
  connection_status: 'connected' | 'firewalled' | 'disconnected' | 'unknown',
  dl_info_speed: number,       // current download speed (bytes/s)
  dl_info_data: number,        // total downloaded this session
  dl_rate_limit: number,       // current dl limit
  up_info_speed: number,       // current upload speed (bytes/s)
  up_info_data: number,
  up_rate_limit: number,
  alltime_dl: number,          // all-time downloaded
  alltime_ul: number,
  free_space_on_disk: number,
  dht_nodes: number,
  global_ratio: string,
  queueing: boolean,
  use_alt_speed_limits: boolean,
  refresh_interval: number,    // ms; mirrors preferences
  total_peer_connections: number
}
```

---

### Torrents Controller (`/torrents/`)

#### Read operations

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| GET | `/torrents/info` | See GetTorrentPayload | `QbitTorrent[]` | Get torrent list with optional filtering/sorting. |
| GET | `/torrents/properties` | `hash` | `TorrentProperties` | Detailed properties for a single torrent. |
| GET | `/torrents/trackers` | `hash` | `Tracker[]` | Tracker list for a torrent. |
| GET | `/torrents/files` | `hash`, `indexes?` (pipe-separated) | `TorrentFile[]` | File list for a torrent. |
| GET | `/torrents/pieceStates` | `hash` | `number[]` | Array of piece states: 0=missing, 1=downloading, 2=downloaded. |
| GET | `/torrents/tags` | — | `string[]` | All available tags (sorted). |
| GET | `/torrents/categories` | — | `Record<string, Category>` | All categories keyed by name. |
| GET | `/torrents/count` | — | `number` | Total torrent count in libtorrent session. |
| GET | `/torrents/export` | `hash` | Binary blob (`application/x-bittorrent`) | Export as `.torrent` file. |
| GET | `/torrents/SSLParameters` | `hash` | `SSLParameters` | SSL cert/key/DH params for a tracker. |

**GetTorrentPayload (query params for `/torrents/info`):**
```typescript
{
  filter?: 'all'|'downloading'|'seeding'|'completed'|'paused'|'stopped'|
           'resumed'|'running'|'active'|'inactive'|'stalled'|
           'stalled_uploading'|'stalled_downloading'|'checking'|'moving'|'errored',
  category?: string,
  tag?: string,
  hashes?: string,       // pipe-separated hashes
  private?: boolean,     // since qBit 5.x
  sort?: keyof QbitTorrent,
  reverse?: boolean,
  limit?: number,
  offset?: number
}
```

**QbitTorrent shape (complete field list):**
```typescript
{
  hash: string,              // infohash (key in maindata)
  added_on: number,          // Unix epoch
  amount_left: number,       // bytes remaining
  auto_tmm: boolean,
  availability: number,      // 0–1 percentage of pieces available in swarm
  category: string,
  comment?: string,          // since 5.0.0
  completed: number,
  completion_on: number,
  content_path: string,      // absolute path to content root
  dl_limit: number,          // -1 = unlimited
  dlspeed: number,           // bytes/s
  download_path: string,
  downloaded: number,
  downloaded_session: number,
  eta: number,               // seconds; 8640000 = unknown
  f_l_piece_prio: boolean,
  force_start: boolean,
  has_metadata?: boolean,    // since 5.0.0; useful for magnet links
  inactive_seeding_time_limit: number,
  infohash_v1: string,
  infohash_v2: string,
  last_activity: number,
  magnet_uri: string,
  max_inactive_seeding_time: number,
  max_ratio: number,         // -1 = no limit
  max_seeding_time: number,  // -1 = no limit
  name: string,
  num_complete: number,      // seeds in swarm
  num_incomplete: number,    // leechers in swarm
  num_leechs: number,        // connected leechers
  num_seeds: number,         // connected seeds
  popularity?: number,       // since 5.0.0
  priority: number,          // -1 if queueing disabled
  private?: boolean,         // since 5.0.0
  progress: number,          // 0–1
  ratio: number,
  ratio_limit: number,
  reannounce?: number,       // seconds until next announce; since 5.0.0
  root_path?: string,        // since 5.1.0
  save_path: string,
  seeding_time: number,
  seeding_time_limit: number,
  seen_complete: number,
  seq_dl: boolean,
  share_limit_action?: ShareLimitAction,  // since 5.2.0
  size: number,              // selected files size
  state: TorrentState,
  super_seeding: boolean,
  tags: string,              // comma-separated
  time_active: number,
  total_size: number,        // all files including unselected
  tracker: string,           // first working tracker URL
  trackers_count: number,
  up_limit: number,
  uploaded: number,
  uploaded_session: number,
  upspeed: number
}
```

**TorrentState enum values:**
```
metaDL, forcedMetaDL, forcedDL, downloading, stalledDL,
pausedDL (deprecated→stoppedDL), stoppedDL, queuedDL,
forcedUP, uploading, stalledUP,
pausedUP (deprecated→stoppedUP), stoppedUP, queuedUP,
checkingDL, checkingUP, checkingResumeData, allocating (deprecated),
moving, missingFiles, error, unknown
```

**TorrentProperties shape (from `/torrents/properties`):**
```typescript
{
  addition_date: number, comment: string, completion_date: number,
  created_by: string, creation_date: number,
  dl_limit: number, dl_speed: number, dl_speed_avg: number,
  download_path: string, eta: number,
  hash: string, infohash_v1: string, infohash_v2: string,
  last_seen: number, name: string,
  nb_connections: number, nb_connections_limit: number,
  peers: number, peers_total: number,
  piece_size: number, pieces_have: number, pieces_num: number,
  private?: boolean, reannounce: number, save_path: string,
  seeding_time: number, seeds: number, seeds_total: number,
  share_ratio: number, time_elapsed: number,
  total_downloaded: number, total_downloaded_session: number,
  total_size: number, total_uploaded: number, total_uploaded_session: number,
  total_wasted: number, up_limit: number, up_speed: number, up_speed_avg: number
}
```

**TorrentFile shape:**
```typescript
{
  index: number,         // 0-based file index
  name: string,          // relative path within torrent
  size: number,          // bytes
  progress: number,      // 0–1
  priority: FilePriority, // 0=skip, 1=normal, 6=high, 7=max
  is_seed?: boolean,     // only on first file, true when complete
  piece_range: [number, number],
  availability: number
}
```

**Tracker shape:**
```typescript
{
  url: string, msg: string, tier: number,
  status: TrackerStatus,  // 0=disabled, 1=not_contacted, 2=working, 3=updating, 4=not_working
  num_peers: number, num_seeds: number, num_leeches: number, num_downloaded: number
}
```

#### Torrent actions (POST)

All action endpoints accept `hashes` as a pipe-separated string or `all`.

| Method | Path | Body params | Description |
|---|---|---|---|
| POST | `/torrents/add` | See AddTorrentPayload | Add torrent(s) by URL/magnet/file upload. |
| POST | `/torrents/delete` | `hashes`, `deleteFiles` (bool) | Delete torrents, optionally with data. |
| POST | `/torrents/stop` | `hashes` | Stop torrents (qBit 5+). |
| POST | `/torrents/start` | `hashes` | Start torrents (qBit 5+). |
| POST | `/torrents/pause` | `hashes` | Pause torrents (qBit 4.x, deprecated in 5+). |
| POST | `/torrents/resume` | `hashes` | Resume torrents (qBit 4.x, deprecated in 5+). |
| POST | `/torrents/recheck` | `hashes` | Force hash recheck. |
| POST | `/torrents/reannounce` | `hashes` | Force tracker reannounce. |
| POST | `/torrents/setForceStart` | `hashes`, `value` (bool) | Set force-start flag. |
| POST | `/torrents/toggleSequentialDownload` | `hashes` | Toggle sequential download mode. |
| POST | `/torrents/toggleFirstLastPiecePrio` | `hashes` | Toggle first/last piece priority. |
| POST | `/torrents/setSuperSeeding` | `hashes`, `value` (bool) | Set super-seeding mode. |
| POST | `/torrents/setAutoManagement` | `hashes`, `enable` (bool) | Set Automatic Torrent Management. |
| POST | `/torrents/setDownloadLimit` | `hashes`, `limit` (bytes/s) | Per-torrent download limit. |
| POST | `/torrents/setUploadLimit` | `hashes`, `limit` (bytes/s) | Per-torrent upload limit. |
| POST | `/torrents/setShareLimits` | `hashes`, `ratioLimit`, `seedingTimeLimit`, `inactiveSeedingTimeLimit`, `shareLimitAction` | Set share limits. |
| POST | `/torrents/setCategory` | `hashes`, `category` | Assign category. |
| POST | `/torrents/setDownloadPath` | `id` (hashes or `all`), `path` | Set download (temp) path. |
| POST | `/torrents/setSavePath` | `id` (hashes or `all`), `path` | Set save path. |
| POST | `/torrents/rename` | `hash`, `name` | Rename a torrent. |
| POST | `/torrents/addTags` | `hashes`, `tags` (comma-separated) | Add tags. |
| POST | `/torrents/removeTags` | `hashes`, `tags?` (comma-sep; omit to remove all) | Remove tags. |
| POST | `/torrents/createTags` | `tags` (comma-separated) | Create global tags. |
| POST | `/torrents/deleteTags` | `tags` (comma-separated) | Delete global tags. |
| POST | `/torrents/createCategory` | `category`, `savePath`, `downloadPath?`, `downloadPathEnabled?` | Create category. |
| POST | `/torrents/editCategory` | `category`, `savePath`, `downloadPath?`, `downloadPathEnabled?` | Edit category. |
| POST | `/torrents/removeCategories` | `categories` (newline-separated) | Delete categories. |
| POST | `/torrents/addTrackers` | `hash`, `urls` (newline + blank-line tier-separated) | Add trackers to torrent. |
| POST | `/torrents/editTracker` | `hash`, `origUrl`, `newUrl` | Replace a tracker URL. |
| POST | `/torrents/removeTrackers` | `hash`, `urls` (URL-encoded, pipe-separated) | Remove trackers. |
| POST | `/torrents/addPeers` | `hashes`, `peers` (pipe-separated `ip:port`) | Manually add peers. |
| POST | `/torrents/increasePrio` | `hashes` | Increase queue priority. |
| POST | `/torrents/decreasePrio` | `hashes` | Decrease queue priority. |
| POST | `/torrents/topPrio` | `hashes` | Set to top of queue. |
| POST | `/torrents/bottomPrio` | `hashes` | Set to bottom of queue. |
| POST | `/torrents/filePrio` | `hash`, `id` (pipe-sep indexes), `priority` | Set file download priority. |
| POST | `/torrents/renameFile` | `hash`, `oldPath`, `newPath` | Rename a file within a torrent. |
| POST | `/torrents/renameFolder` | `hash`, `oldPath`, `newPath` | Rename a folder within a torrent. |
| POST | `/torrents/setSSLParameters` | `hash`, `ssl_certificate`, `ssl_private_key`, `ssl_dh_params` | Set SSL for tracker. |

**AddTorrentPayload (POST body for `/torrents/add`):**

When uploading `.torrent` files: send as `multipart/form-data` with `torrents[]` file fields.
When using URLs/magnets: send as `application/x-www-form-urlencoded`.
Both can include `urls` (newline-separated URL/magnet strings).

```typescript
{
  urls?: string,              // newline-separated magnet/http URLs
  torrents?: File[],          // .torrent file uploads (multipart)
  savepath?: string,          // save location
  downloadPath?: string,      // temp/incomplete path
  useDownloadPath?: boolean,
  category?: string,
  tags?: string,              // comma-separated
  contentLayout?: 'Original' | 'Subfolder' | 'NoSubfolder',
  rename?: string,
  dlLimit?: number,           // bytes/s
  upLimit?: number,           // bytes/s
  ratioLimit?: number,
  seedingTimeLimit?: number,  // minutes
  inactiveSeedingTimeLimit?: number,  // minutes
  autoTMM?: boolean,
  stopped?: boolean,          // start in stopped state (qBit 5+)
  paused?: boolean,           // deprecated alias for stopped
  stopCondition?: 'None' | 'MetadataReceived' | 'FilesChecked',
  skip_checking?: boolean,
  firstLastPiecePrio?: boolean,
  sequentialDownload?: boolean,
  addToTopOfQueue?: boolean,
  forced?: boolean,           // since 5.1.0
  cookie?: string,            // deprecated since 5.1.0
  shareLimitAction?: ShareLimitAction
}
```

**ShareLimitAction values:**
```
-1 = DEFAULT (use global)
 0 = STOP_TORRENT
 1 = REMOVE_TORRENT
 2 = ENABLE_SUPERSEEDING
 3 = REMOVE_TORRENT_AND_FILES
```

---

### Transfer Controller (`/transfer/`)

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| GET | `/transfer/downloadLimit` | — | `number` (bytes/s) | Global download speed limit; 0 = no limit. |
| GET | `/transfer/uploadLimit` | — | `number` (bytes/s) | Global upload speed limit; 0 = no limit. |
| POST | `/transfer/setDownloadLimit` | `limit` | `"Ok."` | Set global download limit (bytes/s). |
| POST | `/transfer/setUploadLimit` | `limit` | `"Ok."` | Set global upload limit (bytes/s). |
| POST | `/transfer/toggleSpeedLimitsMode` | — | `"Ok."` | Toggle alternative speed limits on/off. |
| POST | `/transfer/banPeers` | `peers` (pipe-separated `ip:port`) | `"Ok."` | Permanently ban peer IPs. |

---

### RSS Controller (`/rss/`)

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| POST | `/rss/addFeed` | `url`, `path` (feed name) | `"Ok."` | Create a new RSS feed. |
| GET | `/rss/items` | `withData` (bool) | `Record<string, Feed>` | All feeds; include articles if `withData=true`. |
| POST | `/rss/moveItem` | `itemPath`, `destPath` | `"Ok."` | Rename a feed. |
| POST | `/rss/setFeedURL` | `path`, `url` | `"Ok."` | Update feed URL (since 4.6.0). |
| POST | `/rss/removeItem` | `path` | `"Ok."` | Delete a feed. |
| POST | `/rss/refreshItem` | `itemPath` | `"Ok."` | Force-refresh a feed. |
| POST | `/rss/markAsRead` | `itemPath`, `articleId?` | `"Ok."` | Mark feed/article as read. |
| GET | `/rss/rules` | — | `Record<string, FeedRule>` | All auto-download rules. |
| POST | `/rss/setRule` | `ruleName`, `ruleDef` (JSON string) | `"Ok."` | Create or update a rule. |
| POST | `/rss/renameRule` | `ruleName`, `newRuleName` | `"Ok."` | Rename a rule. |
| POST | `/rss/removeRule` | `ruleName` | `"Ok."` | Delete a rule. |
| GET | `/rss/matchingArticles` | `ruleName` | `Record<string, string[]>` | Articles matched by a rule. |

---

### Search Controller (`/search/`)

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| POST | `/search/start` | `pattern`, `category`, `plugins` (pipe-sep) | `{id: number}` | Start a search job. |
| POST | `/search/stop` | `id` | `"Ok."` | Stop a running search. |
| POST | `/search/status` | `id` (0 = all) | `SearchStatus[]` | Check search job status. |
| POST | `/search/results` | `id`, `limit?`, `offset?` | `SearchResultsResponse` | Get search results. |
| POST | `/search/delete` | `id` | `"Ok."` | Delete a search job. |
| GET | `/search/plugins` | — | `SearchPlugin[]` | List installed plugins. |
| POST | `/search/installPlugin` | `sources` (pipe-sep URLs) | `"Ok."` | Install search plugin(s). |
| POST | `/search/uninstallPlugin` | `names` (pipe-sep) | `"Ok."` | Uninstall plugin(s). |
| POST | `/search/enablePlugin` | `names` (pipe-sep), `enable` (bool) | `"Ok."` | Enable/disable plugin(s). |
| POST | `/search/updatePlugins` | — | `"Ok."` | Update all plugins from source. |
| POST | `/search/downloadTorrent` | `torrentUrl`, `pluginName` | `"Ok."` | Download a torrent via a search plugin. |

---

### Torrent Creator Controller (`/torrentcreator/`)

| Method | Path | Params | Response | Description |
|---|---|---|---|---|
| POST | `/torrentcreator/addTask` | `TorrentCreatorParams` fields | `{taskID: string}` | Start a torrent creation task. |
| GET | `/torrentcreator/status` | `taskID?` | `TorrentCreatorTask[]` | Get task status; omit taskID for all tasks. |
| GET | `/torrentcreator/torrentFile` | `taskID` | Binary blob | Download the generated `.torrent` file. |
| POST | `/torrentcreator/deleteTask` | `taskID` | `"Ok."` | Delete a completed task. |

---

## Authentication Flow

1. **App startup:** `app.ts` calls `fetchAuthStatus()`, which calls `GET /app/version`. If it succeeds (HTTP 200), the session is already authenticated (cookie still valid from a previous session). If it throws (HTTP 403), `isAuthenticated = false`.

2. **Login page:** User submits username + password. `POST /auth/login` is called with `application/x-www-form-urlencoded` body. qBittorrent returns HTTP 200 with body `"Ok."` on success or `"Fails."` on wrong credentials. A successful login sets the `SID` session cookie, which axios carries automatically on subsequent requests.

3. **Session guard:** Vue Router's `beforeResolve` hook checks `isAuthenticated`. Any non-public route redirects to `/login` with a `?redirect=` query param if not authenticated.

4. **Session expiry detection:** The maindata polling loop (`maindata.ts`) catches HTTP 403 responses and calls `setAuthStatus(false)`, then `redirectToLogin()`. This handles server restarts or session timeouts.

5. **Cookie transport:** axios is created with default settings (no explicit `withCredentials`). Because VueTorrent is served from the same origin as qBittorrent, the browser sends the `SID` cookie automatically on all requests to `/api/v2/*`. When used cross-origin (the unified app scenario), you **must** set `withCredentials: true` on the axios instance.

6. **API key alternative:** If qBittorrent has a Web API key set, requests can use `Authorization: Bearer <key>` header instead of session cookies.

---

## Key UI Components

### Torrent List (Dashboard)
- **Location:** `src/pages/Dashboard.vue` + `src/components/Dashboard/Views/`
- Three view modes switchable at runtime: **List** (mobile-friendly), **Grid** (card layout), **Table** (sortable data table).
- Data source: `useTorrentStore().processedTorrents` — a computed list that is filtered by status/category/tag/tracker and text search, then sorted by configurable multi-column criteria.
- Selection is tracked in `useDashboardStore().selectedTorrents` (array of hash strings). Supports single-click, multi-select checkbox mode, and shift-click range selection.
- Right-click context menu (`RightClick.vue`) provides all per-torrent actions: start/stop, recheck, reannounce, set category/tags, move, delete, export, etc.

### Torrent Detail Panel
- **Location:** `src/pages/TorrentDetail.vue`
- Tabbed layout with tabs: **Overview**, **Content** (file tree), **Trackers**, **Peers**, **Info** (full properties), **Tags & Categories**.
- Overview shows progress bar, speeds, ETA, hashes, ratio.
- Content tab (`Content.vue` + `ContentNode.vue`) renders an expandable folder tree with per-file priority controls. Uses `useContentStore` which polls `getTorrentFiles` every `fileContentInterval` ms (default 5000ms).
- `PieceCanvas.vue` uses Pixi.js to render a bitmap of piece availability (fetched from `getTorrentPieceStates`).

### Add Torrent Dialog
- **Location:** `src/components/Dialogs/AddTorrentDialog.vue`
- Accepts `.torrent` file uploads (multiple), magnet links, and HTTP URLs (one per line).
- Wraps `AddTorrentParamsForm.vue` for per-torrent settings: save path, category, tags, content layout, speed limits, stop condition, ratio limits.
- Submits via `torrentStore.addTorrents(files, urls, payload)`.

### Speed / Status Bar (Navbar Sidebar)
- **Location:** `src/components/Navbar/SideWidgets/`
- `SpeedGraph.vue`: live chart of download/upload speed history (data buffered in `useNavbarStore`).
- `CurrentSpeed.vue`: shows current dl/ul speeds from `serverState.dl_info_speed` / `serverState.up_info_speed`.
- `FreeSpace.vue`: shows `serverState.free_space_on_disk`.
- `ConnectionStats.vue`: DHT nodes, connection status.
- `Filters.vue`: category/tag/tracker/status filter selectors.

---

## State Management (Pinia Stores)

VueTorrent uses 20+ Pinia stores. The key ones for the unified app:

### `useAppStore` (`stores/app.ts`)
```
isAuthenticated: boolean
version: string          // qBittorrent version string
buildInfo: BuildInfo     // component versions
usesQbit5: boolean       // computed: version >= "5"

login(username, password): calls POST /auth/login
logout(): calls POST /auth/logout
fetchAuthStatus(): calls GET /app/version to test session
toggleAlternativeMode(): calls POST /transfer/toggleSpeedLimitsMode
```

### `useMaindataStore` (`stores/maindata.ts`)
```
rid: number              // last response ID for incremental sync
serverState: ServerState // global server stats including speeds

forceMaindataSync(): starts polling loop (default 2s interval)
stopMaindataSync(): stops polling loop
```
Polls `GET /sync/maindata` and fans diff updates out to:
- `useTorrentStore` (torrent add/update/remove)
- `useCategoryStore` (category add/update/remove)
- `useTagStore` (tag add/remove)
- `useTrackerStore` (tracker-to-hash mapping)

### `useTorrentStore` (`stores/torrents.ts`)
```
torrents: VtTorrent[]              // computed from internal Map<hash, RawTorrent>
processedTorrents: VtTorrent[]     // filtered + sorted result (what the UI shows)
selectedTorrents: (via dashboard)

// Filters
textFilter: string
statusFilter: TorrentState[]
categoryFilter: string[]
tagFilterInclude: (string|null)[]
tagFilterExclude: (string|null)[]
trackerFilterInclude: (string|TrackerSpecialFilter)[]
sortCriterias: {value: keyof VtTorrent, reverse: boolean}[]

// Actions
addTorrents(files, urls, payload)
deleteTorrents(hashes, deleteWithFiles)
pauseTorrents(hashes) / resumeTorrents(hashes)  → automatically uses stop/start on qBit5
recheckTorrents(hashes)
reannounceTorrents(hashes)
setTorrentCategory(hashes, category)
addTorrentTags(hashes, tags)
exportTorrent(hash): Blob
```

### `useDashboardStore` (`stores/dashboard.ts`)
```
selectedTorrents: string[]     // array of hashes
isSelectionMultiple: boolean
displayMode: 'list'|'grid'|'table'
paginatedTorrents: VtTorrent[] // current page

selectTorrent(hash)
selectAllTorrents()
spanTorrentSelection(endHash)  // shift-click range
unselectAllTorrents()
```

### `useCategoryStore` / `useTagStore`
- Receive incremental updates from maindata sync.
- Expose CRUD methods: `createCategory`, `editCategory`, `deleteCategories`, `createTags`, `editTag`, `deleteTags`.

### `usePreferenceStore` (`stores/preferences.ts`)
```
preferences: AppPreferences   // full settings object

fetchPreferences()   → GET /app/preferences
setPreferences(partial?) → POST /app/setPreferences
```

### `useVueTorrentStore` (`stores/vuetorrent.ts`)
Stores only UI preferences (theme, language, pagination size, display options, column widths, refresh interval). Persisted to `localStorage` under key `webuiSettings`. Has no qBittorrent API calls.

---

## Notes for Unified App

### Which API endpoints are essential

For a Next.js app embedding qBittorrent management, the minimum viable surface is:

**Must have:**
- `POST /auth/login` + `POST /auth/logout` — authentication
- `GET /sync/maindata` — primary real-time data feed (poll every 2–5s)
- `POST /torrents/add` — add torrents
- `POST /torrents/delete` — delete torrents
- `POST /torrents/stop` + `POST /torrents/start` — pause/resume (qBit 5+)
- `POST /torrents/recheck` + `POST /torrents/reannounce`
- `GET /torrents/info` — direct torrent list (optional if using maindata)
- `GET /torrents/properties` — torrent detail
- `GET /torrents/files` — file list
- `GET /torrents/trackers` — tracker list
- `GET /app/version` — auth check + version detection
- `POST /app/setPreferences` — for any settings exposure

**Nice to have (feature parity):**
- `GET /torrents/pieceStates` — piece availability visualization
- `GET /sync/torrentPeers` — peer list in detail view
- `GET /torrents/categories` + category CRUD
- `GET /torrents/tags` + tag CRUD
- `GET /transfer/downloadLimit` + speed limit setters

**Skip for V1:**
- RSS controller (separate feature)
- Search controller (separate feature)
- Torrent creator controller
- Log controller
- App cookies manager

---

### Recommended React state approach

The maindata polling pattern maps cleanly to React:

```typescript
// 1. Use a reducer or Zustand store for the torrent map
type TorrentMap = Map<string, QbitTorrent>
// Update with Object.assign on partial updates, replace on full_update

// 2. Poll maindata with useEffect + setInterval
const [rid, setRid] = useState<number>()
const [torrents, dispatch] = useReducer(torrentReducer, new Map())
const [serverState, setServerState] = useState<Partial<ServerState>>()

useEffect(() => {
  const interval = setInterval(async () => {
    const res = await qbitClient.getMaindata(rid)
    setRid(res.rid)
    if (res.full_update) {
      dispatch({ type: 'REPLACE_ALL', torrents: res.torrents })
      setServerState(res.server_state)
    } else {
      dispatch({ type: 'MERGE', torrents: res.torrents, removed: res.torrents_removed })
      setServerState(prev => ({ ...prev, ...res.server_state }))
    }
  }, 2000)
  return () => clearInterval(interval)
}, [rid])

// 3. For qBit 4.x vs 5.x compatibility, check version once on login:
const usesQbit5 = version >= '5'
// Then call stop/start instead of pause/resume
```

TanStack Query (`react-query`) is also a good fit: use `useQuery` with `refetchInterval: 2000` for maindata. The incremental `rid` param requires careful handling — store `rid` in a ref outside query state to avoid stale closures.

For selected-torrent tracking, a simple `Set<string>` in component state or a Zustand store works well. No complex derived state is needed for the MVP.

---

### CORS considerations

When the unified Next.js app calls qBittorrent from the browser (different origin), you will hit CORS restrictions:

1. **qBittorrent does not send CORS headers by default.** The browser will block all requests.

2. **Option A (recommended): Server-side proxy.** Create a Next.js API route that proxies all `/api/v2/*` requests to the qBittorrent instance. The Next.js server talks directly to qBittorrent (same LAN/VPN), avoiding CORS entirely. Session cookie forwarding must be handled carefully (pass `Cookie` header through; forward `Set-Cookie` from login response back to browser).

   ```
   Browser → Next.js /api/qbit/* → qBittorrent /api/v2/*
   ```

   The session `SID` cookie will be scoped to the unified app's domain, which is correct.

3. **Option B: Configure qBittorrent CORS headers.** In qBittorrent's WebUI settings, enable custom HTTP headers and add:
   ```
   Access-Control-Allow-Origin: https://your-unified-app.domain
   Access-Control-Allow-Credentials: true
   ```
   Then set `withCredentials: true` on your fetch/axios calls. This is less flexible (the origin is hardcoded in qBittorrent's config) and exposes the qBittorrent port to CORS requests.

4. **Option C: Same-origin via Caddy/nginx reverse proxy.** Route `/api/qbit/` to qBittorrent and `/` to Next.js on the same domain. This is the cleanest production approach if you already have a reverse proxy (which you do — BunkerWeb/Caddy).

5. **Host header validation:** qBittorrent has a host header validation feature (`web_ui_host_header_validation_enabled`). If enabled, requests with the wrong `Host` header are rejected. The proxy approach handles this naturally since the proxy sends the correct host.

6. **CSRF protection:** qBittorrent's CSRF protection (`web_ui_csrf_protection_enabled`) checks the `Origin` header. With a same-origin proxy, this is not an issue. With direct cross-origin calls, you may need to disable CSRF protection in qBittorrent's settings.

---

### Version compatibility notes

- qBittorrent 5.x renamed `pause`/`resume` to `stop`/`start`. VueTorrent handles this by checking `usesQbit5` before choosing which endpoint to call. Implement the same check.
- Several torrent fields (`comment`, `has_metadata`, `popularity`, `private`, `reannounce`) are only present in qBit 5+.
- `share_limit_action` on torrents is only present in qBit 5.2+.
- The `stopped` field in `AddTorrentPayload` replaces the deprecated `paused` field in qBit 5+.
- `cookie` in `AddTorrentPayload` was deprecated in qBit 5.1.0 — use `/app/setCookies` instead.

