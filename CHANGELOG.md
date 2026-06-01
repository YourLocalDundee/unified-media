# Changelog

All notable changes to unified-frontend are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.6.0] — 2026-05-30

### Added
- **Native health endpoint rewrite** — `GET /api/health` now checks `getDb().prepare('SELECT 1').get()` for DB reachability and `fs.access(MEDIA_ROOT, R_OK)` for media directory accessibility. Returns `{ status: 'ok' | 'degraded', db: bool, media: bool, timestamp: ISO string }` with HTTP 200 or 503.
- **Media server health in server-status** — `GET /api/admin/server-status` gains a `media: { ok, root }` field that verifies `MEDIA_ROOT` is accessible. Seerr and qBit checks retained.
- **New API routes** — `GET /api/media/series/[id]/next-episode`, `GET /api/media/subtitles/[id]/[streamIndex]`, `GET /api/media/seasons/[seasonId]/episodes`, `GET /api/media/items/[id]/similar`, `GET /api/media/filters`.
- **ProbeStream interface** — `src/lib/media-server/types.ts` gains `ProbeStream` interface; `ProbeResult` extended with `audioStreams: ProbeStream[]` and `subtitleStreams: ProbeStream[]`.
- **JellyfinError class** — added to `src/lib/jellyfin/client.ts` with `status`, `isAuthError`, `isNotFound`, `isServerError` getters.
- **Config validation at startup** — `instrumentation.ts` gains `validateConfig()`: fatal on missing `ADMIN_USERNAME`/`ADMIN_PASSWORD`, warns on missing Jellyfin vars.
- **Browse — Similar items** — "More Like This" section added at the bottom of `/browse/[id]`. Calls `getSimilarItems(id, 12)` directly in the server component. Hidden for episodes and when no results are returned. Renders a `MediaCard` grid.
- **Browse — Year filter** — `/browse` gains year filter pill buttons below type tabs, populated by `getAvailableFilters()`. Selecting a year adds `?year=YYYY` to the query string. Pagination is disabled when a year filter is active.

### Changed
- **`continue-watching/route.ts`** — Rewrote to use native SQL joining `media_items` and `media_watch_state`. All Jellyfin imports removed.
- **`EpisodeCard.tsx`** — Replaced `JellyfinEpisode` type with `NativeEpisode` (snake_case fields). Images now served via `/api/media/image?path=...`.
- **`EpisodeCarousel.tsx`** — Calls `/api/media/seasons/${seasonId}/episodes` instead of the Jellyfin route. Uses `NativeEpisode`.
- **`SeriesSection.tsx`** — Replaced `JellyfinSeasonShape` with `NativeSeason { id, title, season_number }`.
- **`probe.ts`** — Full rewrite to extract complete audio and subtitle stream arrays from ffprobe JSON via a `toProbeStream()` helper.
- **`getNativePlaybackData()`** — Now populates `audioStreams`, `subtitleStreams`, `defaultAudioIndex`, `defaultSubtitleIndex` from probe results.
- **`subtitle/scanner.ts`** — Removed `jellyfinFetch` import; now queries `media_items` via SQLite directly.
- **`src/lib/media-server/library.ts`** — `getItemsByType()` accepts an optional `year?: number` fourth param that appends `AND year = ?` to the SQL query.
- **`src/lib/db/index.ts`** — Default DB path changed from string literal `'./unified.db'` to `path.join(process.cwd(), 'unified.db')`.
- **`instrumentation.ts`** — All config validation and startup logic moved inside `if (process.env.NEXT_RUNTIME === 'nodejs')` guard. Fixes Turbopack Edge Runtime warning about `process.exit` not being supported in Edge.
- **`src/app/api/admin/server-status/route.ts`** — `statSync(dbPath)` now only runs when `process.env.DB_PATH` is explicitly set. Eliminates the NFT trace warning that caused `next.config.ts` to be included in the bundle trace.
- **Auth header format** — Fixed in 3 Jellyfin proxy routes.
- **`VideoPlayer.tsx` progress reporting** — `reportStart`, `reportProgress`, and `reportStop` no longer have `else` branches falling back to `/api/jellyfin/sessions/*`. If `progressApiUrl` is not set they log a warning and return. Removed unused `mediaSourceId`, `playSessionId`, and `isHls` from callback dep arrays.
- **`VideoPlayer.tsx` fallbacks** — `nextEpisodeApiBase` and `subtitleApiBase` no longer fall back to Jellyfin routes. Both log a warning and skip if not set.

### Removed
- **`src/components/media/JellyfinSeasonList.tsx`** — Deleted. Orphaned component; not imported by any page.
- **Jellyfin health check** — `JELLYFIN_URL/System/Info/Public` check removed from `GET /api/admin/server-status`. Replaced by the native media root accessibility check.
- **Jellyfin env var references** — Zero `JELLYFIN_*` env var references remain outside `src/lib/jellyfin/` and `src/app/api/jellyfin/`.

### Fixed
- Build produces 0 Turbopack warnings (was 2): Edge Runtime `process.exit` warning and NFT trace warning both resolved.

---

## [0.5.3] — 2026-05-26

### Added
- ***arr TypeScript clients** — `src/lib/sonarr/`, `src/lib/radarr/`, `src/lib/prowlarr/`, `src/lib/bazarr/` each with `client.ts` (fetch wrapper with API key injection), `types.ts` (full typed interfaces from live API), and `api.ts` (typed helper functions)
- **API proxy routes** — `src/app/api/{sonarr,radarr,prowlarr,bazarr}/[...path]/route.ts` transparent authenticated proxies; all four gated by `requireAuth()` so API keys never reach the browser
- **Media settings page** — `/settings/media` (admin-only via `requireAdmin()`) with 4 tabs: Indexers (Prowlarr — enable/disable toggle, test button, count badge), TV (Sonarr quality profiles + root folders), Movies (Radarr quality profiles + root folders), Subtitles (Bazarr providers + version info); all tabs gracefully degrade if a service is down
- **Admin requests page** — `/admin/requests` with approval modal that loads quality profiles from Sonarr/Radarr at open time; approve and decline actions update row state inline without page reload; filter tabs (Pending/All/Approved/Declined) load server-side enriched data
- **Decline API route** — `POST /api/seerr/request/[id]/decline`
- **env vars** — `SONARR_URL`, `SONARR_API_KEY`, `RADARR_URL`, `RADARR_API_KEY`, `PROWLARR_URL`, `PROWLARR_API_KEY`, `BAZARR_URL`, `BAZARR_API_KEY` added to `.env.local`

### Changed
- Settings nav — added "Media" tab between Torrent and Advanced
- Admin nav — added "Requests" tab between Invites and Watch Activity
- Jellyfin image proxy — removed `force-dynamic` (was overriding `next: { revalidate: 3600 }`); browser now correctly caches images for 1 hour

---

## [0.5.2] — 2026-05-26

### Added
- **Profile settings page** — fully replaced at `/settings/profile`; four sections: Identity (username read-only, display name, email), Avatar (initials-based with username-hashed consistent hue), Change Password (with live rule checklist and session invalidation on success), Active Sessions (list with device inference, IP, timestamps, Revoke per session, Revoke all others)
- **Profile API routes** — `PATCH /api/auth/profile/display-name`, `PATCH /api/auth/profile/email`, `POST /api/auth/profile/change-password` (rate-limited 5/15min/user, revokes other sessions), `GET /api/auth/profile/sessions`, `DELETE /api/auth/profile/sessions/:id`, `POST /api/auth/profile/sessions/revoke-others`
- **About page rebuild** — version block (Unified Media only), What's New accordion parsing CHANGELOG.md at build time (3 most recent versions), Help & Tips 2×2 grid (Searching, Requesting Content, Player Tools, Keyboard Shortcuts), About blurb
- **Theme Create modal** — "Create theme" entry at bottom of theme picker opens a modal with 6 color pickers, live preview card, saves custom theme as `<style>` tag and to `unified-custom-themes` localStorage; custom themes appear in picker with delete button
- **Torrent types** — `src/types/torrent.ts` with complete TypeScript interfaces: `QbtTorrentState`, `QbtTorrent` (44 fields), `QbtTorrentProperties`, `QbtTrackerInfo`, `QbtPeerInfo`, `QbtFileInfo`, `QbtTransferInfo`, `QbtPreferences` (90 fields), `TorrentUIPreferences`
- **Downloads page rebuild** — full qBittorrent client UI with: global toolbar (speeds, free space, DHT, alt limits toggle), collapsible filter sidebar (status/category/tag filters), configurable torrent list (19 columns, drag-to-reorder, sort by column), multi-select with shift/ctrl, bulk actions bar, right-click context menu, detail panel (Overview/Files/Trackers/Peers/Speed Chart/Options tabs), Add Torrent modal with magnet/URL and `.torrent` file upload, drag-and-drop `.torrent` anywhere on page
- **Torrent settings page** — `/settings/torrent` with 8 tabs: Downloads, Connection, Speed, BitTorrent, Queue, Privacy, Advanced, Interface; diff-only saves to qBittorrent; amber dot on unsaved tabs; Interface tab is localStorage-only
- **Recharts** — added `recharts@^2.15.4` for the speed chart in the downloads detail panel
- **MediaCard image fallback** — checks `ImageTags.Primary` → `ImageTags.Thumb` → `BackdropImageTags[0]` before constructing image URL; `onError` handler falls back to styled placeholder; server logs fallback hits via `console.log`
- `display_name TEXT` column on `users` table (safe additive migration, auto-runs on next `getDb()`)

### Changed
- **Registration** — invite code removed entirely from form, Zod schema, and API handler; email is now required (validated with format check); rate limit raised from 3/hour to 10/15min to match login handler; subtitle changed to "Create your account to get started"
- **About page** — removed Jellyfin/Seerr/qBittorrent version rows; removed Service Links section; replaced static blurb with parsed CHANGELOG accordion
- **Theme system** — each `[data-theme="*"]` block now includes full set of Tailwind CSS variables (`--background`, `--foreground`, etc.) alongside `--theme-*` vars; light/dim/midnight/cinema themes now correctly update all component colors
- **Profile page** — all Authentik header references (`X-Authentik-Username`) removed; page now reads from SQLite via `requireAuth()` and DB query
- **qBit proxy** — POST handler now detects `multipart/form-data` and passes raw `ArrayBuffer` with original `Content-Type` (including `boundary=`) instead of destroying it with `URLSearchParams`; query params forwarded on POST; `Torrent` interface extended with `magnet_uri`, `availability`, `super_seeding`, `force_start`, `seq_dl`, `f_l_piece_prio`, and other extended API fields
- **Settings nav** — Torrent tab added between Display and Advanced
- **Jellyfin image proxy** — accepts `?type=Backdrop&index=0` and constructs `/Images/Backdrop/{index}` path correctly

### Fixed
- Naruto Shippuden (and any item with no `Primary` image tag) now renders a poster using Thumb or Backdrop fallback; client-side `onError` provides a second fallback to a styled placeholder
- Theme switching no longer leaves background/foreground colors unchanged when switching away from dark; `.dark` class specificity was overriding `[data-theme]` selectors — fixed by adding Tailwind vars directly to each `[data-theme]` block

### Security
- Password change revokes all other sessions on success (session fixation prevention)
- Change password endpoint rate-limited to 5 attempts per 15 minutes per user ID
- `.torrent` file upload passthrough no longer strips multipart boundary (previously would silently fail to upload)

---

## [0.5.1] — 2026-05-25

### Added
- **Quality selector** — `MediaQualitySelector` (Settings icon) in video controls bar shows quality options capped at native video resolution; never offers upscaling
- **Screen-aware auto-quality** — on player mount, if screen height < 75% of native video height, auto-selects the highest quality tier that fits the screen (`window.screen.height × devicePixelRatio`)
- **Auto aspect ratio** — `detectAspectRatio()` in VideoPlayer snaps to the nearest standard AR mode (16:9, 4:3, 21:9, 2.35:1, 1:1, 9:16) within 0.15 tolerance from native dimensions; runs once on mount
- `PlaybackData.nativeWidth` / `nativeHeight` — extracted from Jellyfin MediaStream video track
- `PlaybackData.hlsTranscodeUrl` — always populated; constructed from item info when direct play path doesn't provide a TranscodingUrl
- `PlaybackData.availableQualities` — `QualityOption[]` built server-side; first element is always Direct Play or Auto; subsequent elements are standard tiers (4K/1080p/720p/480p/360p/240p) filtered to < native height
- `QualityOption` interface exported from `src/components/player/types.ts`
- Quality switching in VideoPlayer via `activeStreamUrl`/`activeIsHls` state — changing quality reinitializes the HLS pipeline via `retryCount` increment

### Changed
- VideoPlayer now uses `activeStreamUrl` / `activeIsHls` state instead of direct prop references in the HLS init effect; quality changes are applied immediately without full page reload
- `getPlaybackData` fetches `Chapters` from Jellyfin item metadata and includes in `PlaybackData.chapters`
- `ItemMetadata` interface extended with `Chapters` field

---

## [0.5.0] — 2026-05-25

### Added
- **Player tools panel** — `<Sliders>` button in video controls opens a 4-tab overlay (Playback / Video / Audio / Info) ported from VLC source at `modules/gui/qt/` and `modules/audio_filter/`
- **MediaSpeedControl** — playback rate selector (0.25×–4×) synced to `ratechange` event; VLC analogue: `rate` Q_PROPERTY
- **MediaABLoop** — A/B loop with Set A / Set B / Loop toggle / Clear; polls at 300ms; VLC analogue: `ABLoopA`, `ABLoopB`, `toggleABloopState()`
- **MediaFrameAdvance** — step forward/back one frame (assumes 24fps); VLC analogue: `frameNext()` slot
- **MediaAspectRatio** — 7-mode override (auto/16:9/4:3/21:9/2.35:1/1:1/9:16) via CSS `aspect-ratio` + `object-fit`; VLC analogue: `aspectRatio`, `crop`, `fit` Q_PROPERTYs
- **MediaJumpToTime** — MM:SS or HH:MM:SS seek with range validation; VLC analogue: Go to Time dialog
- **MediaVideoEffects** — brightness/contrast/saturation/hue sliders applied via CSS `filter` on video element; VLC analogue: extended video effects panel
- **useAudioChain** — Web Audio API chain: `MediaElementSource → 10×BiquadFilter(peaking) → DynamicsCompressor → GainNode → StereoPanner → destination`; lazily initialized on first user interaction, cached to prevent double-wrap
- **MediaEqualizer** — 10-band EQ (60Hz–16kHz) with 8 presets (Flat/Rock/Pop/Jazz/Classical/Bass/Treble/Vocal) and per-band ±12dB control; VLC analogue: `Equalizer` class, `equalizer.c`
- **MediaAudioTools** — three subsections: Volume Boost (0–200% GainNode), Compressor toggle (DynamicsCompressor with VLC preset values), Stereo Pan (StereoPannerNode ±1); VLC analogue: `Compressor`, `stereo_pan.c`, `gain.c`
- **MediaBookmarks** — localStorage timestamp markers with editable labels, sorted by time; VLC analogue: Bookmarks dialog
- **MediaChapters** — chapter list from Jellyfin with current-chapter highlight and prev/next navigation; VLC analogue: `chapterNext()`, `chapterPrev()`, chapters TrackListModel
- **MediaSnapshot** — canvas-based PNG capture of current video frame, downloads as `{title}-{timestamp}.png`; VLC analogue: `snapshot()` slot
- `chapters?: MediaChapter[]` added to `PlaybackData` type

### Changed
- `VideoPlayer` video element now accepts dynamic CSS `filter` and `aspect-ratio`/`object-fit` styles driven by tool panel state
- `PlaybackData` extended with optional `chapters` field

---

## [0.4.1] — 2026-05-25 (hotfix)

### Security
- CRITICAL: All protected pages now enforce `requireAuth()` server-side (browse, history — were middleware-only)
- CRITICAL: Home page `/` added to middleware protected list (was accessible without any redirect)
- Middleware rewritten with allowlist pattern — all routes require auth by default unless explicitly public
- Stream proxy `/api/jellyfin/stream/[...path]` requires valid session; returns 401 without one
- API keys never reach the browser — stream proxy injects them server-side only

### Fixed
- Sidebar and header no longer appear on login, register, forgot, change-password, or invite pages — `ConditionalLayout` wraps `AppLayout` only on authenticated routes
- HLS playback fixed — stream URLs were pointing to LAN IP `http://192.168.0.50:8096` which browsers cannot reach from the public internet; all streams now route through `/api/jellyfin/stream/` proxy
- HLS manifest segment URLs rewritten by proxy to go through same proxy (not raw Jellyfin LAN URLs)
- `manifestLoadError` now shows specific message based on HTTP status code (401/403/404/network)
- Retry button on player error re-initializes the entire HLS pipeline
- Login page footer changed from "You need an invite" to "Create an account"

### Changed
- Registration no longer requires an invite code — open enrollment
- `ConditionalLayout` client component replaces direct `AppLayout` usage in root layout
- DeviceProfile updated with more permissive codec list and HLS tuning (`MinSegments: 1`, `BreakOnNonKeyFrames: true`)
- `seed.ts` no longer crashes on missing/invalid `ADMIN_PASSWORD` — generates a random fallback and logs it to stderr; sets `force_pw_change = 1`

### Added
- `scripts/db-inspect.js` — inspect users, sessions, invite codes from SQLite
- `scripts/reset-admin.js` — reset or create admin account with password validation
- `src/app/api/jellyfin/stream/[...path]/route.ts` — authenticated HLS/stream proxy with manifest URL rewriting

---

## [0.4.0] — 2026-05-25

### Added
- **SQLite-backed auth system** — `better-sqlite3` with WAL mode, singleton pattern, auto-migration on startup. Tables: `users`, `sessions`, `invite_codes`, `audit_log`, `watch_events`, `login_attempts`.
- **Session management** — 30-day TTL, 24h rotation, 90-day absolute max, `HttpOnly + Secure + SameSite=lax` cookie named `unified-session`, 32-char random ID.
- **Password policy** — 8-64 chars, uppercase + lowercase + special char required, no 3+ repeating chars, blocks "password"/"unified"/username substrings, top-50 blocklist.
- **Invite-code registration** — Admin creates codes with optional expiry and use cap. Shared as `/invite/{code}` links. Rate-limited to 3 registrations/hour/IP.
- **Login with brute-force protection** — Rate limit 10 attempts/15min/IP, progressive 2s delay after 3 username failures in 5min. Never reveals whether username exists.
- **Admin control panel** at `/admin` — Dashboard with 14-day watch chart, active sessions, recent audit log. Sub-pages: Users, Invites, Activity, Audit Log, Server Status.
- **AuthContext** — Client-side context provider fetching `/api/auth/me`, exposes `user`, `loading`, `logout()`, `refresh()`.
- **Security headers** — CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS, Referrer-Policy, Permissions-Policy via `next.config.ts` headers export.
- **CSRF origin check** — `verifyOrigin()` in `src/lib/csrf.ts` validates `Origin` header on state-mutating routes.
- **Open redirect prevention** — `getSafeRedirectUrl()` in `src/lib/safe-redirect.ts` rejects absolute URLs, protocol-relative paths, and loop-back to auth pages.
- **DAL pattern** — `src/lib/dal.ts` (server-only) is the single auth enforcement point for server components and route handlers, per CVE-2025-29927.
- **`/change-password`** — Force-password-change flow triggered by `force_pw_change` flag on login.
- **`/forgot`** — Placeholder page (email-based reset not implemented yet).
- **Docker volume** — `unified-db:/data` named volume for SQLite persistence.
- **Healthcheck** — `/api/health` endpoint returns `{ status, version, uptime }`.
- **IP geolocation** — `src/lib/geo.ts` uses ip-api.com with 1h cache and private-IP short-circuit for audit log enrichment.

### Changed
- **Caddy block** — Removed Authentik `forward_auth` from `unified.minijoe.dev`. App now handles its own auth entirely.
- **AppLayout / Header** — Switched from reading `X-Authentik-*` headers to using `useAuth()` from AuthContext.
- **Login / Register pages** — Fully rewritten. Login shows specific error messages by status code. Register has zxcvbn strength meter (dynamic import), rule checklist, username availability check (debounced 500ms).
- **Middleware** — Rewritten to redirect unauthenticated users to `/login?from={pathname}` and bounce authenticated users away from auth pages.
- **`/watch/[id]`** — `requireAuth()` enforced at server component level.
- **`/browse/[id]`** — `requireAuth()` enforced at server component level.
- **`/settings` layout** — `requireAuth()` enforced at layout level.
- **`/downloads` layout** — `requireAuth()` enforced at layout level (new `layout.tsx`).
- **`/` home page** — `requireAuth()` enforced at server component level.
- **Dockerfile** — Added `/data` directory with correct ownership for non-root `nextjs` user, `VOLUME ["/data"]`.

### Removed
- `src/app/api/auth/local/route.ts` — dev-only Authentik mock stub, no longer needed.

### Security
- Auth is enforced in server components and route handlers (DAL), never relying solely on middleware.
- API keys and passwords never appear in client-side code.
- Session IDs are cryptographically random (32 chars, alphanumeric).

---

## [0.3.0] — 2026-04

### Added
- **Video player** — HLS.js-backed player at `/watch/[id]` with subtitle tracks, audio track switching, resume position, keyboard shortcuts.
- **Playback settings** — `/settings/playback` with quality, audio language, subtitle language/size/background/color, auto-play behavior, and resume mode preferences stored in `localStorage`.
- **Browse detail page** — `/browse/[id]` with full Jellyfin metadata, watch/request actions, episode list for series.
- **Settings layout** — Tabbed settings shell at `/settings` covering Playback and (stub) Account pages.
- **`getPlaybackData`** — Moved to `src/lib/jellyfin/playback.ts` with direct-play and HLS transcoding URL resolution.

### Changed
- Jellyfin playback API route now imports from `lib/jellyfin/playback` (fixed build error: route files cannot export non-HTTP named exports).
- Settings playback page — removed metadata export (cannot export metadata from `'use client'` components).

---

## [0.2.0] — 2026-03

### Added
- **Full service integrations** — Jellyfin library browsing, Seerr request management, qBittorrent download queue.
- **Search** — Unified search across Jellyfin library and Seerr discover at `/search`.
- **Requests page** — `/requests` with filter tabs, status badges, approve/decline actions.
- **Downloads page** — `/downloads` with live polling, pause/resume/delete per torrent, bulk actions, transfer speed stats.
- **Home dashboard** — Continue Watching, Recently Added, Pending Requests, Active Downloads sections with Suspense fault isolation.
- **MediaCard component** — Poster card used across browse, search, and home.
- **Image proxy** — `/api/jellyfin/image/[id]` route injects auth header so images render without embedding API keys in HTML.
- **qBittorrent session manager** — server-side SID cookie auto-refresh, retry on 403.
- **CSS variable theme** — Dark/light mode via `prefers-color-scheme` with `--color-*` tokens.

---

## [0.1.0] — 2026-02

### Added
- Next.js 15 App Router scaffold with TypeScript strict mode, Tailwind CSS, standalone Docker output.
- Docker multi-stage build (`builder` → `runner`), non-root user, `output: 'standalone'`.
- `docker-compose.yml` service entry, Caddy reverse proxy route.
- `AppLayout` — sidebar navigation with service links, mobile-responsive.
- Environment variable wiring for Jellyfin, Seerr, qBittorrent.
- `CLAUDE.md` project documentation.
