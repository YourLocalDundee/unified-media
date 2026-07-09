# Unified Torrent System (v0.5.2+)

## Types file

All qBittorrent API types live at `src/types/torrent.ts`, using exact qBittorrent field names so
responses assign directly without mapping:

- `QbtTorrentState` — union of 19 state strings
- `QbtTorrent` — full torrent list item (44 fields)
- `QbtTorrentProperties` — per-torrent detail from `/torrents/properties` (33 fields)
- `QbtTrackerInfo`, `QbtPeerInfo`, `QbtFileInfo` — detail panel data
- `QbtTransferInfo` — global speeds + disk space
- `QbtPreferences` — all 90 app preference fields from `/app/preferences`
- `TorrentUIPreferences` — localStorage-only UI settings (`unified-torrent-prefs`)

The legacy `Torrent` interface in `src/lib/qbittorrent/types.ts` is extended with the extra fields
(`magnet_uri`, `availability`, `super_seeding`, `force_start`, `seq_dl`, `f_l_piece_prio`, …) to remain
compatible with existing hooks.

## Proxy audit findings (`src/app/api/qbit/[...path]/route.ts`)

Three gaps were found and fixed:

1. **Multipart passthrough** — the old proxy did `new URLSearchParams(text)` for all POST bodies,
   destroying multipart data. It now checks `Content-Type`: if `multipart/form-data`, it reads the body
   as `ArrayBuffer` and forwards verbatim with the original `Content-Type` (including `boundary=`).
   Required for `.torrent` file upload to `/torrents/add`.
2. **Query params on POST** — the old proxy dropped the query string on POST. Fixed by appending
   `req.nextUrl.search` in both the form-urlencoded and multipart paths.
3. **Re-auth on 403** — `qbitFetch` in `session.ts` already handled this (clear session, re-login,
   retry once). The new multipart path adds the same retry manually since `qbitFetch` only accepts
   `URLSearchParams`.

## Downloads page (`/downloads`)

Full qBittorrent client UI.

| Component | File |
| --------- | ---- |
| Main page (table, rows, add-torrent, speed graph, settings slide-over) | `src/app/downloads/page.tsx` |
| Per-torrent detail panel (v0.9.10) | `src/app/downloads/TorrentDetailPanel.tsx` |

**Per-torrent detail panel (v0.9.10):** click a torrent name to expand an inline panel with four tabs —
**Overview** (speeds, seeds/peers, ratio, save path…), **Files** (per-file list with a priority
`<select>` Skip/Normal/High/Max + progress bars), **Trackers**, **Peers**. All tabs live-refresh every
2s while open. Fetch failures surface as an explicit error (distinct from a genuinely empty list).
Calls go to `/api/qbit/...` (note the **`qbit`** spelling — `/api/qbt` 404s).

> The committed `src/app/downloads/components/*` (FilterSidebar/TorrentRow/DetailPanel/AddTorrentModal)
> are a **dead alternate UI** from an earlier draft — not wired into the live page (see the 2026-06-13
> audit dead-code list). The live UI is `page.tsx` + `TorrentDetailPanel.tsx`.

### qBittorrent endpoints used

| Endpoint | Purpose |
| -------- | ------- |
| `GET /torrents/info` | Torrent list (polls 2s) |
| `GET /transfer/info` | Global speeds, free space, DHT nodes |
| `GET /torrents/categories` | Category list (filter sidebar) |
| `GET /torrents/tags` | Tag list (filter sidebar) |
| `GET /torrents/properties?hash=` | Per-torrent detail (Overview) |
| `GET /torrents/files?hash=` | File tree (Files) |
| `GET /torrents/trackers?hash=` | Tracker list (Trackers) |
| `GET /sync/torrentPeers?hash=` | Peer list (Peers) |
| `GET /app/preferences` | Server preferences (Settings) |
| `POST /torrents/pause` / `resume` / `delete` | Bulk actions (delete optional file removal) |
| `POST /torrents/recheck` / `reannounce` | Force recheck / reannounce |
| `POST /torrents/add` | Add by URL (form-urlencoded) or file (multipart) |
| `POST /torrents/filePrio` | Per-file priority |
| `POST /torrents/addTrackers` / `removeTrackers` | Tracker edit |
| `POST /transfer/banPeers` | Ban a peer |
| `POST /transfer/toggleSpeedLimitsMode` | Toggle alt speed limits |
| `POST /torrents/setDownloadLimit` / `setUploadLimit` | Per-torrent limits |
| `POST /torrents/setShareLimits` | Ratio/seeding-time limits |
| `POST /torrents/setSuperSeeding` / `setForceStart` / `setAutoManagement` | Toggles |
| `POST /torrents/toggleSequentialDownload` / `toggleFirstLastPiecePrio` | Toggles |
| `POST /app/setPreferences` | Save preferences diff |

## Torrent settings page (`/settings/torrent`)

Eight tabs — first 7 read/write qBittorrent via `/app/preferences` → `/app/setPreferences` (sends only
changed fields as a JSON diff). Tab 8 is localStorage only.

| Tab | Coverage |
| --- | -------- |
| Downloads | Save paths, incomplete dir, `.!qB` ext, auto-delete, subfolder, TMM defaults |
| Connection | Port, UPnP, DHT/PeX/LSD, max connections, encryption, outgoing port range |
| Speed | DL/UL limits, alternative limits, schedule, LAN/uTP/overhead toggles |
| BitTorrent | Anonymous mode, ratio/seeding/inactivity limits, announce options |
| Queue | Queuing enable, active limits, slow-torrent thresholds |
| Privacy | Proxy config, IP filter, banned IPs |
| Advanced | I/O threads, disk cache, socket buffers, HTTPS cert validation, SSRF mitigation |
| Interface | Column visibility/order, sort, rows per page, refresh rate, date format (localStorage) |

## Downloads are admin-only

`/downloads`, `/api/qbit` (GET **and** POST), `/settings/torrent`, and the dashboard "Active Downloads"
section are all gated to `role === 'admin'`. The GET proxy used to be `requireAuth` — since it carries
the server-side qBittorrent session cookie, any authed user could read the full queue/save-paths/prefs;
it now matches the write path's `requireAdmin`. The Sidebar/MobileNav "Downloads" nav item and the
`/settings/torrent` tab are hidden for non-admins. Non-admins lose nothing they could previously mutate
— torrent actions were already admin-only.

## Sequential download piece map (Files tab)

`PieceMap.tsx` renders a canvas strip in the Files tab showing per-piece download state (missing /
downloading / downloaded), with thin dividers at file boundaries (`QbtFileInfo.piece_range`). Data comes
from `GET /api/qbit/torrents/pieceStates?hash=` (returns qBittorrent's `pieces_states` per-piece array;
`0`=missing, `1`=downloading, `2`=downloaded), fetched alongside `QbtTorrentProperties.pieces_num`.

**Pixel-column binning:** torrents can have tens of thousands of pieces but the strip has only a few
hundred/thousand physical pixels. Each pixel *column* aggregates the piece range it covers into a
have/downloading count, then colors by priority (any downloading piece in the bin wins, else a solid
color if uniform, else a linear blend proportional to downloaded fraction). Draw cost is O(pieces) per
frame regardless of piece count, not O(pieces) canvas calls.

**Theme-aware:** colors are read from the app's `--theme-*` CSS custom properties via
`getComputedStyle` (canvas `fillStyle` can't resolve `var(--x)` directly) — covers all built-in themes
plus user-created custom themes, not just light/dark. No animation (static redraw only on data/resize
change), so there's nothing to gate behind `prefers-reduced-motion`.

Admin-only (part of the Files tab, which is behind `/downloads`'s admin gate).

## Create-torrent dialog (admin)

`CreateTorrentDialog.tsx` builds a `.torrent` from a local file/folder path via qBittorrent 5.x's
**async** torrent-creation task API (scope `torrentcreator`, not `torrents`):

1. `POST /api/qbit/torrentcreator/addTask` queues the job server-side and returns `{taskID}` —
   hashing happens on the qBittorrent side, not synchronously in the request.
2. `useCreateTorrentTask()` (`src/lib/qbittorrent/hooks.ts`) polls `GET
   /torrentcreator/status?taskID=` every 1.5s until `status` is `Finished` or `Failed`.
3. On `Finished`, the dialog offers a download link to `GET
   /api/qbit/torrentcreator/torrentFile?taskID=`, which returns the binary `.torrent`.

**Binary-safe GET passthrough:** the `/api/qbit` GET proxy normally decodes every response as JSON/text
via `qbitFetch`, which would corrupt a binary `.torrent` body. `/torrentcreator/torrentFile` is special-
cased in `route.ts` to stream the response through as an `ArrayBuffer` with the original
`Content-Type`/`Content-Disposition`, with the same 403-retry-once behavior as every other call.

Admin-only (lives on the `/downloads` page).
