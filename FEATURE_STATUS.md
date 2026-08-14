# Feature Status

Audit date: 2026-06-04. Last updated: 2026-06-13 (full read-only audit correction appended below; see `analysis/audit-2026-06-13/`). Verified against `/home/joe/unified-media/app/src/`.

Legend:
- `[x]` Done — file exists and implements the feature
- `[ ]` Not done — mentioned in CLAUDE.md backlog but not in source
- `[~]` Partial — started but incomplete
- `[!]` Marked done below but the 2026-06-13 audit found it broken / no-op / insecure

---

## ⚠️ Audit Correction (2026-06-13)

The 21-agent audit (`analysis/audit-2026-06-13/`, summary `00-SUMMARY.md`) found several items marked
`[x]` in the phases below are broken, no-op, or insecure. Many were since remediated (2026-06-15 onward),
including the qBittorrent-proxy auth, automation dedup, auto-delete safety, interactive picks, and watch
history. **For the reconciled current state, trust [`analysis/open-issues.md`](analysis/open-issues.md)**
over the `[x]`/`[!]` flags in the phase checklist below (left as-written for history).

## Completed Phases (Independence Build)

### Phase 1 — Scaffolding
- [x] Next.js app with TypeScript, Tailwind, App Router (`app/`)
- [x] `Dockerfile` (multi-stage, `node:22-slim`, standalone output)
- [x] `next.config.ts` with `output: 'standalone'`
- [x] Health check endpoint (`/api/health/route.ts`)
- [x] SQLite auth via `better-sqlite3` (`src/lib/db/index.ts`, `migrations.ts`, `seed.ts`)
- [x] `requireAuth()` / `requireAdmin()` DAL pattern (`src/lib/dal.ts`)
- [x] `AuthContext` client-side context (`src/context/AuthContext.tsx`)
- [x] Session cookie (30-day TTL, `unified-session`)
- [x] CSRF protection (`src/lib/csrf.ts`)
- [x] Safe redirect (`src/lib/safe-redirect.ts`)
- [x] Next.js proxy (Next.js 16): `src/proxy.ts` exports `function proxy(...)` — this IS the correct convention for Next.js 16, which replaced the `middleware.ts` / `export function middleware` pattern. Registered as `ƒ Proxy (Middleware)` in build manifest. CLAUDE.md updated to reflect this.

### Phase 2 — the old media server Integration
- [x] the old media server API client (`src/lib/the old media server/client.ts`, `api.ts`, `types.ts`)
- [x] Playback data / quality resolution system (`src/lib/the old media server/playback.ts`)
- [x] `/browse` page (`src/app/browse/page.tsx`)
- [x] `/browse/[id]` media detail page (`src/app/browse/[id]/page.tsx`)
- [x] the old media server image proxy (`/api/the old media server/image/[itemId]/route.ts`)
- [x] Continue watching (`/api/the old media server/continue-watching/route.ts`)
- [x] the old media server stream proxy (`/api/the old media server/stream/[...path]/route.ts`)
- [x] the old media server playback info (`/api/the old media server/playback/[id]/route.ts`)
- [x] Series seasons and episodes (`/api/the old media server/series/[id]/seasons/`, `/api/the old media server/seasons/[seasonId]/episodes/`)
- [x] Next-episode route (`/api/the old media server/series/[id]/next-episode/route.ts`)
- [x] the old media server subtitle proxy (`/api/the old media server/subtitles/[itemId]/[streamIndex]/route.ts`)
- [x] Playback session reporting (`/api/the old media server/sessions/playing`, `progress`, `stopped`)
- [~] the old media server catch-all proxy route (`/api/the old media server/[...path]/route.ts`) mentioned in CLAUDE.md page map — replaced by individual named routes above; no generic catch-all exists

### Phase 3 — the old request app Integration
- [x] `/requests` page (`src/app/requests/page.tsx`, `RequestsTable.tsx`, `ApproveButton.tsx`)
- [x] `/search` page (`src/app/search/page.tsx`, `SearchInput.tsx`, `SearchResults.tsx`)
- [x] `/api/search/route.ts`
- [x] the old request app proxy (`/api/the old request app/[...path]/route.ts` — confirmed via file listing)
- [x] TMDB routes (`/api/tmdb/movie/[tmdbId]`, `/api/tmdb/tv/[tmdbId]`, `/api/tmdb/trending`)
- [x] GET /api/tmdb/tv/[tmdbId]/season/[seasonNumber] — episode list endpoint created.
- [x] Discover page and DiscoverResults (`src/app/browse/discover/[mediaType]/[tmdbId]/page.tsx`, `DiscoverResults.tsx`)
- [x] the old request app webhook endpoint (`/api/the old request app/webhook`) — implemented 2026-06-04. Handles MEDIA_APPROVED/REQUEST_APPROVED (creates monitored_item + fires immediate grab), MEDIA_AVAILABLE (updates request status), and ignores all other event types. HMAC-SHA256 signature verification when the retired webhook secret is set.

### Phase 4 — qBittorrent Integration
- [x] qBittorrent session manager (`src/lib/qbittorrent/session.ts`)
- [x] qBittorrent API wrappers (`src/lib/qbittorrent/api.ts`, `hooks.ts`, `types.ts`)
- [x] qBt proxy (`/api/qbit/[...path]/route.ts`) — multipart passthrough, query param forwarding, and re-auth on 403 all fixed
- [x] `/downloads` page with all components (`FilterSidebar`, `TorrentRow`, `DetailPanel`, `AddTorrentModal`)
- [x] `/settings/torrent` page (8 tabs, `TorrentSettingsClient.tsx`)
- [x] `src/types/torrent.ts` with all qBittorrent type definitions
- [ ] Separate `qbt/login/route.ts` — CLAUDE.md page map lists it; the login flow is handled entirely within `session.ts` and the catch-all proxy, no dedicated login route file exists

### Phase 4 — Download Client Registry
- [x] Config loader (`src/lib/download-client/config.ts`) — `getDownloadClientConfig()` reads `DOWNLOAD_CLIENT` (default `umt`), `UMT_URL`, `UMT_USERNAME`, `UMT_PASSWORD`
- [x] Registry (`src/lib/download-client/registry.ts`)
- [x] qBittorrent client — fully implemented (`src/lib/download-client/qbittorrent.ts`)
- [~] Transmission stub — exists but all methods throw `'not yet implemented'` (`src/lib/download-client/transmission.ts`)
- [~] Deluge stub — exists but all methods throw `'not yet implemented'` (`src/lib/download-client/deluge.ts`)
- [x] Types (`src/lib/download-client/types.ts`)

### Phase 5 — Unified UX
- [x] Home dashboard (`src/app/page.tsx`)
- [x] Global nav sidebar (`src/components/layout/Sidebar.tsx`, `Header.tsx`, `AppLayout.tsx`)
- [x] Mobile nav (`src/components/layout/MobileNav.tsx`)
- [x] Cross-service search (Library + Discover tabs in `/search`)
- [x] Responsive layout components

### Phase 1–5 — Video Player Tools
- [x] `src/components/player/types.ts` — all shared interfaces
- [x] `MediaSpeedControl.tsx`
- [x] `MediaABLoop.tsx`
- [x] `MediaFrameAdvance.tsx`
- [x] `MediaAspectRatio.tsx`
- [x] `MediaJumpToTime.tsx`
- [x] `MediaVideoEffects.tsx`
- [x] `useAudioChain.ts` — Web Audio chain, lazy init, single-element guard
- [x] `MediaEqualizer.tsx` — 10-band EQ with 8 presets
- [x] `MediaAudioTools.tsx` — gain, compressor, stereo pan
- [x] `MediaBookmarks.tsx` — localStorage per `storageKey`
- [x] `MediaChapters.tsx`
- [x] `MediaSnapshot.tsx`
- [x] `MediaToolsPanel.tsx` — 4-tab overlay
- [x] `MediaQualitySelector.tsx` — hides when only 1 quality available
- [x] `MediaSubtitles.tsx`
- [x] `MediaTransform.tsx`
- [x] `VideoPlayer.tsx` — quality switching, auto aspect ratio, screen-aware quality selection

### Phase 6 — Browse/Watch wired to native media server
- [x] Native media server library (`src/lib/media-server/library.ts`, `scanner.ts`, `playback.ts`, `transcode.ts`, `enricher.ts`, `probe.ts`, `tmdb.ts`, `filename-parser.ts`, `types.ts`)
- [x] `/api/media/*` routes — items, playback, stream, resume, progress, scan, stats, subtitles, seasons, series, similar, filters, image
- [x] `/admin/media-server` page
- [x] `/watch/[id]` and `/play/[id]` pages

### Phase 7 — Native Request Management
- [x] `src/lib/requests/types.ts` — `RequestType`, `NativeRequest`
- [x] `src/lib/requests/auto-approve.ts` — slot-limited quick approval
- [x] `src/lib/requests/monitor.ts`
- [x] `src/lib/automation/auto-delete.ts` — hourly cron for 48h expiry
- [x] `src/lib/automation/availability.ts` — sets `auto_delete_at` on quick requests
- [x] `/api/requests/route.ts` — POST accepts `requestType`, returns 429 on slot overflow; rate-limited 20/hr per userId
- [x] `/api/requests/[id]/approve`, `decline`, `grab`, `grab-results` routes — approve/decline rate-limited 60/5min/IP
- [x] `/api/requests/[id]/progress/route.ts` — live download progress: joins grab_history → qBittorrent by info_hash, returns progress/state/speed/eta
- [x] `src/components/media/RequestOptions.tsx` — two-button (Quick/Long-term) or single-button for new content; SeriesScopeModal wired in for TV requests — shows season/episode picker before submitting. Full Series / specific seasons / individual episodes. POST body includes scopeType, scopeSeasons, scopeEpisodes, monitorFuture.
- [x] `RequestsTable.tsx` — `DownloadProgress` component polls `/api/requests/[id]/progress` every 5s; shows bar, MB/s, ETA, state; scope summary badge on TV requests (Full Series / Season 1,2 / S01E01–E03)
- [x] `/admin/requests` page (`AdminRequestsClient.tsx`)

---

## Active Features

### Auth System (v0.4.0+)
- [x] Login page (`/login`)
- [x] Register page (`/register`) — adaptive flow: single-step (instant account) when `EMAIL_VERIFICATION_REQUIRED` is unset; two-step (info + email code) when set to `'true'`
- [x] Email verification — `POST /api/auth/verify-email`, `pending_registrations` table (used only when EMAIL_VERIFICATION_REQUIRED=true)
- [x] `EMAIL_VERIFICATION_REQUIRED` env var — checked in both `register/route.ts` and `register-config/route.ts`
- [x] `/api/auth/register-config` endpoint — exposes `emailVerificationRequired` flag to client
- [x] Resend verification (`/api/auth/resend-verification/route.ts`)
- [x] Forgot password (`/forgot`, `/api/auth/forgot-password`)
- [x] Reset password (`/reset-password`, `/api/auth/reset-password`)
- [x] Rate limiting on login, register, verify-email, forgot-password, resend-verification
- [x] Invite codes (`/invite/[code]`, `/admin/invites`, `/api/admin/invites`)
- [x] Admin seeding from `ADMIN_USERNAME` / `ADMIN_PASSWORD`

### Profile and Settings (v0.5.2+)
- [x] `/settings/profile` page (`ProfileClient.tsx`)
- [x] `PATCH /api/auth/profile/display-name`
- [x] `PATCH /api/auth/profile/email`
- [x] `PATCH /api/auth/profile/demographics` — first_name, last_name, bio, location
- [x] `POST /api/auth/profile/change-password` — rate-limited 5/15min per userId
- [x] `GET /api/auth/profile/sessions`
- [x] `DELETE /api/auth/profile/sessions/[id]`
- [x] `POST /api/auth/profile/sessions/revoke-others`
- [x] Avatar generation (initials + username-derived hue)
- [x] `display_name` column migration (additive, wrapped in try/catch)
- [x] Demographics columns migration (`first_name`, `last_name`, `bio`, `location`)
- [x] `/settings/layout.tsx` — Admin Panel link for `role === 'admin'`
- [x] `/settings/display` (ThemeSection — custom themes via localStorage `unified-custom-themes`)
- [x] `/settings/torrent`
- [x] `/settings/playback`
- [x] `/settings/media` (the external automation services quality profiles and root folders)
- [x] `/settings/shortcuts` — static keyboard shortcut reference table
- [x] `/settings/advanced`
- [x] `/settings/about`

### Admin Panel (v0.5.3+)
- [x] `/admin` overview page
- [x] `/admin/monitoring` — user monitoring dashboard
- [x] `/admin/users` — user list
- [x] `/admin/users/[id]` — per-user detail, 5 tabs (Overview, Sessions, Watches, Audit, Logins)
- [x] `/api/admin/monitoring/route.ts`
- [x] `/api/admin/users/[id]/monitoring/route.ts`
- [x] `/api/admin/users/[id]/route.ts` — PATCH (role/is_active/force_pw_change) + DELETE
- [x] `/api/admin/users/[id]/suspend` and `activate` routes
- [x] `/api/admin/users/[id]/reset-password/route.ts`
- [x] `/admin/invites`
- [x] `/admin/requests`
- [x] `/admin/activity` (Watch Activity) — with CSV export (`/api/admin/activity/export/route.ts`)
- [x] `/admin/audit` (Audit Log) — paginated, no CSV export (see Backlog)
- [x] `/admin/server` (Server Status, `/api/admin/server-status/route.ts`)
- [x] `/admin/indexers` (Phase 1 independence)
- [x] `/admin/automation` (Phase 2 independence)
- [x] `/admin/automation/bridge` (Phase 3 independence)
- [x] `/admin/subtitles` (Phase 4 independence)
- [x] `/admin/media-server` (Phase 5 independence)
- [x] `/admin/quality-profiles` — exists in nav and as a page (not in CLAUDE.md nav spec; added beyond spec)
- [x] `/admin/settings` — exists in nav and as a page (not in CLAUDE.md nav spec; added beyond spec)

### Independence Build Integrations
- [x] Indexer aggregation (`src/lib/indexer/` — catalog, config, discovery, flaresolverr, types, adapters: eztv, nyaa, yts)
- [x] Download automation (`src/lib/automation/` — grabber, monitor, parser, quality, scheduler, types)
- [x] Request bridge (`src/lib/automation/bridge.ts`)
- [x] Subtitle management (`src/lib/subtitle/` — downloader, monitor, opensubtitles, scanner, scheduler, types); graceful no-op when `OPENSUBTITLES_API_KEY` unset; `SUBTITLE_MEDIA_ROOT=/media` set in `.env.local`; cron callbacks wrapped in try/catch
- [x] Instrumentation / background job startup (`src/instrumentation.ts`)
- [x] External service proxy routes — the TV automation suite (`/api/the TV automation suite`), the movie automation suite (`/api/the movie automation suite`), the indexer bridge (`/api/the indexer bridge`), the subtitle automation suite (`/api/the subtitle automation suite`)
- [x] Torrent search (`/api/torrent-search/route.ts`, `/api/torznab/search/route.ts`)
- [x] Automation API routes (`/api/automation/bridge`, `items`, `profiles`, `queue`, `sync`)
- [x] Subtitle API routes (`/api/subtitle/`, `download`, `scan`, `[id]`)
- [x] Indexer API routes (`/api/indexer/`, `[id]`, `[id]/activate`, `[id]/test`)
- [x] Quality profiles API routes (`/api/quality-profiles/`)

---

## Infrastructure

### BunkerWeb / Edge Stack
- [x] `<app-host>_USE_REVERSE_PROXY=yes` set in edge compose
- [x] `<app-host>_REVERSE_PROXY_HOST=http://caddy:8080` — uses correct `REVERSE_PROXY_HOST` (not `REVERSE_PROXY_URL`)
- [x] `<app-host>_USE_BLACKLIST=no` — IP reputation blocklist disabled
- [x] `<app-host>_USE_MODSECURITY=no` — ModSecurity/CRS disabled for this domain
- [x] `<app-host>_USE_BAD_BEHAVIOR=no`
- [x] `<app-host>_USE_CROWDSEC=no`
- [x] `<app-host>_USE_DNSBL=no`
- [x] `<app-host>_USE_GZIP=yes`
- [x] `<app-host>_ALLOWED_METHODS=GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD`
- [x] Settings present in both service definitions (BunkerWeb scheduler + main container)

### Email Verification
- [x] `src/lib/email.ts` — nodemailer wrapper with stdout fallback when SMTP vars absent
- [x] `EMAIL_VERIFICATION_REQUIRED` env var checked in `register/route.ts`
- [x] `register-config` endpoint exposes flag to client UI
- [x] `pending_registrations` table with 6-digit code, 10-min TTL, 5-attempt lockout
- [x] `verify-email` route — creates user+session on correct code
- [x] Dev fallback: code printed to stdout if SMTP vars unset

### Infrastructure Notes
- [x] **Proxy file convention (Next.js 16)** — `src/proxy.ts` / `export function proxy()` is the correct Next.js 16 pattern. Build output confirms `ƒ Proxy (Middleware)` is registered. This was previously flagged as a bug; it is not.

---

## Backlog Items

### From Section 13 (Future Ideas)

- [x] **Watch party sync** — shipped v0.9.5. Native party play with WebSocket sync, presence, text chat, emoji reactions. Dedicated WS server on port 3002 (`src/lib/party/`). Full audit in `analysis/PARTY_PLAY_AUDIT.md`; all findings remediated. See CLAUDE.md §16.
- [ ] **the old media server user linking** — no `the old media server_user_id` column in DB migrations, not in users table schema
- [ ] **Push notifications** — no VAPID keys, no push subscription storage, no Web Push API code
- [ ] **Mobile PWA** — no `manifest.json`, no service worker (`sw.js`) found in app directory
- [~] **Subtitle search** — OpenSubtitles integration exists in `src/lib/subtitle/opensubtitles.ts` and subtitle routes exist, but this is the Phase 4 independence-build implementation (server-side auto-download), NOT the player-side `<track>` element injection from IMDB ID described in the backlog item
- [~] **Admin tools (bulk + export)** — per-user detail tabs fully implemented; Watch Activity CSV export exists at `/api/admin/activity/export`; audit log CSV export is NOT implemented (audit route is GET-only, no export endpoint)
- [ ] **the external automation services monitoring status on media detail pages** — the external automation services libs exist and are used in `/settings/media` for quality profiles, but no integration found on `/browse/[id]` or any media detail component
- [ ] **Download-to-browse linking** — no fuzzy torrent name → library item matching, no "View in library" link on downloads page
- [~] **Keyboard shortcut reference** — `/settings/shortcuts` page exists as a static hardcoded table; backlog item calls for auto-generation from a centralized registry (which does not yet exist)
- [x] **Rate limiting audit** — `checkRateLimit` applied to: login, register, verify-email, forgot-password, resend-verification, change-password, `POST /api/requests` (20/hr/userId), `POST /api/requests/[id]/approve` and `decline` (60/5min/IP), `PATCH`+`DELETE /api/admin/users/[id]` (30/10min/IP pooled). Added 2026-06-04.
- [ ] **Torrent creation dialog** — no `createTorrent` call or dialog found; qBittorrent 5.0+ `POST /api/v2/torrents/createTorrent` not implemented
- [ ] **Sequential download piece map** — `pieces_have` and `piece_range` fields are typed in `src/types/torrent.ts` and shown as a text count in `DetailPanel.tsx`, but no canvas visualization of piece availability exists
- [ ] **Bandwidth quota** — no `bandwidth_usage` table in migrations, no quota tracking or display
- [~] **Theme marketplace** — custom themes system exists (create/edit/delete via localStorage `unified-custom-themes`); export/import/share-string functionality described in the backlog is NOT implemented

### Native BitTorrent engine — drop the external download client (idea, 2026-08-10)

Side note, not scoped or committed to. Everything else in this app is native;
the download client is the last external daemon in the chain, and it is the one
that keeps producing path- and API-shaped bugs (see the importer path contract
in `src/lib/automation/importer.ts` — that class of failure only exists because
two processes have to agree on where files live).

Replacing it means embedding a BitTorrent library and driving it in-process:

- **`webtorrent`** — pure JS/Node, easiest to embed, already speaks magnet
  links. Weakest on the things that matter at scale here: no DHT/peer tuning
  depth, weaker seeding behaviour, and historically rough on large multi-file
  torrents.
- **`libtorrent` (Rasterbar) via node bindings** — the engine the current
  client is built on, so behaviour and performance are a known quantity.
  Costs a native dependency and a build toolchain in the image, which conflicts
  with the current `node:24-slim` + `output: 'standalone'` setup.
- **A Rust engine (`rqbit`, `cratetorrent`) behind a thin local API** — keeps
  the heavy lifting out of Node without a second web UI to maintain. Middle
  ground: still a separate process, but one we define the interface to.

What has to be solved regardless of choice, and what makes this a real project
rather than a swap: the killswitch. The external client currently inherits the
VPN network namespace, so a tunnel drop cannot leak peer traffic. An in-process
engine runs inside this app's own container, which is deliberately *not* in the
tunnel (the app has to stay reachable on the LAN). Binding the torrent engine to
the VPN interface only, and proving it fails closed, is the gating design
question — get that wrong and the privacy property the whole stack is built on
is silently gone.

Also needed: resume data persistence across restarts, port forwarding sync
(currently pushed in by the tunnel container on every reconnect), rate limiting,
and a seeding/ratio policy. The `/downloads` page and the download-client
registry (`src/lib/download-client/`) already abstract the client behind an
interface, so this would land as a new registry entry rather than a rewrite —
that abstraction is the reason this is feasible at all.

### the old request app Webhook (Phase 3 spec)
- [x] `POST /api/the old request app/webhook` — implemented 2026-06-04 (`src/app/api/the old request app/webhook/route.ts`). Timing-safe HMAC verification, handles MEDIA_APPROVED/REQUEST_APPROVED/MEDIA_AVAILABLE, fire-and-forget grab.
