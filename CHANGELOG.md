# Changelog

All notable changes to unified-frontend are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Added
- **Per-indexer rate limiting: queries/day + grabs/day.** Adds two configurable daily caps per
  indexer (`rate_limit_queries_per_day`, `rate_limit_grabs_per_day`; 0 = unlimited) stored in the
  `indexers` table. Counters (`daily_query_count`, `daily_grab_count`, `daily_stats_date`) reset
  each UTC day via `checkAndResetDailyStats()`. The search fan-out gates on the query cap before
  querying; the grab cron filters candidates at their grab cap before picking the best release.
  Admin UI (`/admin/indexers`) gets two new number inputs in the edit modal plus a per-indexer
  today-usage line (e.g. "Queries: 47/100 today · Grabs: 2/5 today") visible only when a limit
  is set. Builds on the existing in-memory per-minute token bucket — adds the persistent daily
  layer on top.
- **Party Play: creator-kick + control-lock.** Two host-only moderation actions. Kick: the host
  can boot any member via a `UserX` button in the roster; the server broadcasts `member_kicked`
  to all members (the kicked client sees the message before their socket closes with code 4003),
  stamps `kicked_at` in `watch_party_members`, and prevents rejoin via `isActiveMember()`.
  Control-lock: the host toggles a "Lock controls to me" button; the server sets `control_locked`
  on the live state + persists to `watch_parties`, broadcasts `control_locked` to all members,
  and rejects `control` messages from non-hosts while the flag is active. Lock state survives
  server restarts (hydrated from DB on join and rehydrate). Non-host members see an amber
  "Host has locked playback controls" banner.

### Removed
- **Purged upstream `sources/` reference material (147 MB, 7 directories).** The native stack is
  complete and the source copies were reference-only (gitignored, never imported). All value was
  mined before deletion: `docs/analysis/source-mining-log.md` is the permanent record covering all
  13 upstream sources (including the 6 already purged in prior sessions). New gap items from the
  mining added to `docs/incomplete/FEATURE-IDEAS.md` (automation: per-indexer rate limiting, Movie
  Collections, delay profiles, TV upgrade/cutoff, category mapping, indexer flags/stats, edition
  parsing, cutoff-unmet surface, FlareSolverr, auto tagging; party: tri-state badge, creator-kick,
  per-member playhead, roster avatars, message reactions, subtitle sharing, season-queue, loop
  toggle). Build confirmed green before and after removal. `CLAUDE.md` and `.gitignore` updated.

- **unified-media is now fully Authentik-free in docs too.** Authentik left the request path at
  v0.4.0 (the app uses its own SQLite sessions); this scrubs the last textual leftovers so the string
  appears nowhere in the repo. Deleted the stale `AUTHENTIK_SETUP.md` setup guide; reworded the auth
  notes in `CLAUDE.md`, `SETUP.md`, `docs/complete/FEATURES.md`, and the `update-caddyfile.py`
  docstring to describe self-managed auth without naming a provider; fixed two stale audit lines that
  implied email re-verification was gated "behind Authentik"; and genericized the historical CHANGELOG
  release notes and the pre-build seerr-analysis suggestion. No code changed (there was none to
  change); build stays green.
- **unified-media is now fully Jellyfin-free.** Removed the last leftover Jellyfin references from
  the app. The native media-server stack already handled all in-app browse/playback; nothing called
  Jellyfin at runtime. Specifically: dropped the dead `JELLYFIN_*` startup-warning check
  (`instrumentation.ts`), the unused `192.168.0.50:8096/Items/**` image `remotePattern`
  (`next.config.ts`), and the disabled "Jellyfin URL Override" section (`settings/advanced`); removed
  the `JELLYFIN_*` vars from `.env.local` / `.env.local.example`. `@jellyfin/sdk` was already absent
  from `package.json` (no-op). A standalone Jellyfin still runs separately for direct TV use and is
  out of scope.

### Changed
- **Renamed `subtitle_wants.jellyfin_item_id` / `jellyfin_item_type` → `media_item_id` /
  `media_item_type`** (legacy naming artifact; data was always sourced from the native `media_items`
  table). Idempotent `ALTER TABLE … RENAME COLUMN` migration preserves existing rows and
  auto-rewrites the table's indexes; verified against an old-schema DB.
- Scrubbed Jellyfin from CLAUDE.md (§1 overview, §2 architecture note, §3 service table, §4 tech
  stack, §7 gotchas, §8 env), SETUP.md, and in-code comments/UI strings. Marked
  `docs/incomplete/independence-roadmap.md` as archived. Moved the optional "Jellyfin user linking"
  backlog idea out to the minime-stack (`future-ideas.md`) as a separate-project integration.
- **Docs reorg.** `CLAUDE.md` trimmed from ~1,824 lines to a lean entry point. Deep-dives moved
  under `docs/`: audit block -> `docs/analysis/audit-2026-06-13-summary.md`; player internals ->
  `docs/player/`; torrent system -> `docs/features/torrent-system.md`; Party Play ->
  `docs/features/party-play.md`; decision engine -> `docs/features/decision-engine.md`; build
  phases + independence build -> `docs/complete/FEATURES.md`; future-ideas backlog -> split into
  `docs/complete/FEATURES.md` (done) and `docs/incomplete/BACKLOG.md` (open).
- Added `docs/README.md` (index + conventions), `docs/CLAUDE-MD-GUIDE.md` (token-efficiency
  guide), `docs/WHATS-NEXT-PROMPT.md` (planning prompt + voice-chat spec),
  `docs/incomplete/FEATURE-IDEAS.md`.

> Documentation-only reorganization. No source code changed; the build is unaffected.

## [0.10.2] — 2026-06-23

Bucket-1 loose-end cleanup — surfacing pieces of the v0.10.0 decision engine and Party queue that
shipped with an API/engine but no UI, plus a subtitle-matching improvement. See
`analysis/bucket1-cleanup-session-2026-06-23.md`.

### Added
- **Grab-gate thresholds admin UI** (`/admin/automation` → "Grab Gates"). The hard-gate thresholds
  (`gate_min_seeders`, `gate_max_size_movie_gb`, `gate_max_size_tv_gb`) shipped in v0.10.0 as
  `app_settings` keys that could only be changed by SQL. They now have three numeric inputs that
  read via `GET /api/admin/settings` and save via `PUT` (values clamped to non-negative ints; 0 on a
  max-size disables that cap, matching `gates.ts`). No redeploy needed — the grabber reads the keys
  each search.
- **Blocklist admin page** (`/admin/automation` → "Blocklist"). The `grab_blocklist` table and its
  `GET/POST/DELETE /api/automation/blocklist` API shipped in v0.10.0 with no UI. There is now a table
  of blocklisted releases (info hash, title, reason, when) with a remove (unblock) action and a
  manual "block this hash" form. The metadata reaper still auto-populates it; this just makes it
  visible and editable.
- **Party queue reorder controls** (`PartyPanel`). The shared "Up next" queue's `reorderQueue` op
  was wired end-to-end (hook → WS → server → durable mirror) in v0.10.0 but the panel only exposed
  remove + Play next. Each queued item now has move-up / move-down buttons (the unavailable
  direction is disabled at the endpoints). Chose move buttons over HTML5 drag deliberately — mobile
  (touch) is the primary surface and move buttons are touch-reliable and keyboard-accessible. They
  map directly onto the existing `reorderQueue(itemId, toIndex)`; no protocol or server change.

### Fixed
- **Episode subtitle matching** now searches OpenSubtitles by the **series** IMDB id plus
  `season_number`/`episode_number` instead of relying on a (usually absent, always weaker)
  per-episode IMDB id. `SubtitleSearchParams` gained `parent_imdb_id` / `season_number` /
  `episode_number`; the OpenSubtitles client emits them; the on-demand search route
  (`GET /api/media/subtitles/search`) resolves the parent series row via `series_id` for an episode
  and prefers `parent_imdb_id` + S/E, falling back to the episode's own imdb, then a series-title
  query (all still passing S/E when known). Movie search is unchanged. The grab path is unaffected
  (it downloads by `file_id`).

### Changed
- The two `/admin/automation` sections live on the existing page (one mount fetch, deferred a tick
  per the `set-state-in-effect` rule). `type-check` + `lint` clean at error level.

## [0.10.1] — 2026-06-23

### Changed
- **Lint cleanup: all 78 `eslint-plugin-react-hooks` v6 warnings fixed with real code changes (no
  suppressions), and the four React-Compiler-era rules promoted from `warn` back to `error`.** These
  rules (`set-state-in-effect`, `refs`, `purity`, `immutability`) shipped at `error` in
  `eslint-config-next@16` but were briefly downgraded during the v16 migration because the codebase
  predated them. That cleanup pass is now done — `npm run lint` is clean at error level, so a new
  violation fails the build. `type-check` and `build` remain green; behavior is preserved throughout.
  - **`set-state-in-effect` (44 sites).** Fetch-on-mount effects defer their work a tick
    (`setTimeout(fn, 0)` + `clearTimeout` cleanup) so the loading/data setStates no longer run in the
    effect's synchronous commit path. Debounced search effects (PartyPanel, register username/strength)
    moved their setStates inside the debounce timeout. Prop-sync (`SearchInput`) switched to the React
    "adjust state during render" pattern. Player-tool localStorage restores (Equalizer/Transform/Video
    Effects/Audio Tools/Subtitles) and the theme components defer only the React state commit (imperative
    applies — audio chain, video transform, `applyTheme` — stay synchronous, so no flash).
  - **`refs` (16 sites).** Latest-value ref writes (`usePartySync`, `VideoPlayer`) moved from render into
    effects; refs read in JSX (`pendingResumeSeconds`, the stats-overlay resolution) became state set from
    event handlers.
  - **`purity` (4).** Render-time `Date.now()` reads in admin pages routed through a `nowMs()` helper.
  - **`immutability` (4).** The `textTracks[i].mode` write iterates via `Array.from`; the keydown
    handler's use-before-declaration of `toggleFullscreen`/`toggleMute`/`totalSubCount` now goes through a
    live ref, and `detectAspectRatio` was hoisted to module scope.
  - New shared helpers: **`useIsClient`** (a `useSyncExternalStore` is-client gate used by `ModalPortal`
    and `useSettings`), and **`useSettings`** prefs now read through a `useSyncExternalStore` localStorage
    store (the `ready` flag is preserved for the player's one-time audio/subtitle default logic).
  - Also: 4 `<img>` → `next/image`, 2 internal `<a>` → `next/link`, the flat config's anonymous default
    export named, and 2 stale `eslint-disable` directives removed.

## [0.9.11] — 2026-06-21

### Added
- **On-demand subtitle search in the player** — the subtitle menu gains a "Search online…" entry that
  searches OpenSubtitles for the title currently open and injects the picked subtitle as a **live `<track>`**
  with no page reload. This closes the loop on Phase 4: background auto-download already served subtitles to
  the player at page-load; viewers can now also fetch one mid-playback when none exists yet.
  - **`GET /api/media/subtitles/search?mediaId=&language=&hi=`** (`requireAuth`) — resolves the item's IMDB id
    **server-side** from the media id (never trusts it from the browser) and queries OpenSubtitles; falls back
    to a title query when the item has no IMDB id. Returns trimmed candidates (release, language, HI, trusted,
    download count, uploader). Search does **not** spend the OpenSubtitles daily *download* quota.
  - **`POST /api/media/subtitles/grab`** (`requireAuth` + `verifyOrigin`, rate-limited 10/hr/user) — downloads
    the chosen file, persists it like an auto-download (`upsertSubtitleWant` → writes the `.srt` next to the
    media file with language/HI/forced markers so variants don't clobber → `status='downloaded'`), and returns
    the stable `subtitle_wants.id`. Surfaces remaining daily quota; maps OpenSubtitles 406 → a clear
    "daily limit reached" message.
  - **`GET /api/media/subtitles/want/[wantId]`** (`requireAuth`) — serves a downloaded subtitle by its
    immutable `subtitle_wants.id` as WebVTT. The existing `/{id}/{index}` route keys by *positional* index,
    which shifts when a sub is added — unsafe for a live-injected track — so live grabs use this stable URL.
  - The captions button now shows even when a title has **zero** tracks (when the native subtitle proxy is
    available) so a viewer can open the search. `srtToVtt` was extracted to `src/lib/subtitle/vtt.ts` and shared
    by both serving routes. The keyboard-shortcut guard now also ignores `<select>` focus.

### Fixed
- **OpenSubtitles search returned zero results (feature was dead).** `searchSubtitles` filtered candidates on
  `attributes.format`, which the v3 search API leaves `undefined` for every row — so it silently discarded all
  matches. Confirmed against the live API (145 results → 0 kept). The filter is removed; format is normalised at
  download time via `sub_format: 'srt'` and the written file is content-validated. This had masked the feature
  entirely (auto-download included), hidden only by the never-configured API key.
- **OpenSubtitles login for the VIP quota.** The client only sent the static `Api-Key`, which draws on a low
  ~100/day anonymous bucket — never the VIP 1000/day. It now does `POST /login` with `OPENSUBTITLES_USERNAME` +
  `OPENSUBTITLES_PASSWORD`, caches the JWT (~24h, refreshed on expiry/401) and `base_url`, and sends it as a
  Bearer token on `/download` and `/infos/user`. New `GET /api/subtitle/account` (admin) surfaces the live
  `/infos/user` quota (`allowed_downloads`, `remaining_downloads`, `vip`). New env: `OPENSUBTITLES_USERNAME`,
  `OPENSUBTITLES_PASSWORD` (blank = run at ~100/day). `VIP_DAILY_DOWNLOAD_CEILING = 1000` documents the ceiling.

### Tooling / Housekeeping
- **`next lint` fixed for Next 16.** Next 16 removed the `next lint` command and there was no ESLint config in
  the repo, so linting was completely broken. Added a flat `app/eslint.config.mjs` (spreads `eslint-config-next`),
  switched the script to `eslint .`, fixed 2 pre-existing unescaped-entity errors, and set the new strict
  `react-hooks` v6 rules (`set-state-in-effect`/`purity`/`immutability`/`refs`) to `warn` so the ~50 pre-existing
  hits don't hard-fail the migration. `npm run lint` now exits 0.
- **`app/package.json` version bumped 0.9.9 → 0.9.11** to match the CHANGELOG and CLAUDE header (it had lagged
  two releases behind).

---

## [0.9.10] — 2026-06-21

### Added
- **Story-arc grabs (TMDB episode_groups)** — long-running anime that TMDB bundles into multi-arc "seasons"
  (e.g. One Piece S13 = "Impel Down & Marineford") can now be grabbed per **arc**. `getArcs(tmdbId)`
  (`tmdb.ts`) reads TMDB episode_groups (type 5, preferring "Arcs (Official)"), returning each arc's real
  episode range as a separate grabbable card (Impel Down 422–458, Marineford 459–516). Cached via Next's
  fetch data cache + a per-process `Map`. Series TMDB doesn't arc-group fall back to plain season cards.
- **Interactive admin grab** — the grab modal (`SeasonGrabControl`, season/arc-aware) gains a "Choose
  release" action that lists the FULL `/api/torrent-search` candidate set (zero hard rejects, scorer-rejected
  releases included) and grabs the chosen one through the same `/api/grab/season` enqueue path via a
  `requireAdmin`-gated `override` mode.
- **Manual search in the interactive chooser** — the "Choose release" chooser is now two tabs: **Auto
  candidates** (the scored auto-query list, unchanged) and **Manual search**, a free-text box that queries the
  same `/api/torrent-search` indexer path with the admin's typed query to find a specific release group,
  uploader, or differently-named batch the arc/season query missed. Manual results render in the identical
  release/seeds/size/score/Grab table and grab through the identical `override` enqueue path — no separate
  indexer or grab path. They are scored and 0-seed-flagged like the auto list, and the Grab button is never
  gated on score (a low/zero score never blocks a manual grab). Box seeds with the show title; manual results
  are de-duped by infoHash and any row already in the auto list is tagged "in Auto" but stays grab-able.
- **Per-torrent detail panel on `/downloads`** (`TorrentDetailPanel.tsx`) — click a torrent to expand
  Overview / Files (with per-file priority) / Trackers / Peers, live-refreshing every 2s; fetch errors are
  surfaced distinctly from a genuinely empty list.
- **`scope_label` column** on `monitored_items` + `media_requests` — stores the arc name ("Impel Down") so
  the Requests page shows the arc the user picked, not the merged TMDB season. Requester username now shows
  inline on each Requests row (visible on all screen sizes).

### Changed
- **Grab cron interval 15 min → 5 min** (`automation/scheduler.ts`) for faster episode discovery.
- **Seed-aware soft scoring (auto-pick)** — auto-pick now de-prioritizes instead of hard-rejecting:
  `scoreReleaseSoft` + `autoPickScore` rank by quality (required-condition miss = −100 penalty, not removal)
  + custom format + seed weighting (+min(seeders,100); 0-seed = −1000) + language preference (−100 on
  mismatch). Result: healthy in-range releases beat dead "correct-quality" ones, a 0-seed release never
  auto-grabs, and the interactive list keeps every release grab-able. The grab-results panel uses the same
  rank and no longer shows a hard "Rejected" label.
- **Request→item resolution** is now scope-aware: a request resolves to its active, narrowly-scoped
  monitored item (the arc's wanted episode), not a stale `full`-series container — and the display and
  re-search routes resolve identically.
- **Episode-grab honesty** — `mode:'episodes'` returns `{queued, failed, total, status:'scheduled'}` with
  per-episode failures logged + counted; the toast says episodes are scheduled for search, not downloading.

### Fixed
- **Anime absolute episode numbering** — for TMDB absolute episode numbers (>99) the grabber queries the
  bare number ("One Piece 422") and matches a word-boundary'd absolute number (excluding CRC-hash tails),
  so anime releases are found and arc/range packs match.
- **Wrong-title contamination** — a year-pin in `filterByScope` (all scopes) rejects releases whose embedded
  year contradicts the item's year (e.g. the 2023 live-action One Piece for the 1999 anime).
- **Downloads "NaN undefined/s"** — qBittorrent uses `up_info_speed`/`up_info_data` (not `ul_*`); fixed
  across `TransferInfo` and the UMT client; `formatBytes` is now NaN/undefined/≤0-safe.
- **Files (0) on every torrent** — the detail panel called `/api/qbt/...` (404) instead of `/api/qbit/...`.
- **qBittorrent `add` 409 (duplicate)** — treated as a successful no-op grab instead of an error that
  retried the item every 5 min forever.
- **Browse sort render crash** — the sort-direction toggle was an `onClick` in a Server Component; extracted
  to a `'use client'` `SortDirButton`. Library gains date-added sort + `idx_media_added_at` index.

---

## [0.9.2] — 2026-06-05

### Changed
- **Download client rebranded as UMT (Unified Media Torrent)** — the custom download client abstraction layer (`src/lib/download-client/`) is now branded as Unified Media Torrent. Environment variable keys renamed: `QBIT_URL` → `UMT_URL`, `QBIT_USERNAME` → `UMT_USERNAME`, `QBIT_PASSWORD` → `UMT_PASSWORD`. The `DOWNLOAD_CLIENT` default value changed from `qbittorrent` to `umt`. The underlying qBittorrent backend is unchanged.
- **Browse page**: Removed redundant "Library" tab from the in-page browse tabs — Library is already accessible via the sidebar nav link. The `/browse?type=all` route continues to work.
- **Importer path fix**: `buildLocalTargetPath()` now correctly uses `/media/movies/` and `/media/tv/` for direct filesystem operations instead of `/data/` (the SQLite volume).
- **Importer token matching**: Fallback 2 matching upgraded from prefix comparison to token-based scoring, correctly handling filenames with `www.site.tld -` prefixes (e.g. `www.UIndex.org - The Boys S05E08...`).
- **Quick + interactive grab**: Interactive torrent picks on 48hr requests now grab immediately without admin approval, matching Radarr's interactive search behavior.
- **ACL fix**: `/mnt/media/movies` and `/mnt/media/tv` now grant write access to the container user (uid 1001) via `setfacl`, enabling the importer to place files directly into the library.

### Added
- **Series scope selector** — TV series requests now show a scope picker (Full Series / specific seasons / specific episodes) before submitting. The `SeriesScopeModal` is wired into `RequestOptions` for all TV media types. Scope is stored on `media_requests` and `monitored_items` and honored by the grabber's search query builder.
- **TMDB season/episode route** (`GET /api/tmdb/tv/[tmdbId]/season/[seasonNumber]`) — returns episode list for the scope picker modal.
- **Scope badge in requests** — the `/requests` page and admin requests page now display a scope summary badge on TV requests (Full Series / Season 1,2 / S01E01–E03).
- **`/mnt/media/downloads/complete` mount** added to unified-frontend container (read-only) so the importer can detect and import files from qBittorrent's completed download directory.

---

## [0.9.1] — 2026-06-04

### Fixed
- **BunkerWeb: disabled `USE_BLACKLIST` for `unified.minijoe.dev`** — IP reputation blocklist feeds (Emerging Threats, firehol, etc.) were flagging cellular carrier NAT pool ranges, resulting in 403 for first-time external and mobile visitors. 2,472 IPs were blocked at time of discovery. `USE_BLACKLIST=no` now set per-domain in edge compose for both `bunkerweb` and `bwscheduler` services.
- **Subtitle scheduler no longer crashes when `OPENSUBTITLES_API_KEY` is unset** — `downloadPendingSubtitles()` now returns immediately with a warning log when the key is absent; previously it would attempt network calls and surface 401 errors through the cron job. Both cron callbacks in `scheduler.ts` wrapped in try/catch.
- **Admin seeding documented correctly** — CLAUDE.md previously claimed the container would `process.exit(1)` on missing `ADMIN_PASSWORD`; actual behavior is auto-generation of a random password printed to stderr with `force_pw_change=1`. Corrected.
- **`*arr` services documented as bridge-network** — CLAUDE.md and `.env.local` incorrectly stated Sonarr/Radarr/Prowlarr/Bazarr ran with `network_mode: host`. Confirmed on `compose_default` bridge; reachable by container name or host IP.

### Added
- **Seerr webhook receiver** (`src/app/api/seerr/webhook/route.ts`) — implements the Phase 3 bridge endpoint. Handles `MEDIA_APPROVED` / `REQUEST_APPROVED` (idempotency via `findItemForRequest`, creates `monitored_item`, fires immediate grab as fire-and-forget), `MEDIA_AVAILABLE` (updates `media_requests.status`), and all other event types (200 ignored). HMAC-SHA256 signature verification via `timingSafeEqual` when `SEERR_WEBHOOK_SECRET` is set.
- **Request download progress** (`src/app/api/requests/[id]/progress/route.ts`) — joins `media_requests → monitored_items → grab_history` by tmdb_id+type, queries qBittorrent `/api/v2/torrents/info?hashes=<hash>` for live progress. `RequestsTable.tsx` now renders a `DownloadProgress` component on approved rows: polls every 5 seconds, shows progress bar, speed (MB/s), ETA, and human-readable state label.
- **Rate limiting on mutation routes** — `POST /api/requests` (20/hr per userId), `POST /api/requests/[id]/approve` and `decline` (60/5min per IP), `PATCH`+`DELETE /api/admin/users/[id]` (30/10min per IP, pooled).
- **`SUBTITLE_MEDIA_ROOT=/media`** added to `.env.local` — required for the subtitle downloader to write `.srt` files alongside media files using the Jellyfin/Plex naming convention.
- **`EMAIL_VERIFICATION_REQUIRED` env var** — defaults to `false`. When not set to `"true"`, registration creates the user account and session immediately without the two-step email code flow. The existing flow activates only when explicitly enabled.
- **SMTP env vars scaffolded** — `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` all optional. When absent, verification codes print to stdout.

### Changed
- **`package.json` version** bumped from `0.4.0` to `0.9.1` — was never incremented during the independence build phases.
- **`@tanstack/react-query-devtools` and `@types/nodemailer`** moved from `dependencies` to `devDependencies` — devtools were going into the production bundle unnecessarily.
- **CLAUDE.md** — corrected Next.js version (`14+` → `16+`), node base image (`22-slim` → `24-slim`), proxy file convention (middleware.ts → proxy.ts), `QBT_URL` → `QBIT_URL` in compose example, admin seeding behavior, `*arr` network mode, Jellyfin image proxy path, 21 DB tables listed, admin nav extended with Quality Profiles + Settings, BunkerWeb WAF table completed with all 5 disabled modules.

---

## [0.9.0] — Unreleased

### Added
- **Two-mode request system** — every media request is now either **Quick** (48-hour auto-delete, auto-approved, slot-limited, old content only) or **Long-term** (admin approval required, never auto-deleted, no slot limit). `request_type` column added to `media_requests` table.
- **`RequestOptions` component** (`src/components/media/RequestOptions.tsx`) — shows two buttons ("Quick (48h)" / "Long-term") for content released before the current year; single "Request" button for current-year or future content.
- **Auto-approve logic** (`src/lib/requests/auto-approve.ts`) — `tryAutoApprove()` gates on `request_type === 'quick'`, year check, and per-user slot limits (1 active movie, 2 active TV shows).
- **Auto-delete cron** (`src/lib/automation/auto-delete.ts`) — hourly job removes media files and marks requests `expired` when `auto_delete_at <= now`. Only fires on quick requests.
- **`availability.ts`** — sets `auto_delete_at` to 48 hours from now only for quick requests when they transition to available status.
- **429 response on slot exhaustion** — `POST /api/requests` returns HTTP 429 when a quick request would exceed the user's slot limit; the request row is deleted.
- **`request_method` column** — `'auto-pick'` (system selects best release) or `'interactive'` (user pre-selected a release via torrent picker modal). Auto-approval only triggers on `auto-pick` quick requests.
- **`language` column on `media_requests`** — ISO 639-1 code or `'any'`; acts as a hard constraint on the auto-pick grab path.
- **TorrentPickModal** (`src/components/media/TorrentPickModal.tsx`) — modal for interactive release selection; stores the chosen release as `preferred_release` JSON on the request row.
- **`expired` status** added to `media_requests.status` CHECK constraint via table recreation migration (SQLite cannot ALTER a CHECK constraint).

### Changed
- `POST /api/requests` now accepts `requestType` field in the request body.
- Status badges in `RequestOptions` now include a type label ("Quick (48h auto-delete)" / "Long-term").

---

## [0.8.0] — Unreleased

### Added
- **Independence build Phase 5 — Native media server** (`src/lib/media-server/`) — TypeScript media server replacing Jellyfin as the primary browse and playback backend. File scanner (`scanner.ts`), TMDB enricher (`enricher.ts`), ffprobe-based probe (`probe.ts`), HLS transcoder (`transcode.ts`), library query layer (`library.ts`), playback data builder (`playback.ts`), TMDB client (`tmdb.ts`). Background scanner starts from `src/instrumentation.ts`. Stores items in `media_items` and `media_watch_state` SQLite tables.
- **Independence build Phase 6 — Browse and watch wired to native media server** — `/browse` and `/browse/[id]` now query the native media server library instead of Jellyfin. `/api/media/items/[id]`, `/api/media/image`, `/api/media/filters`, `/api/media/items/[id]/similar` routes added. Stream proxy at `/api/jellyfin/stream/[...path]` retained as pass-through for Jellyfin-backed items during migration.
- **Independence build Phase 7 — Native request management** (`src/lib/requests/`) — request creation, approval, and status tracking backed by `media_requests` SQLite table. Replaces Seerr as the request backend. Admin requests page at `/admin/requests` with approval and decline actions.
- **Browse — Discover mode** (`/browse`) — defaults to TMDB trending/popular/genre browsing cross-referenced against the local library. Type tabs: Browse (discover), Library, Movies, TV Shows. Genre filter pills; Quick/Long-term request buttons per card.
- **`/browse/discover/[mediaType]/[tmdbId]`** — full detail page for TMDB items not yet in the local library.
- **`DiscoverResults` component** (`src/app/browse/DiscoverResults.tsx`) — renders TMDB discover results with library cross-reference and inline request UI.
- **`/admin/media-server`** — admin page for native media server: library stats (movie/series/episode counts), manual scan trigger, env var reference table for `MEDIA_ROOTS`, `TMDB_ACCESS_TOKEN`, `TRANSCODE_CACHE`.
- **`/admin/requests`** — admin request management page with Pending/All/Approved/Declined filter tabs, approval modal with quality profile selection, inline approve/decline without page reload.
- **`media_items` DB table** — stores scanned media: `id`, `type` (movie/episode/series/season), `title`, `sort_title`, `year`, `overview`, `runtime_ticks`, `tmdb_id`, `tvdb_id`, `imdb_id`, `series_id`, `season_number`, `episode_number`, `file_path`, `poster_path`, `backdrop_path`, timestamps.
- **`media_watch_state` DB table** — per-user playback state: `position_ticks`, `played`, `play_count`, `last_played`.
- **New env vars** — `TMDB_ACCESS_TOKEN` (required), `MEDIA_ROOTS` (required, colon-separated paths), `TRANSCODE_CACHE` (optional).

### Changed
- `continue-watching/route.ts` — rewritten to query `media_items` + `media_watch_state` via SQL; Jellyfin imports removed.
- `EpisodeCard.tsx`, `EpisodeCarousel.tsx`, `SeriesSection.tsx` — switched from Jellyfin SDK types to native `NativeEpisode` / `NativeSeason` types; images served via `/api/media/image?path=`.
- `VideoPlayer.tsx` progress reporting — `reportStart`, `reportProgress`, `reportStop` fall back gracefully when `progressApiUrl` is not set (logs warning, returns); no longer falls back to Jellyfin session routes.

---

## [0.7.0] — Unreleased

### Added
- **Independence build Phase 1 — Indexer aggregation** (`src/lib/indexer/`) — native Torznab/Newznab indexer registry stored in `indexers` SQLite table. Supports `requires_auth`, `requires_flaresolverr`, and `search_type` flags. FlareSolverr adapter at `adapters/`. Health check per indexer with `health_status` column. Admin UI at `/admin/indexers` with CRUD, enable/disable toggle, live test button.
- **Independence build Phase 2 — Download automation** (`src/lib/automation/`) — want-list-driven grab loop replacing Sonarr/Radarr. `monitored_items` and `grab_history` tables. `grab_results` table stores search candidates per grab attempt. Quality profiles system: `quality_tiers` (19 canonical tiers seeded at startup), `custom_formats`, `quality_profile_formats`. Automated grabber (`grabber.ts`), scheduler (`scheduler.ts`), parser (`parser.ts`), quality scorer (`quality.ts`). Admin UI at `/admin/automation` with monitored items list, grab history, manual Grab Now action, Add Item modal.
- **Independence build Phase 3 — Request bridge** (`src/lib/automation/bridge.ts`) — links the request system to the automation grab loop. Seerr webhook receiver at `/api/seerr/webhook` for `Request Approved` + `Media Available` events. Admin bridge status page at `/admin/automation/bridge`.
- **Independence build Phase 4 — Subtitle management** (`src/lib/subtitle/`) — OpenSubtitles v3 integration replacing Bazarr. `subtitle_wants` table tracks wanted/downloaded/skipped/failed subtitle items. Library scanner discovers media without subtitles. Download job fetches `.srt` files and writes them to `SUBTITLE_MEDIA_ROOT`. Admin UI at `/admin/subtitles` with scan, download, and status management.
- **Quality profiles admin** at `/admin/quality-profiles` — create/edit named quality profiles with tier-based conditions, upgrade-allowed toggle, cutoff quality, custom format scores, and preferred language constraint.
- **`grab_results` DB table** — stores search candidates for each monitored item grab attempt: `monitored_item_id`, `searched_at`, `candidates` (JSON), `selected_hash`, `total_found`.
- **`subtitle_wants` DB table** — tracks subtitle download state: `jellyfin_item_id`, language, forced/HI flags, `status`, `subtitle_path`.
- **`quality_tiers`, `custom_formats`, `quality_profile_formats` DB tables** — seeded with 19 canonical tiers at startup.
- **New env vars** — `OPENSUBTITLES_API_KEY` (required for subtitle phase), `SUBTITLE_LANGUAGES` (optional, default `en`), `SUBTITLE_MEDIA_ROOT` (optional, required for disk writes), `SEERR_WEBHOOK_SECRET` (optional).

### Changed
- Admin nav expanded — added Indexers, Automation, Request Bridge, Subtitles, Media Server tabs.
- `quality_profiles` table extended with `upgrade_allowed`, `cutoff_quality_id`, `min_format_score`, `cutoff_format_score`, `language` columns (additive migrations).

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
- **Two-step email verification registration** — `POST /api/auth/register` creates a `pending_registrations` row with a 6-digit code (10-minute TTL); `POST /api/auth/verify-email` accepts the code and creates the user + session on success. Maximum 5 incorrect attempts before the pending record is deleted.
- **Demographics fields** — `first_name`, `last_name`, `bio`, `location` columns on `users` table (additive migrations). Collected at registration Step 1; editable post-registration via `PATCH /api/auth/profile/demographics` on `/settings/profile` "About Me" section.
- **`/admin/monitoring`** — user monitoring dashboard: table of all users with username, name, email, status, role, last IP + country, active session count, last watched title, total watch count, last login.
- **`/admin/users/[id]`** — per-user detail with five tabs: Overview (profile + activity stats), Sessions, Watches, Audit, Logins. Action buttons: Suspend/Activate, Reset Password, Force PW Change, Promote/Demote, Delete Account.
- **Settings sidebar admin link** — if `role === 'admin'`, a "Admin Panel" link renders at the bottom of the settings sidebar pointing to `/admin/`.
- **`pending_registrations` DB table** — stores email verification state between Step 1 and Step 2 of registration.
- **env vars** — `SONARR_URL`, `SONARR_API_KEY`, `RADARR_URL`, `RADARR_API_KEY`, `PROWLARR_URL`, `PROWLARR_API_KEY`, `BAZARR_URL`, `BAZARR_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` added.

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
- **Profile page** — all external SSO trusted-auth header references removed; page now reads from SQLite via `requireAuth()` and DB query
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
- **Caddy block** — Removed the external SSO `forward_auth` from `unified.minijoe.dev`. App now handles its own auth entirely.
- **AppLayout / Header** — Switched from reading external SSO trusted-auth headers to using `useAuth()` from AuthContext.
- **Login / Register pages** — Fully rewritten. Login shows specific error messages by status code. Register has zxcvbn strength meter (dynamic import), rule checklist, username availability check (debounced 500ms).
- **Middleware** — Rewritten to redirect unauthenticated users to `/login?from={pathname}` and bounce authenticated users away from auth pages.
- **`/watch/[id]`** — `requireAuth()` enforced at server component level.
- **`/browse/[id]`** — `requireAuth()` enforced at server component level.
- **`/settings` layout** — `requireAuth()` enforced at layout level.
- **`/downloads` layout** — `requireAuth()` enforced at layout level (new `layout.tsx`).
- **`/` home page** — `requireAuth()` enforced at server component level.
- **Dockerfile** — Added `/data` directory with correct ownership for non-root `nextjs` user, `VOLUME ["/data"]`.

### Removed
- `src/app/api/auth/local/route.ts` — dev-only external-SSO mock stub, no longer needed.

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
