# VueTorrent Analysis

Source: `sources/VueTorrent/`
Stack: Vue 3 Composition API, Pinia stores, Vuetify 3, TypeScript, Vite
Backend: qBittorrent Web API only (not multi-client)

This is the primary reference implementation for the `/downloads` page rebuild. It talks exclusively to qBittorrent and has the most complete torrent UI of any reference in this repo.

---

## Store Architecture

Stores live in `src/stores/`. All use Pinia with `defineStore`. Key stores:

| Store | Purpose |
|---|---|
| `torrents` | Raw torrent data, filtering, sorting, all torrent actions |
| `dashboard` | Pagination, multi-selection, display mode (list/grid/table) |
| `vuetorrent` | UI settings, column visibility/ordering, theme, refresh interval |
| `torrentDetail` | Current detail tab, cached `TorrentProperties` from qBit |
| `maindata` | Server sync (full/incremental updates from qBit sync API) |
| `preferences` | qBittorrent server preferences (persisted to localStorage) |
| `categories` | Category list |
| `tags` | Tag list |
| `trackers` | Tracker→torrent mapping |
| `sidebar` | Sidebar filter state |
| `addTorrents` | Add torrent dialog state |
| `rss` | RSS feed state |

---

## Settings Panels

VueTorrent settings are in Vuetify dialogs, not a separate page. The relevant settings for a downloads page rebuild:

### VueTorrent UI Settings (stored in `localStorage` key `webuiSettings`)

| Setting | Type | Default | Description |
|---|---|---|---|
| `language` | string | `'en'` | UI locale |
| `theme.mode` | `ThemeMode` | `SYSTEM` | Light/Dark/System |
| `theme.light` | string | `LightLegacy.id` | Light theme ID |
| `theme.dark` | string | `DarkLegacy.id` | Dark theme ID |
| `showSpeedInTitle` | boolean | false | Show global speed in tab title |
| `uiTitleType` | `TitleOptions` | DEFAULT | Page title style |
| `uiTitleCustom` | string | `''` | Custom title text |
| `hideChipIfUnset` | boolean | false | Hide tags/category chip if empty |
| `enableRatioColors` | boolean | true | Color-code ratio values |
| `enableHashColors` | boolean | true | Hash-based colors for categories/tags |
| `paginationSize` | number | 15 | Items per page (-1 = infinite scroll) |
| `dateFormat` | string | default | Date display format |
| `durationFormat` | string | default | Duration display format |
| `isShutdownButtonVisible` | boolean | false | Show qBt shutdown button |
| `useBitSpeed` | boolean | false | Show speed in bits/s vs bytes/s |
| `useBinarySize` | boolean | false | Use MiB/GiB vs MB/GB |
| `refreshInterval` | number | 2000 | Poll interval in ms |
| `fileContentInterval` | number | 5000 | File list refresh interval |
| `useIdForRssLinks` | boolean | false | RSS link format |
| `hideColoredChip` | boolean | false | Disable colored chips globally |
| `displayGraphLimits` | boolean | true | Show speed limit lines on graph |
| `useEmojiState` | boolean | true | Show emoji for torrent state |
| `fetchExternalIpInfo` | boolean | false | Fetch GeoIP data for peers |
| `reduceMotion` | boolean | false | Reduce UI animations |
| `defaultTorrentDetailTab` | `TorrentDetailTab` | `LAST_OPENED` | Default detail tab |
| `expandContent` | boolean | true | Auto-expand torrent content list |
| `logoutUrl` | string | `''` | URL to redirect on logout |

### Column Visibility and Ordering

VueTorrent has separate column sets for four contexts:
- **Busy List** (`_busyProperties`) — downloading/active torrents in list view
- **Done List** (`_doneProperties`) — completed torrents in list view
- **Busy Grid** (`_busyGridProperties`) — downloading in grid view
- **Done Grid** (`_doneGridProperties`) — completed in grid view
- **Table** (`_tableProperties`) — table view (all torrents)

All use the same `DashboardProperty` enum; visibility and ordering are stored per-context.

---

## Torrent List Columns (All Available Properties)

Full list from `DashboardProperty` enum (`src/constants/vuetorrent/DashboardProperty.ts`):

| Property Key | Display | Type | Default Active |
|---|---|---|---|
| `size` | Size | DATA (bytes) | yes |
| `progress` | Progress | PERCENT (colored) | yes |
| `download_speed` | Download Speed | SPEED | yes |
| `upload_speed` | Upload Speed | SPEED | yes |
| `downloaded` | Downloaded | DATA | yes |
| `uploaded` | Uploaded | DATA | yes |
| `save_path` | Save Path | TEXT | no |
| `eta` | ETA | TEXT (formatted) | yes |
| `peers` | Peers | AMOUNT (connected/total) | yes |
| `seeds` | Seeds | AMOUNT (connected/total) | yes |
| `state` | State | CHIP (colored) | yes |
| `ratio` | Ratio | TEXT (colored by ratio value) | yes |
| `tracker` | Tracker | CHIP (hash-colored) | no |
| `category` | Category | CHIP (hash-colored) | yes |
| `tags` | Tags | CHIP (hash-colored) | yes |
| `added_on` | Added On | DATETIME | yes |
| `availability` | Availability | TEXT | yes |
| `completed_on` | Completed On | DATETIME | no |
| `last_activity` | Last Activity | RELATIVE | no |
| `amount_left` | Amount Left | DATA | no |
| `content_path` | Content Path | TEXT | no |
| `download_path` | Download Path | TEXT | no |
| `downloaded_session` | Downloaded (Session) | DATA | no |
| `download_limit` | Download Limit | SPEED | no |
| `hash` | Hash | TEXT | no |
| `infohash_v1` | InfoHash v1 | TEXT | no |
| `infohash_v2` | InfoHash v2 | TEXT | no |
| `seen_complete` | Seen Complete | DATETIME | no |
| `time_active` | Time Active | DURATION | no |
| `total_size` | Total Size | DATA | no |
| `trackers_count` | Trackers Count | TEXT | no |
| `upload_limit` | Upload Limit | SPEED | no |
| `uploaded_session` | Uploaded (Session) | DATA | no |
| `avg_download_speed` | Avg Download Speed | SPEED | no |
| `avg_upload_speed` | Avg Upload Speed | SPEED | no |
| `inactive_seeding_time_limit` | Inactive Seeding Time Limit | DURATION | no |
| `global_speed` | Global Speed | SPEED | no |
| `global_volume` | Global Volume | DATA | no |
| `priority` | Priority | TEXT | no |
| `ratio_limit` | Ratio Limit | TEXT (disabled/-1, global/-2, or value) | no |
| `seeding_time` | Seeding Time | DURATION | no |
| `seeding_time_limit` | Seeding Time Limit | DURATION | no |
| `basename_content_path` | Basename Content Path | TEXT | no |
| `basename_download_path` | Basename Download Path | CHIP | no |
| `basename_save_path` | Basename Save Path | CHIP | no |
| `truncated_hash` | Truncated Hash | TEXT | no |
| `comment` | Comment | TEXT | no (qBit 5.0+) |
| `has_metadata` | Has Metadata | BOOLEAN | no (qBit 5.0+) |
| `private` | Private | BOOLEAN | no (qBit 5.0+) |
| `popularity` | Popularity | TEXT | no (qBit 5.0+) |
| `reannounce` | Reannounce | TEXT | no (qBit 5.0+) |
| `root_path` | Root Path | TEXT | no (qBit 5.1+) |
| `auto_tmm` | Auto TMM | BOOLEAN | no |
| `f_l_piece_prio` | First/Last Piece Priority | BOOLEAN | no |
| `forced` | Forced | BOOLEAN | no |
| `magnet` | Magnet | TEXT | no |
| `super_seeding` | Super Seeding | BOOLEAN | no |
| `seq_dl` | Sequential Download | BOOLEAN | no |

### Property Type Renderers

| Type | Rendering |
|---|---|
| `DATA` | formatData(bytes, useBinarySize) → e.g. "1.2 GiB" |
| `SPEED` | formatData/s → e.g. "5.1 MiB/s" |
| `PERCENT` | 0–100% with state-based color |
| `DATETIME` | Locale datetime string |
| `RELATIVE` | Relative time (e.g. "3 hours ago") |
| `DURATION` | formatDuration with unit |
| `AMOUNT` | "connected / total" |
| `CHIP` | Colored badge/chip, optional hash-based color |
| `BOOLEAN` | Checkmark or cross |
| `TEXT` | Plain string with optional color |

---

## Torrent Detail Panel Tabs

Defined in `src/constants/vuetorrent/TorrentDetailTab.ts`:

| Tab Key | Label |
|---|---|
| `overview` | Overview |
| `info` | Info |
| `trackers` | Trackers |
| `peers` | Peers |
| `content` | Content |
| `tagsAndCategories` | Tags & Categories |

The detail store (`torrentDetail`) persists the last opened tab in localStorage. `TorrentDetailTab.LAST_OPENED` re-opens whichever tab was last active.

Detail data comes from `qbit.getTorrentProperties(hash)` — the `TorrentProperties` type includes extensive per-torrent metadata beyond what the list endpoint provides.

---

## Add Torrent Dialog Fields (`AddTorrentParamsForm.vue`)

The `AddTorrentParams` model is passed as a form model:

| Field | Control | Description |
|---|---|---|
| `tags` | `v-combobox` (multi) | Existing tags or free-form new tags |
| `category` | `v-combobox` | Existing categories or new; auto-fills `save_path` from category config |
| `download_path` | `ServerPathField` | Temporary download location (disabled if Auto TMM on) |
| `save_path` | `ServerPathField` | Final save location (disabled if Auto TMM on) |
| `content_layout` | `v-select` | Original / Subfolder / No Subfolder / Use Global |
| `stop_condition` | `v-select` | None / Metadata Received / Files Checked / Use Global |
| `stopped` | checkbox | Add in stopped state |
| `add_to_top_of_queue` | checkbox | Add at top of queue |
| `skip_checking` | checkbox | Skip hash check |
| `use_auto_tmm` | checkbox | Enable Automatic Torrent Management |
| `forced` | checkbox | Force start (qBit 5.1+) |

Collapsed "Limits" section:

| Field | Control | Description |
|---|---|---|
| `download_limit` | number (KiB/s) | Per-torrent download speed limit |
| `upload_limit` | number (KiB/s) | Per-torrent upload speed limit |
| `ratio_limit` | number | Share ratio limit |
| `seeding_time_limit` | number (minutes) | Seeding time limit |
| `inactive_seeding_time_limit` | number (minutes) | Inactive seeding time limit |

The `AddTorrentDialog` also has tabs for URL/file/magnet input before the params form appears.

---

## Torrent Actions (from `src/stores/torrents.ts`)

| Action | qBit API call |
|---|---|
| `resumeTorrents` | `startTorrents` (qBit 5) or `resumeTorrents` |
| `resumeAllTorrents` | `startAllTorrents` or `resumeAllTorrents` |
| `pauseTorrents` | `stopTorrents` (qBit 5) or `pauseTorrents` |
| `pauseAllTorrents` | `stopAllTorrents` or `pauseAllTorrents` |
| `forceStartTorrents` | `forceStartTorrents` |
| `deleteTorrents(hashes, deleteWithFiles)` | `deleteTorrents` |
| `moveTorrents('dl'/'save', hashes, path)` | `setTorrentDownloadPath` / `setTorrentSavePath` |
| `addTorrents(files, urls, payload)` | `addTorrents` |
| `recheckTorrents` | `recheckTorrents` |
| `reannounceTorrents` | `reannounceTorrents` |
| `renameTorrent(hash, name)` | `setTorrentName` |
| `setTorrentCategory(hashes, category)` | `setCategory` |
| `addTorrentTags` | `addTorrentTag` |
| `removeTorrentTags` | `removeTorrentTag` |
| `removeTorrentAllTags` | `removeTorrentAllTags` |
| `toggleSeqDl` | `toggleSequentialDownload` |
| `toggleFLPiecePrio` | `toggleFirstLastPiecePriority` |
| `toggleAutoTmm` | `setAutoTMM` |
| `setSuperSeeding` | `setSuperSeeding` |
| `setTorrentPriority` | `setTorrentPriority` (increasePrio/decreasePrio/topPrio/bottomPrio) |
| `exportTorrent` | `exportTorrent` |

---

## Filtering System

The `torrents` store maintains five concurrent filter dimensions, all combinable:

1. **Text filter** — searches `name`, `hash`, `download_path`, `savePath`
2. **Status filter** — `TorrentState[]` (multi-select states)
3. **Category filter** — `string[]` (category names)
4. **Tag filter** — include list + exclude list, each `string | null` (null = "no tags"), FilterType conjunctive/disjunctive
5. **Tracker filter** — include + exclude lists, supports `TrackerSpecialFilter.UNTRACKED` and `TrackerSpecialFilter.NOT_WORKING`

Overall filter combination (across dimensions): `FilterType.CONJUNCTIVE` (all must match) or `FilterType.DISJUNCTIVE` (any must match). Default is conjunctive.

Sorting: `sortCriterias` is an ordered array of `{ value: keyof VtTorrent, reverse: boolean }`. Multi-key sort — ties broken by hash. Default sort: `added_on` descending.

---

## Maindata / Sync Pattern

`maindata` store receives updates from qBittorrent's `/api/v2/sync/maindata` endpoint which returns incremental diffs. The `torrents` store's `syncFromMaindata(fullUpdate, entries, removed)` method handles both full and partial updates:
- Full update: replaces the entire `_torrents` Map
- Partial: merges changed fields; removes deleted hashes

This is the same polling pattern that `/downloads` in unified-frontend uses (React Query `refetchInterval: 5000`), but VueTorrent has it running at `refreshInterval` (default 2000ms) with an incremental diff protocol.

---

## Dashboard Views

Three view modes (persisted in localStorage):

| Mode | Component | Description |
|---|---|---|
| `DashboardDisplayMode.LIST` | `ListView` + `ListTorrent.vue` | Compact horizontal rows |
| `DashboardDisplayMode.GRID` | `GridView` + `GridTorrent.vue` | Card grid with poster-like layout |
| `DashboardDisplayMode.TABLE` | `TableView` + `TableTorrent.vue` | Full-width table with sortable columns |

The table view uses `TableComponent.vue` which supports resizable columns (width stored in `tableColumnWidths` in vuetorrent store).

---

## Reuse Notes for unified-frontend `/downloads`

### Column system
The `DashboardProperty` enum + `propsData`/`propsMetadata` pattern is the cleanest reference for what fields a torrent has and how to format them. For the unified-frontend downloads page:
- Minimum viable columns (always shown): `name`, `state`, `progress`, `download_speed`, `eta`, `size`
- Recommended additional: `seeds`, `peers`, `ratio`, `category`, `tags`, `added_on`
- The SPEED/DATA/PERCENT/AMOUNT renderers are straightforward to port to React

### Data shape
From qBittorrent `GET /api/v2/torrents/info`, each torrent object has: `hash`, `name`, `state`, `progress` (0–1), `dlspeed`, `upspeed`, `size`, `downloaded`, `uploaded`, `eta`, `category`, `tags` (comma-separated string), `save_path`, `added_on`, `num_seeds`, `num_leechs`, `ratio`, `seeding_time`, `priority`, `tracker`, `magnet`, `f_l_piece_prio`, `seq_dl`, `super_seeding`, `auto_tmm`, `availability`, `amount_left`, `download_path`, `content_path`, `dl_limit`, `up_limit`, `ratio_limit`, `seeding_time_limit`, `inactive_seeding_time_limit`, `time_active`, `uploaded_session`, `downloaded_session`.

### Add torrent form
The form fields in `AddTorrentParamsForm.vue` map directly to the qBittorrent `POST /api/v2/torrents/add` payload. The basic fields needed for a downloads page "add torrent" button: `urls`/`torrents` (file), `savepath`, `category`, `tags`, `stopped`/`paused`.

### State values
`TorrentState` values from qBit: `uploading`, `stalledUP`, `checkingUP`, `forcedUP`, `downloading`, `stalledDL`, `checkingDL`, `forcedDL`, `pausedUP`/`stoppedUP`, `pausedDL`/`stoppedDL`, `queuedUP`, `queuedDL`, `error`, `missingFiles`, `unknown`, `moving`, `checkingResumeData`, `metaDL`.
