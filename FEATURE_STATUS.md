# Feature Status

Audit date: 2026-06-04. Last updated: 2026-06-13 (full read-only audit correction appended below; see `analysis/audit-2026-06-13/`). Verified against `/home/minijoe/dev/unified-frontend/app/src/`.

Legend:
- `[x]` Done — file exists and implements the feature
- `[ ]` Not done — mentioned in CLAUDE.md backlog but not in source
- `[~]` Partial — started but incomplete
- `[!]` Marked done below but the 2026-06-13 audit found it broken / no-op / insecure

---

## ⚠️ Audit Correction (2026-06-13) — "done" items that are broken / no-op / insecure

The 21-agent audit (`analysis/audit-2026-06-13/`, summary in `00-SUMMARY.md`) found that several items marked `[x]`
in the phases below are not actually functional or are insecure. Re-flag these as `[!]` until fixed.

> **Some of these are now fixed (2026-06-15).** The qBittorrent-proxy auth, automation dedup, auto-delete
> safety, and interactive-pick behavior below have been remediated; watch history is also writing now.
> See [`analysis/open-issues.md`](analysis/open-issues.md) for the reconciled current state — trust that
> over the `[!]` flags here. (Also stale: the "Watch party sync — Not done" backlog line; party play
> shipped in v0.9.5, see CLAUDE.md §16 and `PARTY_PLAY_AUDIT.md`.)

- [!] **Watch history** (`/history`) — page reads `watch_events`, which **nothing writes** (player writes
  `media_watch_state`). Permanently empty; admin watch stats share the dead table. (A3-01, A20-03)
- [!] **qBittorrent proxy** (`/api/qbit/[...path]`) — **no `requireAuth()`**; unauthenticated full qBit control incl.
  delete-with-files and `setPreferences`. (A7-01, A14-C1)
- [!] **Jellyfin routes** (`stream`, `playback`, `sessions/*`, `subtitles/*`, `image`, `series/*`, `seasons/*`) — **no
  `requireAuth()`**; open key-injecting relay. Only `continue-watching` is gated. (A4, A13-01)
- [!] **CSRF protection** (`src/lib/csrf.ts`, Phase 1) — `verifyOrigin` is on only ~12 of 51 mutating routes and is
  bypassable (`startsWith` host check). Effectively absent. (A6-01, A9-01, A1-002)
- [!] **Display settings page** — every control except Theme is a no-op (no reader exists). (A08-H1)
- [!] **Playback settings** — 9 of 11 prefs are no-ops; the player reads only audio/subtitle language. (A08-H2)
- [!] **Torrent → Interface settings tab** — writes prefs the live `/downloads` page never reads. (A08-H3)
- [!] **Two-mode requests / interactive picks** — interactive picks are auto-approved, contradicting CLAUDE.md §15. (A7-03)
- [!] **Party "join by code"** (`JoinByCodeModal`) — component never mounted; only the `?party=` link works. (A5-01)
- [!] **Automation dedup** — `monitored_items` has no unique index; "already exists" guards are dead → duplicate grabs. (A11-C2)
- [!] **auto-delete safety** — can delete user-owned media sharing a title with an expiring quick request. (A11-C1)
- [~] **Dead components** — ~13 of 18 `components/media/*` (detail-panel + episode-carousel chains, `SeasonSelector`,
  shadowed `RequestButton`) and the `downloads/components/*` alt UI are unmounted. See `17-resilience-deadcode.md`.

The phase checklist below is left as originally written for history; trust the flags above over the `[x]` marks.

---

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

### Phase 2 — Jellyfin Integration
- [x] Jellyfin API client (`src/lib/jellyfin/client.ts`, `api.ts`, `types.ts`)
- [x] Playback data / quality resolution system (`src/lib/jellyfin/playback.ts`)
- [x] `/browse` page (`src/app/browse/page.tsx`)
- [x] `/browse/[id]` media detail page (`src/app/browse/[id]/page.tsx`)
- [x] Jellyfin image proxy (`/api/jellyfin/image/[itemId]/route.ts`)
- [x] Continue watching (`/api/jellyfin/continue-watching/route.ts`)
- [x] Jellyfin stream proxy (`/api/jellyfin/stream/[...path]/route.ts`)
- [x] Jellyfin playback info (`/api/jellyfin/playback/[id]/route.ts`)
- [x] Series seasons and episodes (`/api/jellyfin/series/[id]/seasons/`, `/api/jellyfin/seasons/[seasonId]/episodes/`)
- [x] Next-episode route (`/api/jellyfin/series/[id]/next-episode/route.ts`)
- [x] Jellyfin subtitle proxy (`/api/jellyfin/subtitles/[itemId]/[streamIndex]/route.ts`)
- [x] Playback session reporting (`/api/jellyfin/sessions/playing`, `progress`, `stopped`)
- [~] Jellyfin catch-all proxy route (`/api/jellyfin/[...path]/route.ts`) mentioned in CLAUDE.md page map — replaced by individual named routes above; no generic catch-all exists

### Phase 3 — Seerr Integration
- [x] `/requests` page (`src/app/requests/page.tsx`, `RequestsTable.tsx`, `ApproveButton.tsx`)
- [x] `/search` page (`src/app/search/page.tsx`, `SearchInput.tsx`, `SearchResults.tsx`)
- [x] `/api/search/route.ts`
- [x] Seerr proxy (`/api/seerr/[...path]/route.ts` — confirmed via file listing)
- [x] TMDB routes (`/api/tmdb/movie/[tmdbId]`, `/api/tmdb/tv/[tmdbId]`, `/api/tmdb/trending`)
- [x] GET /api/tmdb/tv/[tmdbId]/season/[seasonNumber] — episode list endpoint created.
- [x] Discover page and DiscoverResults (`src/app/browse/discover/[mediaType]/[tmdbId]/page.tsx`, `DiscoverResults.tsx`)
- [x] Seerr webhook endpoint (`/api/seerr/webhook`) — implemented 2026-06-04. Handles MEDIA_APPROVED/REQUEST_APPROVED (creates monitored_item + fires immediate grab), MEDIA_AVAILABLE (updates request status), and ignores all other event types. HMAC-SHA256 signature verification when SEERR_WEBHOOK_SECRET is set.

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
- [x] `/settings/media` (Sonarr/Radarr quality profiles and root folders)
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
- [x] External service proxy routes — Sonarr (`/api/sonarr`), Radarr (`/api/radarr`), Prowlarr (`/api/prowlarr`), Bazarr (`/api/bazarr`)
- [x] Torrent search (`/api/torrent-search/route.ts`, `/api/torznab/search/route.ts`)
- [x] Automation API routes (`/api/automation/bridge`, `items`, `profiles`, `queue`, `sync`)
- [x] Subtitle API routes (`/api/subtitle/`, `download`, `scan`, `[id]`)
- [x] Indexer API routes (`/api/indexer/`, `[id]`, `[id]/activate`, `[id]/test`)
- [x] Quality profiles API routes (`/api/quality-profiles/`)

---

## Infrastructure

### BunkerWeb / Edge Stack
- [x] `unified.minijoe.dev_USE_REVERSE_PROXY=yes` set in edge compose
- [x] `unified.minijoe.dev_REVERSE_PROXY_HOST=http://caddy:8080` — uses correct `REVERSE_PROXY_HOST` (not `REVERSE_PROXY_URL`)
- [x] `unified.minijoe.dev_USE_BLACKLIST=no` — IP reputation blocklist disabled
- [x] `unified.minijoe.dev_USE_MODSECURITY=no` — ModSecurity/CRS disabled for this domain
- [x] `unified.minijoe.dev_USE_BAD_BEHAVIOR=no`
- [x] `unified.minijoe.dev_USE_CROWDSEC=no`
- [x] `unified.minijoe.dev_USE_DNSBL=no`
- [x] `unified.minijoe.dev_USE_GZIP=yes`
- [x] `unified.minijoe.dev_ALLOWED_METHODS=GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD`
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

- [ ] **Watch party sync** — no WebSocket room code, no SSE endpoint, no room model found anywhere in source
- [ ] **Jellyfin user linking** — no `jellyfin_user_id` column in DB migrations, not in users table schema
- [ ] **Push notifications** — no VAPID keys, no push subscription storage, no Web Push API code
- [ ] **Mobile PWA** — no `manifest.json`, no service worker (`sw.js`) found in app directory
- [~] **Subtitle search** — OpenSubtitles integration exists in `src/lib/subtitle/opensubtitles.ts` and subtitle routes exist, but this is the Phase 4 independence-build implementation (server-side auto-download), NOT the player-side `<track>` element injection from IMDB ID described in the backlog item
- [~] **Admin tools (bulk + export)** — per-user detail tabs fully implemented; Watch Activity CSV export exists at `/api/admin/activity/export`; audit log CSV export is NOT implemented (audit route is GET-only, no export endpoint)
- [ ] **Sonarr/Radarr monitoring status on media detail pages** — Sonarr/Radarr libs exist and are used in `/settings/media` for quality profiles, but no integration found on `/browse/[id]` or any media detail component
- [ ] **Download-to-browse linking** — no fuzzy torrent name → library item matching, no "View in library" link on downloads page
- [~] **Keyboard shortcut reference** — `/settings/shortcuts` page exists as a static hardcoded table; backlog item calls for auto-generation from a centralized registry (which does not yet exist)
- [x] **Rate limiting audit** — `checkRateLimit` applied to: login, register, verify-email, forgot-password, resend-verification, change-password, `POST /api/requests` (20/hr/userId), `POST /api/requests/[id]/approve` and `decline` (60/5min/IP), `PATCH`+`DELETE /api/admin/users/[id]` (30/10min/IP pooled). Added 2026-06-04.
- [ ] **Torrent creation dialog** — no `createTorrent` call or dialog found; qBittorrent 5.0+ `POST /api/v2/torrents/createTorrent` not implemented
- [ ] **Sequential download piece map** — `pieces_have` and `piece_range` fields are typed in `src/types/torrent.ts` and shown as a text count in `DetailPanel.tsx`, but no canvas visualization of piece availability exists
- [ ] **Bandwidth quota** — no `bandwidth_usage` table in migrations, no quota tracking or display
- [~] **Theme marketplace** — custom themes system exists (create/edit/delete via localStorage `unified-custom-themes`); export/import/share-string functionality described in the backlog is NOT implemented

### Seerr Webhook (Phase 3 spec)
- [x] `POST /api/seerr/webhook` — implemented 2026-06-04 (`src/app/api/seerr/webhook/route.ts`). Timing-safe HMAC verification, handles MEDIA_APPROVED/REQUEST_APPROVED/MEDIA_AVAILABLE, fire-and-forget grab.
