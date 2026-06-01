# Flood Analysis

Source: `sources/flood/`
Stack: React 18, MobX 6, Panda CSS, Fastify, NeDB, Lingui v5, TypeScript, Vite
Multi-client: rTorrent, qBittorrent, Transmission, Deluge

---

## Overview

Flood is the most polished torrent UI reference in this set. It is a full-stack Node.js app (not just a frontend), but its client code at `client/src/javascript/` is the relevant reference. Key strengths over VueTorrent: multi-client adapter pattern, SSE-based real-time updates with JSON Patch diffs, and a very clean modal/tab component system.

---

## Settings Modal Tabs

File: `client/src/javascript/components/modals/settings-modal/SettingsModal.tsx`

The settings modal has these tabs (all conditionally rendered):

| Tab Key | Component | Label |
|---|---|---|
| `bandwidth` | `BandwidthTab` | Bandwidth |
| `connectivity` | `ConnectivityTab` | Connectivity |
| `resources` | `ResourcesTab` | Resources |
| `authentication` | `AuthTab` | Authentication (hidden if authMethod = 'none') |
| `ui` | `UITab` | User Interface |
| `diskusage` | `DiskUsageTab` | Disk Usage |
| `about` | `AboutTab` | About |

Settings are split between `ClientSettings` (sent to the torrent client) and `FloodSettings` (stored in Flood's NeDB, per-user). Both are collected locally and saved together on "Save" click via `SettingActions.saveSettings` and `ClientActions.saveSettings`.

---

### Bandwidth Tab (`BandwidthTab.tsx`)

Two setting groups:

**Transfer Rate**
- Download speed preset list (comma-separated speeds, shown in dropdown for quick throttle)
- Upload speed preset list
- Global download throttle (B/s, sent to torrent client as `throttleGlobalDownSpeed`)
- Global upload throttle (B/s, `throttleGlobalUpSpeed`)

**Upload/Download Slots**
- Max upload slots per torrent (`throttleMaxUploads`)
- Max upload slots global (`throttleMaxUploadsGlobal`)
- Max download slots per torrent (`throttleMaxDownloads`)
- Max download slots global (`throttleMaxDownloadsGlobal`)

---

### Connectivity Tab (`ConnectivityTab.tsx`)

**Incoming**
- Port range (`networkPortRange`, text input e.g. "6881-6889")
- Randomize port checkbox (`networkPortRandom`)
- Open port in firewall checkbox (`networkPortOpen`)
- Local IP/hostname (`networkLocalAddress`)
- Max HTTP connections (`networkHttpMaxOpen`)

**DHT/PEX**
- DHT port (`dhtPort`)
- Enable DHT checkbox (`dht`)
- Enable PEX checkbox (`protocolPex`)

**Peers**
- Min peers during download (`throttleMinPeersNormal`)
- Max peers during download (`throttleMaxPeersNormal`)
- Min peers while seeding (`throttleMinPeersSeed`)
- Max peers while seeding (`throttleMaxPeersSeed`)
- Desired peers from trackers (`trackersNumWant`)

---

### Resources Tab (`ResourcesTab.tsx`)

**Disk**
- Default download location (`directoryDefault`)
- Max open files (`networkMaxOpenFiles`)
- Hash check on completion (`piecesHashOnCompletion`, checkbox)

**Memory**
- Max piece memory (MB) (`piecesMemoryMax`)

---

### UI Tab (`UITab.tsx`)

- Language selector (`language`)
- Tag selector mode: Single / Multi (`UITagSelectorMode`)
- Torrent list view size: Expanded / Condensed (`torrentListViewSize`)
- Displayed details: draggable `TorrentListColumnsList` (column visibility + order)
- Context menu items: `TorrentContextMenuActionsList`
- Misc settings: `MiscUISettingsList`

---

## Torrent List Columns

File: `client/src/javascript/constants/TorrentListColumns.ts`

| Column ID | i18n Key |
|---|---|
| `dateAdded` | `torrents.properties.date.added` |
| `dateFinished` | `torrents.properties.date.finished` |
| `downRate` | `torrents.properties.download.speed` |
| `downTotal` | `torrents.properties.download.total` |
| `eta` | `torrents.properties.eta` |
| `name` | `torrents.properties.name` |
| `peers` | `torrents.properties.peers` |
| `percentComplete` | `torrents.properties.percentage` |
| `ratio` | `torrents.properties.ratio` |
| `seeds` | `torrents.properties.seeds` |
| `sizeBytes` | `torrents.properties.size` |
| `tags` | `torrents.properties.tags` |
| `upRate` | `torrents.properties.upload.speed` |
| `upTotal` | `torrents.properties.upload.total` |
| `dateCreated` | `torrents.properties.date.created` |
| `directory` | `torrents.properties.directory` |
| `hash` | `torrents.properties.hash` |
| `isPrivate` | `torrents.properties.is.private` |
| `message` | `torrents.properties.tracker.message` |
| `trackerURIs` | `torrents.properties.trackers` |
| `dateActive` | `torrents.properties.date.active` |

**Locked columns (always shown in expanded view):** `name`, `eta`, `downRate`, `percentComplete`, `downTotal`, `upRate`

In condensed view, `percentComplete` gets a sub-option: "Show progress percent" (`torrentListShowProgressPercent`).

Columns are user-sortable via drag-and-drop in the UI settings. Visibility is per-column with a checkbox.

---

## Torrent Detail Modal Tabs

File: `client/src/javascript/components/modals/torrent-details-modal/TorrentDetailsModal.tsx`

| Tab Key | Component | Label |
|---|---|---|
| `torrent-details` | `TorrentGeneralInfo` | Details |
| `torrent-contents` | `TorrentContents` | Files |
| `torrent-peers` | `TorrentPeers` | Peers |
| `torrent-trackers` | `TorrentTrackers` | Trackers |
| `torrent-mediainfo` | `TorrentMediainfo` | Mediainfo |

### Details Tab (`TorrentGeneralInfo.tsx`) — All Fields

**General section:**
- Date Added (`torrent.dateAdded` — unix timestamp × 1000)
- Location (`torrent.directory`)
- Tags (rendered as `<span class="tag">` chips)

**Transfer section:**
- Date Finished (`torrent.dateFinished`)
- Downloaded (`torrent.percentComplete`%)
- Peers (`connected / total` — `peersConnected` / `peersTotal`)
- Seeds (`connected / total` — `seedsConnected` / `seedsTotal`)
- Date Active (`torrent.dateActive` — 0=never, -1=active now, else timestamp)

**Torrent section:**
- Date Created (`torrent.dateCreated`)
- Hash (`torrent.hash`)
- Size (`<Size value={torrent.sizeBytes}>`)
- Type: Private / Public (`torrent.isPrivate`)
- Comment (with `<LinkedText>` for URLs)

**Tracker section:**
- Tracker message (`torrent.message`)

---

## Add Torrents Modal

File: `client/src/javascript/components/modals/add-torrents-modal/`

Three tabs: By URL, By File, Create New (torrent creator).

### By URL (`AddTorrentsByURL.tsx`) Fields:
- URLs/magnets: `TextboxRepeater` (add multiple URLs)
- Cookies: `TextboxRepeater` (domain → cookie string pairs)
- Tags: `TagSelect` (auto-fills destination path from `torrentDestinations[tag]` setting)
- Destination: `FilesystemBrowserTextbox` with:
  - Base path toggle
  - Completed toggle
  - Sequential download toggle
- Start immediately toggle (in `AddTorrentsActions`)

Calls `TorrentActions.addTorrentsByUrls({ urls, cookies, destination, isBasePath, isCompleted, isSequential, start, tags })`.

---

## Multi-Client Support Pattern

The key architectural pattern for adapting Flood's approach to unified-frontend's qBittorrent-only setup:

### Client Adapter Interface

Each client implements `clientGatewayService.ts` in `server/services/[client]/`. They share a common interface so the UI layer is client-agnostic. The `ClientSettings` type in `shared/types/ClientSettings.ts` is the shared settings schema that all clients expose (bandwidth, connectivity, resources) regardless of underlying client.

### Connection Settings Forms

One form per client:
- `RTorrentConnectionSettingsForm` — SCGI path or URL
- `QBittorrentConnectionSettingsForm` — URL + username + password
- `TransmissionConnectionSettingsForm` — URL + username + password
- `DelugeConnectionSettingsForm` — host + port + username + password

qBittorrent form fields: `url`, `qbt-username`, `qbt-password`.

### Auth flow (qBittorrent adapter)

The Flood server holds the qBittorrent session cookie server-side. The client never sees it. This is exactly the pattern unified-frontend uses with the SID cookie in `/api/qbt/[...path]/route.ts`.

---

## Real-Time Update Pattern (SSE + JSON Patch)

This is more advanced than what unified-frontend needs but worth understanding:

1. Server sends SSE at `/api/activity-stream`
2. Two event types:
   - `TORRENT_LIST_FULL_UPDATE` — complete torrent list (on first connect, or after long disconnect)
   - `TORRENT_LIST_DIFF_CHANGE` — JSON Patch array (RFC 6902 operations)
3. Client applies patches to MobX store with `fast-json-patch`
4. Server tracks previous state per SSE connection for efficient diffs
5. Keep-alive pings every 500ms; auto-retry on disconnect

**For unified-frontend:** React Query polling at 5s intervals is sufficient for the downloads page. SSE would reduce latency but adds server complexity. The VueTorrent approach (2s polling of `/sync/maindata` with incremental diffs from qBit's built-in diff API) is easier since qBittorrent provides the diffs natively.

---

## MobX Store Architecture (12 stores)

| Store | Relevant to downloads page |
|---|---|
| `TorrentStore` | Primary — torrent list, selection, filter state |
| `SettingStore` | Column visibility, UI prefs |
| `UIStore` | Modal state, active modal ID |
| `TransferDataStore` | Global up/down speeds, history for graph |
| `TorrentFilterStore` | Filter taxonomy (status counts per state) |
| `ClientStatusStore` | Connection health |
| `DiskUsageStore` | Free space per mount |
| `AlertStore` | User-facing alerts |

The React Query + Zustand setup in unified-frontend covers the same ground without MobX.

---

## Reusable Patterns for Downloads Page Rebuild

### 1. Column system
Flood's `TorrentListColumns` const (21 columns) is simpler than VueTorrent's (58 columns). For unified-frontend's initial implementation, use Flood's column set as the baseline and add VueTorrent's advanced columns later.

### 2. Two-view sizing (Expanded / Condensed)
Flood has a clean two-mode list: expanded (full row with all columns) and condensed (compact row). This is easier to implement than VueTorrent's full three-mode (list/grid/table) system. Recommend starting with expanded only, then adding condensed.

### 3. Detail modal tab structure
Five tabs: Details, Files, Peers, Trackers, Mediainfo. The Details tab field set maps directly to what qBittorrent's `GET /api/v2/torrents/properties?hash=<hash>` returns.

### 4. Add torrent flow
The URL → Tags → Destination → Start pattern from `AddTorrentsByURL` is the cleanest reference. The `FilesystemBrowserTextbox` with base-path and sequential-download toggles maps to qBittorrent add payload fields.

### 5. Filtered torrent taxonomy
Flood's `TorrentFilterStore` computes counts per status (`downloading: 3`, `seeding: 12`, etc.) — useful for sidebar filters with badge counts. VueTorrent's `torrentsByStatus` computed is the same concept.

### 6. Connection settings form
The `QBittorrentConnectionSettingsForm` shows the minimal fields needed: URL + username + password. The `type: 'web'` and `version: 1` fields in the settings object identify the qBittorrent adapter.

---

## Notes on Flood vs VueTorrent for the Downloads Page

| Concern | Flood | VueTorrent | Recommendation |
|---|---|---|---|
| Column set | 21 columns | 58 columns (including qBit 5+ fields) | Use VueTorrent's list as the authoritative field reference; use Flood's default visible set |
| Detail tabs | 5 (Details/Files/Peers/Trackers/Mediainfo) | 6 (Overview/Info/Trackers/Peers/Content/Tags+Cats) | Flood's tabs map more cleanly to qBit API responses |
| Add dialog | URL/File/Create | URL/File | Flood's simpler — good starting point |
| UI settings | React (Lingui, Panda CSS) | Vue/Vuetify | Flood is closer to the unified-frontend React stack |
| Real-time | SSE + JSON Patch | Polling + qBit sync diffs | VueTorrent's polling approach is simpler to implement |
| Multi-client | Yes (4 clients) | qBit only | Flood's adapter pattern is the reference if other clients ever needed |
