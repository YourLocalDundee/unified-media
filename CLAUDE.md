# unified-frontend

A single-pane-of-glass web app for the minime home server media stack (v0.10.2). Replaces the multi-tab workflow
(Jellyfin + Seerr + qBittorrent) with one unified interface for browsing, requesting, watching, and
monitoring downloads.

---

## ⚠️ Known Issues — Full Audit 2026-06-13

A 21-agent read-only audit ran on 2026-06-13 covering every page, all 105 API routes, and the lib layer, plus
cross-cutting passes (a11y/mobile, resilience, deploy/runtime, input validation, temporal, untrusted-input). Build was
clean (`type-check` + `build` pass, `npm audit` 0 vulns). ~379 findings; the 19 raw criticals collapse to ~10 distinct
issues. **Full detail and per-domain reports live in [`analysis/audit-2026-06-13/00-SUMMARY.md`](analysis/audit-2026-06-13/00-SUMMARY.md)
plus `analysis/audit-2026-06-13/01..21-*.md`.** Fix the P0 block before shipping further features.

> **Remediation status — 2026-06-19 (all criticals closed).** Reconciled live tracker at
> [`analysis/open-issues.md`](analysis/open-issues.md) (read that for the current state; this block is
> the original audit). **All P0 and P1 items are now closed.** Closed since the audit: **S1/S2** (auth
> + CSRF on every mutating route — qbit/torznab/jellyfin metadata + all admin/automation/subtitle/profile
> routes; `proxy.ts` is intentionally a UX-only redirect guard per DAL pattern, not a security boundary),
> **S3** (force-pw-change confirmed correct — `requireAuth()` redirects those sessions, the change route
> uses `getSession()`), **S4** (indexer `api_key` redacted), **D1** (auto-delete ownership guards),
> **D2** (monitored_items unique index + fetch-or-create), **D3** (atomic `grabbing` status),
> **F3** (healthcheck + caddy fragment), and **P1** (heavy work moved to background job queue).
> Note: `stream`/`playback`/`subtitles`/`sessions/*` jellyfin routes were already gated via
> `getSession()`; the bullet below overstated S1. Open items: P2 no-op settings (product decision
> needed), a11y modal focus traps + light-theme contrast.

### Critical (deduped)

**Security**
- **Unauthenticated internal proxies.** `src/proxy.ts` only checks a session cookie is *present*, not valid. The
  qBittorrent `[...path]` proxy, most jellyfin routes (`stream`, `playback/[id]`, `sessions/*`, `subtitles/*`,
  `image/[itemId]`, `series/[id]*`, `seasons/[seasonId]/episodes`), and `api/torznab/search` all run with **no
  `requireAuth()`**, handing attacker input to qBit/Jellyfin with server credentials. (A7-01, A4, A13-01, A12-02, A14-C1/C2)
- **CSRF effectively off.** `verifyOrigin` runs on only ~12 of 51 mutating routes, and uses `origin.startsWith()` so
  `unified.minijoe.dev.evil.com` passes; a missing Origin is allowed. (`lib/csrf.ts:11`; A6-01, A9-01, A1-002)
- **Forced password change is bypassable.** The 30-day session cookie is set before the `force_pw_change` check.
  (`api/auth/login/route.ts:97`; A1-001)
- **Indexer `api_key` leaked to the browser** in plaintext on every indexer GET. (`lib/indexer/config.ts:7`; A12-01)

**Data loss / engine**
- **auto-delete can delete user-owned media** — matches `media_items` by `tmdb_id`+`type` with no ownership link.
  (`lib/automation/auto-delete.ts:50`; A11-C1) Highest-risk behavior in the app.
- **`monitored_items` has no unique index** → dead dedup guards → duplicate rows and double grabs.
  (`db/migrations.ts:160`, `automation/monitor.ts:88`; A6-02, A11-C2) Plus a fire-and-forget grab that races the cron (A11-C3).

**Functional / resource / deploy**
- **Watch history is permanently empty** — nothing writes `watch_events`; the player writes `media_watch_state`.
  (`history/page.tsx:48`; A3-01, A20-03)
- **Player AudioContext never torn down** — browsers cap ~6, so long sessions break all audio tools. (`useAudioChain.ts:16`; A4)
- **Deploy fragments broken** — healthcheck uses `curl` (absent from the `node:24-slim` runtime image → container
  unhealthy forever); committed `caddy.fragment`/`docker-compose.fragment.yml` lack the party `ws` route. (A18-C1/C2)

### Systemic patterns (HIGH)
- Many client mutations never check `res.ok` (failed delete/suspend/save report success). (A7-04, A9-10/11, A10-03/06/07)
- ~13 of 18 `components/media/*` are dead, plus the alt `downloads/components/*` UI and `party/JoinByCodeModal`; full
  delete-or-wire list in `analysis/audit-2026-06-13/17-resilience-deadcode.md`.
- No-op settings: the Display page (except Theme), 9 of 11 Playback prefs, the Torrent Interface tab. (A08)
- Heavy work synchronously in request handlers: `media/scan` (ffprobe+TMDB), subtitle download, embedded-subtitle
  ffmpeg — needs a job queue. (A10-08, A15-H1/H2)
- All `next/image` are `unoptimized`. (A02-006, A15-G)
- No `error.tsx`/`not-found.tsx`/`loading.tsx`/`aria-live` anywhere in the app. (A16, A17)

### Remediation order
- **P0** — add auth to qbit/jellyfin/torznab routes (+ make `proxy.ts` validate sessions); fix and enforce `verifyOrigin`
  on all mutations; give auto-delete an ownership key; gate force-password-change; stop returning `api_key` to the client.
- **P1** — unique index on `monitored_items` (dedupe existing rows first); atomic `grabbing` status; fix healthcheck +
  edge fragments; resolve the `auto_approved`/`auto_delete_at` mismatch (A20-01); move scan/subtitle/ffmpeg work to a job queue.
- **P2** — wire or remove watch history; tear down the AudioContext; add broad `res.ok` handling; add `error.tsx`/
  `not-found.tsx` + `aria-live`; enable image optimization; delete the ~27 dead modules; fix continue-watching ordering (A20-02).

---

## 1. Project Overview

### What this is

A Next.js 16+ web app that acts as a **UX aggregation layer** on top of three existing services:

- **Jellyfin** — browse the local media library, play content
- **Seerr** — search TMDB, create requests for new movies/shows, check request status
- **qBittorrent** — monitor the download queue that feeds the library

The end goal is a single URL (`media.minijoe.dev`) that handles the complete workflow: discover →
request → watch, with download status visible inline.

### What this is NOT

- Not a replacement for Sonarr, Radarr, Prowlarr, or Bazarr. They run in the background, unchanged.
- Not a full Jellyfin replacement. Jellyfin itself still exists at `jellyfin.minijoe.dev` for
  power-user access (admin UI, transcoding settings, etc.).
- Not a full Seerr replacement. Seerr still runs at `seerr.minijoe.dev` for admin/approval
  workflows, user management, and settings.
- Not a torrent manager. qBittorrent's full UI is still at `qbt.minijoe.dev` for power use.
- Not a new backend. All data comes from calling the existing services' APIs.

---

## 2. Architecture

### Directory layout

```
/home/minijoe/dev/unified-frontend/
  app/                  # The Next.js application
  sources/              # Read-only reference copies of upstream source code
    seerr/              # Seerr source (Next.js/Express, TypeScript)
    jellyfin-web/       # Jellyfin web client source (webpack, React)
    qbittorrent-webui/  # VueTorrent source (Vue 3, Vite)
  analysis/             # Per-service analysis notes (seerr-analysis.md, etc.)
  CLAUDE.md             # This file
```

The Next.js app lives at `/home/minijoe/dev/unified-frontend/app/`. Run `npm run dev` from there.

### How it fits in the stack

```
Internet
  └── BunkerWeb (WAF, TLS termination)
        └── Caddy (reverse proxy, port 8080 internal)
              └── reverse_proxy → unified-frontend:3001  (this app — auth handled internally)
```

The app calls backing services from **Next.js server components and API routes** — never directly
from the browser. This keeps API keys and qBittorrent session cookies out of client code and avoids
CORS issues entirely.

```
unified-frontend container (Docker network: compose_default)
  ├── Server components / API routes call:
  │     ├── http://seerr:5055/api/v1/...         (Seerr REST API)
  │     ├── http://192.168.0.50:8096/...          (Jellyfin — network_mode: host)
  │     └── http://qbittorrent:8080/api/v2/...   (qBittorrent Web API)
  └── Browser calls:
        └── /api/...  (Next.js API routes that proxy to above)
```

**Jellyfin note:** The Jellyfin container uses `network_mode: host`, so it is not reachable by
container name. Use the host IP `192.168.0.50:8096` from within the Docker network.

### Auth strategy (v0.4.0+)

The app manages its own auth. Authentik is **not** in the request path for `unified.minijoe.dev`.
Caddy simply reverse-proxies to the container — no `forward_auth` block.

Auth is built on SQLite (`better-sqlite3`) at `$DB_PATH` (default `./unified.db`, production
`/data/unified.db` via Docker volume `unified-db:/data`).

Key components:

| File | Purpose |
|---|---|
| `src/lib/db/index.ts` | Singleton DB, runs migrations + seed on first call |
| `src/lib/db/migrations.ts` | Schema for all tables: `users`, `sessions`, `invite_codes`, `audit_log`, `watch_events`, `login_attempts`, `password_resets`, `pending_registrations`, `indexers`, `quality_profiles`, `quality_tiers`, `custom_formats`, `quality_profile_formats`, `monitored_items`, `grab_history`, `grab_results`, `grab_blocklist`, `subtitle_wants`, `media_requests`, `app_settings`, `media_items`, `media_watch_state`, `watch_parties`, `watch_party_members`, `watch_party_queue` |
| `src/lib/db/seed.ts` | Seeds admin account from `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars on first run |
| `src/lib/dal.ts` | `requireAuth()` / `requireAdmin()` / `createSession()` / `logEvent()` — server-only |
| `src/lib/password.ts` | `validatePassword()`, `hashPassword()`, `verifyPassword()` |
| `src/lib/csrf.ts` | `verifyOrigin()` — checks Origin header on state-mutating routes |
| `src/lib/safe-redirect.ts` | `getSafeRedirectUrl()` — prevents open redirect via `?from=` param |
| `src/lib/email.ts` | Nodemailer wrapper; sends email via SMTP or falls back to `console.log` if SMTP env vars are not set |
| `src/context/AuthContext.tsx` | Client-side context, fetches `/api/auth/me`, exposes `useAuth()` |

**DAL pattern (CVE-2025-29927):** Auth is enforced in server components and route handlers via
`requireAuth()` / `requireAdmin()`. Middleware handles redirects for UX only — never relied upon
as a security gate.

**Session model:** 30-day TTL cookie `unified-session` (`HttpOnly`, `Secure`, `SameSite=lax`),
24h rotation, 90-day absolute max. ID is 32-char cryptographically random string.

**Registration (two-step, v0.5.3+):** Open enrollment, email verification optional (controlled by `EMAIL_VERIFICATION_REQUIRED` env var, default false). Rate-limited to 10 attempts per 15 minutes per IP.

When `EMAIL_VERIFICATION_REQUIRED` is not set (default):

1. `POST /api/auth/register` validates all fields, creates the user account and session immediately, and returns `{ username, role }`. No pending row is created.

When `EMAIL_VERIFICATION_REQUIRED=true`:

1. `POST /api/auth/register` validates all fields. On success it creates a `pending_registrations` DB record containing a 6-digit code with a 10-minute TTL and sends the code via `src/lib/email.ts`. It returns `{ pendingId }` — no user or session is created yet.
2. `POST /api/auth/verify-email` accepts `{ pendingId, code }`. On correct code it creates the user + session. Maximum 5 incorrect attempts before the pending record is deleted. Code expires after 10 minutes regardless.

The register page UI is two-step: Step 1 collects account info and demographics; Step 2 shows the 6-digit code entry form (Step 2 is skipped when `EMAIL_VERIFICATION_REQUIRED` is false).

The `/admin/invites` system still exists for admin use but is no longer enforced at registration. The `/invite/{code}` route still functions for direct links.

**Demographics fields (v0.5.3+):** The `users` table has four optional profile columns: `first_name`, `last_name`, `bio`, `location`. These are collected at registration (Step 1 of the two-step flow; bio and location are optional) and editable post-registration via `PATCH /api/auth/profile/demographics` on the `/settings/profile` "About Me" section.

**Admin seeding:** On first `getDb()` call with an empty users table, `seedAdmin()` reads
`ADMIN_USERNAME` and `ADMIN_PASSWORD` from env. If `ADMIN_PASSWORD` is absent or fails the password
policy, a random password is auto-generated, printed to stderr (`docker logs unified-frontend`), and
`force_pw_change=1` is set so the admin must change it on first login. The container starts
regardless — it does not exit. `ADMIN_USERNAME` defaults to `admin` if unset.

### Deployment

Add a `unified-frontend` service to `/opt/docker/compose/docker-compose.yml`. Build from a local
Dockerfile inside `app/`. Add a Caddy route at `http://media.minijoe.dev` using the same
`forward_auth` pattern as seerr and jellyfin.

---

## 3. Service Integrations

### Seerr

- **Internal URL:** `http://seerr:5055`
- **API base:** `http://seerr:5055/api/v1`
- **Auth:** `X-API-Key: <api_key>` header. The API key is set in Seerr settings and stored in
  `/opt/docker/configs/seerr/settings.json` under `main.apiKey`. Pass it as an env var
  `SEERR_API_KEY` to the unified-frontend container.
- **Session auth alternative:** Seerr also accepts `req.session.userId` from cookie-based sessions,
  but API key is simpler for server-to-server calls.
- **Note:** The `/api/seerr/[...path]` proxy route was removed in Phase 7. The native request system (`/api/requests/`) now handles all request operations. Seerr is still used for TMDB metadata and discovery, but request creation and management go through the native layer.

Key API operations:

| Operation | Endpoint |
|---|---|
| Search TMDB (movies, shows, people) | `GET /search?query=<q>&page=<n>` |
| Get movie details | `GET /movie/<tmdbId>` |
| Get TV show details | `GET /tv/<tmdbId>` |
| List all requests | `GET /request?take=<n>&skip=<n>&filter=<status>` |
| Create a request | `POST /request` body: `{ mediaType, mediaId, seasons? }` |
| Get media status | `GET /media?filter=<available\|processing\|pending>` |
| Discover/trending | `GET /discover/movies`, `GET /discover/tv` |

Request filter values: `all`, `approved`, `processing`, `pending`, `unavailable`, `failed`,
`completed`, `available`, `deleted`.

### Jellyfin

- **Internal URL:** `http://192.168.0.50:8096` (host network container — use host IP, not container name)
- **External URL (for Caddy):** `http://jellyfin.minijoe.dev` (already Authentik-gated)
- **SDK:** `@jellyfin/sdk` is available (version `0.0.0-unstable.202605130605` in the jellyfin-web
  source). Use it in the Next.js app rather than raw fetch.
- **Auth:** `X-Emby-Authorization` header with format:
  ```
  MediaBrowser Client="unified-frontend", Device="unified-frontend", DeviceId="unified-frontend-1", Version="1.0.0", Token="<api_token>"
  ```
  Store the Jellyfin API token as `JELLYFIN_API_KEY` env var. Generate it from Jellyfin admin dashboard
  (Dashboard → API Keys → New API Key).
- **Streaming:** Jellyfin stream URLs require the token either as query param `?api_key=<token>` or
  in the Authorization header. For embedded player, use the token in the URL since it is a `<video>`
  src attribute.

Key API operations:

| Operation | Endpoint |
|---|---|
| Get user views (libraries) | `GET /Users/<userId>/Views` |
| Browse library items | `GET /Users/<userId>/Items?ParentId=<libId>&SortBy=SortName&SortOrder=Ascending` |
| Search library | `GET /Users/<userId>/Items?SearchTerm=<q>&Recursive=true` |
| Get item details | `GET /Users/<userId>/Items/<itemId>` |
| Continue watching | `GET /Users/<userId>/Items/Resume?Limit=<n>` |
| Recently added | `GET /Users/<userId>/Items/Latest?ParentId=<libId>` |
| Get playback info (stream URL) | `POST /Items/<itemId>/PlaybackInfo` |
| Stream direct play | `GET /Videos/<itemId>/stream?api_key=<token>&static=true` |
| Get image | `GET /Items/<itemId>/Images/Primary?width=<n>` |

The app needs a server-level Jellyfin userId (from the API token's associated user) to make
`/Users/<userId>/...` calls. Fetch it at startup: `GET /Users/Me` with the API key auth header.

### qBittorrent

- **Internal URL:** `http://qbittorrent:8080`
- **API base:** `http://qbittorrent:8080/api/v2`
- **Auth:** Cookie-based session. Must POST to `/auth/login` with `username` and `password`
  (`application/x-www-form-urlencoded`) and persist the `SID` cookie for subsequent requests.
  Store credentials as `UMT_USERNAME` and `UMT_PASSWORD` env vars (the UMT abstraction layer reads these).
- **CORS / proxy requirement:** All qBittorrent calls must go through Next.js API routes
  (`/api/qbt/...`). The session cookie (`SID`) is held server-side. Never expose qBt credentials
  or cookies to the browser.
- **UMT:** The unified-frontend client abstraction for this service is called **UMT (Unified Media Torrent)** and is configured via `UMT_URL`, `UMT_USERNAME`, `UMT_PASSWORD` env vars.

Key API operations:

| Operation | Endpoint |
|---|---|
| Login (get SID cookie) | `POST /auth/login` form: `username`, `password` |
| Get torrent list | `GET /torrents/info` (optional: `?filter=<downloading\|seeding\|completed>`) |
| Get torrent count | `GET /torrents/count` |
| Get global transfer info | `GET /transfer/info` (speeds, connection counts) |
| Pause torrents | `POST /torrents/pause` form: `hashes=<hash1>\|<hash2>` |
| Resume torrents | `POST /torrents/resume` form: `hashes=<hash>` |
| Delete torrents | `POST /torrents/delete` form: `hashes=<hash>&deleteFiles=<bool>` |
| Add torrent by URL | `POST /torrents/add` form: `urls=<magnet_or_url>` |
| Get transfer speeds | `GET /transfer/info` |

The `QbitTorrent` object includes: `hash`, `name`, `state`, `progress` (0–1), `dlspeed`, `upspeed`,
`size`, `downloaded`, `eta`, `category`, `save_path`.

### Sonarr

- **Internal URL:** `http://sonarr:8989` (bridge network — reachable by container name or `http://192.168.0.50:8989`)
- **API:** REST; auth header `X-Api-Key: <SONARR_API_KEY>`
- **Proxy route:** `/api/sonarr/[...path]`
- **Env vars:** `SONARR_URL`, `SONARR_API_KEY`
- **Used for:** series monitoring status on media detail pages

### Radarr

- **Internal URL:** `http://radarr:7878` (bridge network — reachable by container name or `http://192.168.0.50:7878`)
- **API:** REST; auth header `X-Api-Key: <RADARR_API_KEY>`
- **Proxy route:** `/api/radarr/[...path]`
- **Env vars:** `RADARR_URL`, `RADARR_API_KEY`
- **Used for:** movie monitoring status on media detail pages

### Prowlarr

- **Internal URL:** `http://prowlarr:9696` (bridge network — reachable by container name or `http://192.168.0.50:9696`)
- **API:** REST; auth header `X-Api-Key: <PROWLARR_API_KEY>`
- **Proxy route:** `/api/prowlarr/[...path]`
- **Env vars:** `PROWLARR_URL`, `PROWLARR_API_KEY`
- **Used for:** indexer status and search

### Bazarr

- **Internal URL:** `http://bazarr:6767` (bridge network — reachable by container name or `http://192.168.0.50:6767`)
- **API:** REST; auth header `X-Api-Key: <BAZARR_API_KEY>`
- **Proxy route:** `/api/bazarr/[...path]`
- **Env vars:** `BAZARR_URL`, `BAZARR_API_KEY`
- **Used for:** subtitle management

### Download Client Registry

Client selection is abstracted behind `src/lib/download-client/`:

| File | Status |
|---|---|
| `config.ts` | `getDownloadClientConfig()` — reads `DOWNLOAD_CLIENT` (default `umt`), `UMT_URL`, `UMT_USERNAME`, `UMT_PASSWORD` env vars; returns typed config object |
| `registry.ts` | Selects active client from `DOWNLOAD_CLIENT` env var |
| `qbittorrent.ts` | Fully implemented (primary client) |
| `transmission.ts` | Stub — not yet implemented |
| `deluge.ts` | Stub — not yet implemented |
| `types.ts` | Shared type definitions |

---

## 4. Tech Stack Decision

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js 16+ App Router (TypeScript) | Matches Seerr's stack; server components solve CORS and auth header forwarding cleanly |
| Styling | Tailwind CSS + shadcn/ui | Fast to build, accessible, no design system to maintain |
| Server state | TanStack Query (React Query) | Caching, background refetch, loading/error states; ideal for live download queue polling |
| Client state | Zustand | Lightweight; manages selected media item, player open/closed, sidebar state |
| Jellyfin API | `@jellyfin/sdk` | Official TypeScript SDK, typed responses, handles auth headers |
| qBittorrent API | Direct fetch via Next.js API routes | No official SDK; the VueTorrent source (`QbitProvider.ts`) is the reference implementation |
| Seerr API | Direct fetch with typed wrappers | Seerr exposes a clean REST API; API spec at `seerr-api.yml` in the source |
| Package manager | npm (or pnpm) | Use pnpm if using pnpm workspaces; npm otherwise |
| Linting | ESLint + Prettier | Standard Next.js config |

### Key package versions (actual installed versions as of v0.9.1)

- `next`: `^16.2.7` (App Router stable)
- `react` / `react-dom`: `^19.0.0`
- `typescript`: `^6.0.3`
- `tailwindcss`: `^4.3.0` (Tailwind v4 — no `tailwind.config.js`; uses `@tailwindcss/postcss` in PostCSS config)
- `@tanstack/react-query`: `^5.100.14`
- `zustand`: `^5.0.14`
- `@jellyfin/sdk`: `^0.13.0`

---

## 5. Page / Feature Map

```
app/
  app/
    layout.tsx                  # Root layout: nav sidebar, auth header injection
    page.tsx                    # / → Home dashboard
    browse/
      page.tsx                  # /browse → Discover + acquisition browser
      [id]/
        page.tsx                # /browse/[id] → Acquisition detail (request controls)
    library/
      page.tsx                  # /library → Owned media grid
      [id]/
        page.tsx                # /library/[id] → Play-only detail (no acquisition controls)
    requests/
      page.tsx                  # /requests → Seerr request list
    downloads/
      page.tsx                  # /downloads → qBittorrent queue
    search/
      page.tsx                  # /search → Unified search
    admin/
      layout.tsx                # Admin layout: nav with User Monitoring + User Management links
      monitoring/
        page.tsx                # /admin/monitoring → User monitoring dashboard
      users/
        [id]/
          page.tsx              # /admin/users/[id] → Per-user detail (5 tabs)
    settings/
      layout.tsx                # Settings sidebar; shows Admin Panel link if role === 'admin'
    api/
      jellyfin/[...path]/
        route.ts                # Proxy to Jellyfin (auth header injection)
      requests/
        route.ts                # Native request API (replaced /api/seerr/[...path] proxy — Phase 7)
      qbt/
        login/route.ts          # Manages SID cookie acquisition
        [...path]/route.ts      # Proxy to qBittorrent with SID cookie
      admin/
        monitoring/route.ts     # GET /api/admin/monitoring — aggregated user list
        users/[id]/
          monitoring/route.ts   # GET /api/admin/users/[id]/monitoring — full per-user data
          route.ts              # PATCH (role/is_active/force_pw_change) + DELETE
```

### Page specs

**`/` — Home dashboard**
- Continue Watching row (native `getResumeItems` — only `movie`/`episode` types, never series containers)
- Recently Added row (native `getRecentlyAdded` — returns both movies and series containers)
  - Movie cards link to `/play/${id}` (direct playback)
  - Series cards link to `/library/${id}` (play-only detail) — series containers have no `file_path` and cannot be played directly
- Recent Requests strip (native `getAllRequests`)
- Download queue summary (qBt `GET /transfer/info` + active torrents count)
- Auto-refreshes download summary every 10 seconds via React Query `refetchInterval`

**`/browse` — TMDB discovery surface (v0.9.6+)**
- **Every tab is TMDB discovery**, cross-referenced against the local library so "In Library" / request status show inline. Owned-media-by-type browsing lives at `/library`, not here.
- **Filter model (v0.9.7+)** — Type tabs + filter controls work together (`FilterState` in `browse/page.tsx`):
  - **Type tabs**: ✦ Browse (`all`) · Movies (`movie`) · TV Shows (`tv`) — media-type scope.
  - **Sort** (`sort`): Popularity / Top Rated / Newest / Oldest / Most Voted → `discoverTMDB`'s
    `DiscoverSort` → TMDB `sort_by` (rating adds a `vote_count.gte` floor; Newest/Oldest use
    `primary_release_date` for movies, `first_air_date` for tv).
  - **Year** + **Min rating** filters; **Genre** pills (single-type only — genre IDs differ movie/tv).
  - URL params: `type, q, sort, year, minRating, genre, page` — `buildQuery()` preserves the subset.
- Fetch strategy (`fetchDiscover()`), within TMDB's API limits:
  - Movies/TV, no query → `discoverTMDB(type, {sortBy, year, minRating, genreId, page})`.
  - **All**, no filters → trending mixed feed (`getTrendingContent('trending')` — the default landing).
  - **All**, any filter set → merge `discoverTMDB('movie', …)` + `discoverTMDB('tv', …)` at the same sort, interleaved.
  - **Name search** (any type) → `searchTMDB(q, type, page)`; year/minRating/sort applied client-side to the
    returned page (TMDB `/search` has no `sort_by` — labeled "applied to this page" in the UI).
- `discoverTMDB(type, opts)` (`tmdb.ts`) replaced the old genre-only `discoverByGenre`. The
  `trending-movies`/`trending-tv` categories on `getTrendingContent` remain but are no longer used by
  the typed tabs (Sort presets replaced them).
- `RequestOptions` component handles per-card request UI — two buttons for old content, one for new. For **TV** it opens `SeriesScopeModal` so the user can grab the full series, specific seasons (e.g. just Season 1), or individual episodes before submitting. This is the path to "find Pokémon → grab Season 1".
- `/browse/discover/[mediaType]/[tmdbId]` — full detail page for TMDB items not yet in library (same `RequestOptions` / season-scope flow via `RequestButton`).
- **Admin direct-grab — seasons AND arcs (v0.9.7+, arcs added v0.9.10):** on a TV detail page each season
  (or **arc**) card shows a `SeasonGrabControl` (admin only). Pick a language + quality profile, then
  `POST /api/grab/season` (`requireAdmin`+`verifyOrigin`). The body carries EITHER `seasonNumber` OR
  `arc:{name,episodes}`; arc precedence handled server-side.
  - **Arcs (v0.9.10, Bug 7):** TMDB bundles long-running anime into "seasons" that span multiple story
    arcs (e.g. One Piece S13 = "Impel Down & Marineford", abs eps 422–522). `getArcs(tmdbId)` (`tmdb.ts`)
    reads TMDB **episode_groups** (type 5, preferring "Arcs (Official)") and returns each arc's real
    episode list (Impel Down 422–458, Marineford 459–516 as **separate** grabbable arcs). Cached via
    Next's fetch data cache (`revalidate 86400`) + a per-process `Map<tmdbId, SeriesArc[]>`. Returns `[]`
    for movies and any series TMDB doesn't arc-group (most non-anime) → the detail page falls back to plain
    season cards. Normal shows are unaffected.
  - `mode:'auto'` → `findSeasonPack()` / `findArcPack()` searches a **pack** in that language/quality →
    grabs it or returns `no_pack`. `findArcPack` queries the absolute range ("One Piece 422-456") and keeps
    releases whose title references an overlapping numeric range.
  - `no_pack` → the UI offers "Grab episode by episode" → `mode:'episodes'` fans out one **wanted** monitored
    item per episode; the **5-min** grab cron then finds each. Per-episode `createItem` failures are logged
    structured + counted; the response is `{queued, failed, total, status:'scheduled'}` and the toast says
    "scheduled for search, NOT downloading yet" (no optimistic success).
  - **Interactive grab (v0.9.10):** "Choose release (interactive)" → searches `/api/torrent-search` (FULL
    candidate set, zero hard rejects) → admin grabs any row (including scorer-rejected ones) via the **same**
    `/api/grab/season` enqueue path using `override:{magnetUrl,…}` (server `requireAdmin`-gated).
  - **Manual search in the chooser (v0.9.10):** the interactive chooser is two tabs — **Auto candidates**
    (the scored auto-query list, unchanged) and **Manual search**, a free-text box that hits the **same**
    `/api/torrent-search` path with the admin's typed query to surface a specific release group, uploader, or
    differently-named batch the arc/season query missed. Manual results render in the identical table (release
    / seeds / size / score / Grab) and grab through the identical `override` enqueue path — there is **no**
    separate indexer or grab path. They are scored and 0-seed-flagged exactly like the auto list, and the Grab
    button is never gated on score (this is the override surface — a low/zero score never blocks a manual grab).
    The box seeds with the bare show title (editable/clearable). Manual results are de-duped by infoHash
    (highest-seeded copy kept); a manual row already in the auto list is tagged "in Auto" for orientation but
    stays grab-able. A failed manual search shows inline and keeps the chooser open. All admin-gated client-side
    (the control only renders for admins) with the same server `requireAdmin` gate on the grab.
  - Every successful grab also writes a `media_requests` row (status `approved`) so it shows on the Requests
    page with the exact scope: season number, or **arc episodes + `scope_label`** (the arc name, e.g.
    "Impel Down"). Repeat grabs of the same show merge scope (union episodes, comma-join labels).
  - `GET /api/grab/season/status?tmdbId=&season=` reports `{total,grabbed}` for a progress badge.
  - Bypasses the quick/long-term request system — a direct admin grab. `monitored_items` and `media_requests`
    both carry a **`language`** column (honored by the cron) and a **`scope_label`** column (the arc name).
- **Grab scoring (v0.9.10, Bug 2):** auto-pick **de-prioritizes, never hard-rejects**. `scoreReleaseSoft` +
  `autoPickScore` (`grabber.ts`) rank by quality (profile conditions + resolution/source bonuses; a missed
  **required** condition is a −100 penalty, not removal) + custom format + **seed weighting** (+min(seeders,100);
  a 0-seed/dead release gets −1000 so it sinks below any live release) + language preference (−100 on mismatch).
  Ordering: healthy-correct-quality > healthy-wrong-quality > dead-correct-quality. `findBestRelease` refuses
  to auto-grab a 0-seed release (recorded as `no_seeders`); the interactive list still shows + grabs it. The
  grab-results panel uses the same rank and no longer prints a hard "Rejected" label.
- **Prior behaviour (pre-v0.9.6):** the Movies/TV Shows tabs filtered the *local library*. That duplicated `/library` and blocked discovering un-owned content by type; they are now TMDB discovery.

**`/browse/[id]` — Acquisition detail**
- For content the user does not yet own (or wants to re-acquire); `RequestOptions` is intentionally present here
- Native media server item: poster, backdrop, synopsis, metadata, Sonarr/Radarr monitoring badge
- **Watch Now button** — resolves the correct playback target based on item type:
  - Movie / episode with `file_path` set → `/play/${item.id}` (direct)
  - Series container (`file_path = NULL`) → `getSeriesResumeEpisode(userId, id)` finds the most recently watched in-progress episode; falls back to `episodes[0]` (first episode by season/episode number); button hidden if series has no scanned episodes
- Request button (if item has a TMDB ID and is not an episode) → native request system
- Request status badge for already-requested items
- Episode list accordion for series (seasons → episodes linking to `/play/${ep.id}`)
- Similar items row

**`/library` — Owned media grid**
- Paginated grid of all locally owned content from `media_items` (movies + series containers)
- Type tabs: All · Movies · TV Shows; sort by title/year/added; items-per-page selector (25/50/100)
- **All cards (movies + series) link to `/library/${id}`** (the info/detail page) — clicking a movie
  no longer jumps straight into playback (v0.9.7+); Watch Now plays from the detail page. (The home
  page's Recently Added still links movies directly to `/play/${id}`.)
- Distinct from Browse — no TMDB discovery, no request controls, no acquisition UI

**`/library/[id]` — Play-only media detail (+ admin delete, v0.9.7+)**
- Poster, backdrop, synopsis, year/runtime metadata — same visual layout as `/browse/[id]`
- **No acquisition controls**: no `RequestOptions`, no retention selector, no grab method, no language picker
- **Admin-only corner gear** (`LibraryItemAdminMenu`) → "Delete from server": confirm modal →
  `DELETE /api/admin/media/[id]` → `purgeMediaItem()` (`lib/media-server/purge.ts`) removes the file(s)
  from disk (+ tidies empty dirs), deletes the matching torrent(s) from the download client (via
  `grab_history.info_hash`), and clears the `media_items`/watch-state/`monitored_items`/`media_requests`/
  grab rows; then redirects to `/library`. Gated by `requireAdmin` + `verifyOrigin`; non-admins never see the gear.
- Movie with `file_path`: Watch Now → `/play/${item.id}`
- Series container: Watch Now resolves resume episode via `getSeriesResumeEpisode` or falls back to `episodes[0]`; full season/episode accordion where each row links to `/play/${ep.id}`
- Similar items section links to `/library/${s.id}` (series) or `/play/${s.id}` (movie) — never to `/browse`

**`/requests` — Seerr request list**
- Paginated list: `GET /request` with filter tabs (All, Pending, Approved, Available)
- Each card shows title, requester, status, approval state
- Delete / approve / decline actions (if user has Seerr admin permissions)
- Link to the corresponding `/browse/[id]` page

**`/downloads` — Download queue**
- Torrent list from `GET /torrents/info`
- Columns: name, status, progress bar, size, speed, ETA, category
- Pause / resume / delete actions per torrent
- Global transfer speeds in header (download/upload)
- Polls every 5 seconds via React Query `refetchInterval`

**`/search` — Unified search**
- Single search box
- Results in two tabs: Library (Jellyfin `?SearchTerm=`) and Discover (Seerr `GET /search`)
- Library results link to `/browse/[id]`
- Discover results link to `/browse/[id]` if already in library, or show Request button if not
- Debounced input, 300ms delay before firing queries

**`/admin/monitoring` — User monitoring dashboard (v0.5.3+)**
- Table of all users populated from `GET /api/admin/monitoring`
- Columns: username, name, email, status (active/suspended), role, last known IP + country, active session count, last watched title + timestamp, total watch count, last login time
- Each row links to `/admin/users/[id]`

**`/admin/users/[id]` — Per-user detail (v0.5.3+)**
- Five tabs: Overview, Sessions, Watches, Audit, Logins
  - **Overview:** full profile info + activity stats (total watches, watch time, active sessions)
  - **Sessions:** all sessions with IP, user agent, created/last seen/expires, active/expired status
  - **Watches:** full watch history (title, type, S/E, progress, watch time, started, completed)
  - **Audit:** audit log entries for this user (event type, details, IP, location, when)
  - **Logins:** login attempt history (IP, success/fail, timestamp)
- Action buttons: Suspend/Activate, Reset Password, Force PW Change, Promote to Admin / Demote to User, Delete Account
- Data from `GET /api/admin/users/[id]/monitoring`

**`/settings/layout.tsx` — Settings sidebar (v0.5.3+)**
- Reads session role server-side; if `role === 'admin'` renders a purple "Admin Panel" link at the bottom of the sidebar pointing to `/admin/`

---

## 6. Build Phases

### Phase 1 — Scaffolding

Goal: App runs in Docker, is reachable at `media.minijoe.dev`, and auth headers are available.

- `npx create-next-app@latest app --typescript --tailwind --app --src-dir`
- Add `Dockerfile` to `app/` (multi-stage: build → runner)
- Add `unified-frontend` service to `/opt/docker/compose/docker-compose.yml`
  - Image: built from `app/Dockerfile`
  - Port: `3000` (internal only)
  - Env: `SEERR_API_KEY`, `JELLYFIN_API_KEY`, `UMT_USERNAME`, `UMT_PASSWORD`
  - Volumes: none required for production
- Add Caddy route for `http://media.minijoe.dev` — simple `reverse_proxy unified-frontend:3001`, no `forward_auth`
- Root layout uses `AuthContext` / `requireAuth()` for auth, not Authentik headers
- Health check endpoint at `/api/health`

Acceptance: `https://media.minijoe.dev` loads and redirects to `/login` if unauthenticated.

### Phase 2 — Jellyfin integration

Goal: Browse the full media library, view detail pages, play content.

- Install `@jellyfin/sdk`, configure a server-scoped Jellyfin API client in `lib/jellyfin.ts`
- Fetch the admin user ID via `GET /Users/Me` at app startup (cache in module scope or env)
- `/browse`: library grid with poster images via `/Items/<id>/Images/Primary`
- `/browse/[id]`: detail page with metadata and embedded `<video>` tag pointing to Jellyfin stream URL
- `GET /Users/<id>/Items/Resume` for continue watching on home page
- Image proxy: `app/api/jellyfin/image/[itemId]/route.ts` — serves images with auth header injection
  (avoids embedding API tokens in `<img src>`)

Acceptance: Can browse Movies library, open a detail page, and play a file.

### Phase 3 — Seerr integration

Goal: Search for content not in the library and submit requests.

- Install no new packages; use fetch wrapper in `lib/seerr.ts`
- `/search`: two-tab results (Library vs. Discover)
- `/browse/[id]`: if item is found in Seerr via TMDB ID cross-reference, show request status
  badge; if not in library, show Request button
- `/requests`: paginated request list with status badges and filter tabs
- `POST /request` from detail page or search results

Acceptance: Can search for a movie, see it is not in the library, submit a request, and see it in `/requests`.

### Phase 4 — qBittorrent integration

Goal: View and manage the active download queue.

- `lib/qbt.ts`: server-side session manager that holds the `SID` cookie, auto-logs back in on 403
- `/api/qbt/[...path]/route.ts`: transparent proxy with cookie forwarding
- `/downloads`: torrent list with progress bars, speeds, pause/resume/delete per torrent
- Home page download summary widget

Acceptance: `/downloads` shows active torrents with live progress, pause/resume works.

### Phase 5 — Unified UX

Goal: Everything feels like one product, not three duct-taped together.

- Home dashboard combining all three data sources
- Cross-service linking: a completed Seerr request links to `/browse/[id]`; a downloading
  torrent links to the matching media detail page (matched by Radarr/Sonarr naming conventions)
- Global search bar in nav (routes to `/search`)
- "Recently Added" items on home page link directly to playback
- Notification badge for pending download ETA on media detail pages
- Responsive layout: works on tablet/phone (primary use case: phone as remote while watching)

---

## 7. Known Constraints and Gotchas

### qBittorrent session auth

**The UMT (Unified Media Torrent) layer connects to a qBittorrent backend.**

qBittorrent's Web API uses cookie-based sessions, not API keys. The session cookie must be obtained
by POSTing credentials to `/api/v2/auth/login`. All subsequent requests must include the cookie as
`Cookie: <NAME>=<value>`. This entire flow must stay server-side in Next.js API routes.
On a 403 response, re-authenticate and retry once.

**v5 differences (v5.2.1 running):**
- Login returns HTTP `204` (No Content) on success instead of `200` with body `"Ok."`. The code
  checks `res.ok` (true for any 2xx), so both versions are handled transparently.
- The session cookie name changed from `SID` to `QBT_SID_{port}` (e.g. `QBT_SID_8080`). Both
  `session.ts` and `download-client/qbittorrent.ts` use the regex
  `/((?:QBT_SID_\d+|SID)=[^;]+)/` to capture the full `NAME=VALUE` pair from `Set-Cookie` and
  pass it directly as the `Cookie` header value, so v4 and v5 are handled by the same code path.

### qBittorrent uses `up_` not `ul_` for upload (Bug 6)

qBittorrent's `/transfer/info` and `/sync/maindata` `server_state` use **`up_info_speed`** /
**`up_info_data`** / **`up_rate_limit`** for upload — NOT `ul_*`. Reading `ul_info_speed` returns
`undefined`, which formatted as "NaN undefined/s" in the Downloads header (and, once band-aided with
`?? 0`, silently showed `0`/`—`, hiding the real upload rate). `TransferInfo` (`qbittorrent/types.ts`) and
`download-client/qbittorrent.ts` now read `up_*` (with a `ul_*` fallback for safety). `formatBytes`
(`lib/utils.ts`) is NaN/undefined/≤0-safe (returns `0 B`) so a missing speed never prints "NaN undefined".

### qBittorrent add returns 409 on a duplicate (Bug, v0.9.10)

`POST /torrents/add` returns **409** when the infohash is already in the client. This happens when several
per-episode `wanted` items resolve to the same range pack (the first add succeeds, the rest 409). A 409
means the content is already downloading, so `download-client/qbittorrent.ts#addTorrent` swallows it as a
no-op grab — otherwise the grabber treated it as an error and retried that item every 5 min forever.

### qBittorrent proxy is `/api/qbit/...` (with an `i`)

The browser-facing qBittorrent proxy route is `src/app/api/qbit/[...path]/route.ts` → call it at
**`/api/qbit/...`**. `/api/qbt/...` (no `i`) is not a route and returns Next.js 404 HTML with status 200 —
which, if a caller checks only `res.ok`, looks like an empty/garbage success (this is what made the detail
panel's Files tab silently empty before the typo was fixed).

### Jellyfin network_mode: host

The Jellyfin container runs with `network_mode: host`, which means it does not have a container
hostname on the Docker bridge network. Use `http://192.168.0.50:8096` (the host IP) for all
server-to-server Jellyfin calls. Do not use `http://jellyfin:8096`.

### Jellyfin stream URLs and tokens

Jellyfin stream URLs are not unauthenticated. For a `<video src="...">` tag, append
`?api_key=<token>` to the stream URL. Do not put the token in a response header for video
resources — browsers do not forward custom headers on video requests. Alternatively, proxy the
stream through a Next.js route handler, but this adds latency on the server.

### Auth is no longer Authentik-gated (v0.4.0+)

`unified.minijoe.dev` uses its own SQLite-backed session system. Authentik is not in the request
path. `X-Authentik-*` headers are no longer read anywhere in the app.

**Note:** If `ADMIN_PASSWORD` is missing or fails the password policy, a secure random password is
auto-generated and printed to stderr — check `docker logs unified-frontend` after first start if
you didn't set it. The admin is forced to change it on first login. Set `ADMIN_PASSWORD` in
`.env.local` before the first run to use your own password.

**Docker volume:** The SQLite DB lives at `/data/unified.db` inside the container. The compose
file mounts the named volume `unified-db:/data`. Never delete this volume without a backup.

### Proxy file naming (Next.js 16)

Next.js 16 deprecated the `middleware` file convention in favour of `proxy`. The UX redirect guard lives at `src/proxy.ts` and exports `export function proxy(...)`. In Next.js 16 the file must be named `proxy.ts` and the export must be `proxy` — using the old `middleware.ts` / `export function middleware` names causes silent registration failure (Next.js ignores them). Registered as `ƒ Proxy` in the build manifest.

This is a UX-only redirect guard — not a security boundary. All auth enforcement happens inside server components and route handlers via `requireAuth()` / `requireAdmin()`.

### Stale session cookie loop

`getSession()` in `src/lib/dal.ts` must delete the session cookie before returning null when it finds no matching DB row. If the cookie is left in place on a stale/expired session, the result is an infinite redirect: unauthenticated route → `requireAuth` fails → redirect `/login` → middleware sees cookie → redirect `/` → repeat. The fix is to call `cookieStore.delete(SESSION_COOKIE)` before every `return null` path where a stale cookie was detected.

### Next.js 16: cookie mutations throw in Server Component context

`cookies().set()` and `cookies().delete()` (from `next/headers`) throw `"Cookies can only be modified in a Server Action or Route Handler"` when called during a Server Component render. `getSession()` is invoked from Server Components via `requireAuth()`, so any cookie mutation inside it (session deletion on expiry, 24h rotation set) must be wrapped in `try { ... } catch { /* server component context — no-op */ }`. In Route Handler context the mutations succeed as before. Without this guard, users with expired sessions or sessions past the 24h rotation window get a 500 on every page load: middleware passes them through (cookie present), the page calls `requireAuth()` → `getSession()`, and the bare `cookieStore.delete()` / `cookieStore.set()` throws. All three cookie mutation sites in `src/lib/dal.ts` are already wrapped.

### SMTP for email verification (v0.5.3+)

Email verification on registration uses `src/lib/email.ts` (nodemailer). The following env vars are all optional:

| Variable | Purpose | Default |
|---|---|---|
| `EMAIL_VERIFICATION_REQUIRED` | Set to `'true'` to require email code verification at signup; when `false` (default), accounts are activated immediately on signup | `false` |
| `SMTP_HOST` | SMTP server hostname (e.g. `smtp.gmail.com`) | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username / email | — |
| `SMTP_PASS` | SMTP password or app password | — |
| `SMTP_FROM` | From address for outgoing emails | — |

**Dev fallback:** If any of `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` are not set, `email.ts` does not attempt a real send. The 6-digit verification code is printed to stdout instead, visible via `docker logs unified-frontend`. This is safe in a dev/LAN context where email delivery is not required.

### BunkerWeb WAF

BunkerWeb runs in front of Caddy with global ModSecurity CRS + CrowdSec enabled. Several WAF
features are disabled specifically for `unified.minijoe.dev` via per-domain env vars in
`/opt/docker/compose/edge/docker-compose.yml`:

| Setting | Value | Reason |
|---|---|---|
| `unified.minijoe.dev_USE_BAD_BEHAVIOR` | `no` | Next.js RSC prefetch requests (`?_rsc=...`) accumulate score too fast under the default threshold (10 hits / 60s), causing false bans for normal users. |
| `unified.minijoe.dev_USE_CROWDSEC` | `no` | CrowdSec threat-intel feeds flag VPN and cloud IPs as malicious, blocking first-time external visitors before they reach the app. |
| `unified.minijoe.dev_USE_DNSBL` | `no` | Same reason as CrowdSec — DNSBL feeds include legitimate IPs that appear in shared-IP threat lists. |
| `unified.minijoe.dev_USE_MODSECURITY` | `no` | ModSecurity CRS triggers on password fields in registration POST bodies. The app validates and sanitises all inputs itself. |
| `unified.minijoe.dev_USE_BLACKLIST` | `no` | The IP reputation blocklist (downloads Emerging Threats, firehol, and similar feeds) routinely includes cellular carrier NAT pool ranges. Fresh IPs on those ranges received 403 before they could register — 2472 IPs were blocked from the feeds at the time of discovery. |

Rate limiting remains active (it is not one of the disabled features). Global ModSecurity and
CrowdSec still apply to all other domains.

If a legitimate request is blocked on a different domain, check BunkerWeb logs and add a CRS
exclusion rule rather than disabling WAF rules globally.

### Pi-hole wildcard DNS

Pi-hole resolves `*.minijoe.dev` to `192.168.0.50` for all LAN clients. All service URLs resolve
correctly from within the LAN and from within the Docker host. No special `/etc/hosts` entries
needed in the app container.

### Docker network

All containers except Jellyfin are on the implicit `compose_default` bridge network (no explicit
`networks:` key in the compose file). The unified-frontend container will be on the same network.
Container-to-container calls use `http://<container_name>:<port>`.

Summary of internal addresses:

| Service | Internal address |
|---|---|
| Seerr | `http://seerr:5055` |
| Jellyfin | `http://192.168.0.50:8096` |
| qBittorrent | `http://qbittorrent:8080` |
| Sonarr | `http://sonarr:8989` |
| Radarr | `http://radarr:7878` |
| Authentik | `http://authentik-server:9000` |

### *arr services network

All *arr services (Sonarr, Radarr, Prowlarr, Bazarr) run on the `compose_default` bridge network with port bindings to `192.168.0.50`. They are reachable by both container name (e.g. `http://sonarr:8989`) and host IP (e.g. `http://192.168.0.50:8989`). The `.env.local` file uses host IPs — either form works. Transmission and Deluge download clients exist as stubs in `src/lib/download-client/` but are not yet implemented.

### Seerr API key auth

Seerr checks the `X-API-Key` request header against `settings.main.apiKey`. If the key matches,
the request runs as the admin user (ID 1) by default, or as a specific user if `X-API-User: <id>`
is also provided. Keep the key in `SEERR_API_KEY` env var; never hardcode it.

### Series containers have file_path = NULL

When the scanner processes an episode file it creates a parent series row in `media_items` via `INSERT OR IGNORE` with `file_path = NULL`. This row exists only as a foreign-key target for `series_id`; it has no playable file. Any code path that calls `getNativePlaybackData` with a series container ID will throw on the `!item.file_path` guard. Never generate a `/play/${id}` link from a row where `type = 'series'`. The safety net in `play/[id]/page.tsx` redirects to `/browse/${id}` on this condition, but the upstream links should never produce the ID in the first place.

### Library vs Browse routing — ownership determines destination

All rows in `media_items` are owned content (scanned from disk). The routing rule is:

- **Owned series** → `/library/${id}` — play-only detail, no acquisition controls
- **Owned movie** → `/library/${id}` from the `/library` grid (the info page; Watch Now plays from there,
  v0.9.7+). The home dashboard's Recently Added/Continue Watching still link movies straight to `/play/${id}`.
- **Discoverable content** (TMDB, not yet in library) → `/browse/discover/${mediaType}/${tmdbId}`
- **Browse cards that are already owned** → `/browse/${id}` (the "In Library — Watch" affordance on a discover card reached from the Browse surface) — intentionally shows the acquisition detail for an owned item, because the user got there from discovery.

`/browse` is now entirely TMDB discovery (all three tabs); there is no longer a "browse library tabs" surface there — owned-media-by-type lives at `/library`. If an item appears in both contexts, the context determines the destination: Library links → Library detail, Browse/discover links → Browse detail. Never link from home-page or library-context cards to `/browse/[id]` for owned content — that drops the user into the acquisition UI for something they already have.

### Video element errors do not bubble as React events

The `<video>` DOM element fires `error` on the element directly — it does not propagate as a React synthetic event and is not caught by `try/catch` around `video.play()`. Any video loading failure (404 from stream route, unsupported codec, network drop) that is not handled via the React `onError` prop on the element leaves `isLoading = true` permanently if `handleWaiting` fired before the error. Always keep `onError={handleVideoError}` wired on the `<video>` element in `VideoPlayer.tsx`.

### MKV and seek-before-loadedmetadata

Setting `video.currentTime` before `loadedmetadata` fires causes silent stalls on MKV files (and sometimes late-faststart MP4). The browser needs to fetch and parse the container index (Cues element for MKV) before it can resolve a timestamp to a byte offset for a range request. Set `currentTime` in the `loadedmetadata` handler only. The `resumeApplied` ref in `VideoPlayer` guards against double-application across quality switches.

### screen.orientation.lock requires active fullscreen (Android)

`screen.orientation.lock('landscape')` on Android Chrome throws `SecurityError` if the document is not currently in fullscreen. Always `await container.requestFullscreen()` first, then call `screen.orientation.lock`. The `toggleFullscreen` function is `async` for this reason. On iOS Safari both `requestFullscreen` (on a div) and `screen.orientation.lock` are unsupported and handled via try/catch fallbacks.

### Sidebar/MobileNav active-highlight: use `pathname.startsWith(href + '/')`

The isActive check for nav items must use `pathname === href || pathname.startsWith(href + '/')` — note the trailing slash. Using bare `pathname.startsWith(href)` causes `/browse` to falsely match any route that starts with those characters. The Sidebar no longer uses `useSearchParams` for active state; all nav hrefs are plain paths with no query strings.

### react-hooks (React Compiler) rules are enforced at `error` (v0.10.1)

`eslint.config.mjs` keeps `react-hooks/set-state-in-effect`, `refs`, `purity`, and `immutability` at
**`error`** (not the default `warn`). `npm run lint` is clean and a new violation fails the build, so use
the established compliant patterns rather than adding an `eslint-disable`:

- **`set-state-in-effect`** — don't call `setState` synchronously in an effect body. For fetch/restore-on-mount
  effects, defer the work a tick (`const id = setTimeout(fn, 0); return () => clearTimeout(id)`); the rule
  flags any synchronous setState *reachable* from the effect, including calling an `async` function that
  setStates (so deferral, not just removing a leading `setLoading(true)`, is what clears it). For "reset state
  when a prop changes" use the during-render adjust pattern (`if (prop !== prev) { setPrev(prop); setX(...) }`).
  For SSR-safe localStorage hydration use `useSyncExternalStore` (see `useSettings`/`useIsClient`), or a lazy
  `useState(() => …)` initializer for components that never render during SSR (e.g. the player-tool panels,
  which only mount after the Sliders click).
- **`refs`** — never read or write `ref.current` during render. Keep "latest value" refs current in an effect
  (`useEffect(() => { ref.current = value })`); if a value is needed *in render*, make it state and set it from
  an event handler (see `pendingResumeSeconds` and the stats-overlay resolution in `VideoPlayer`).
- **`purity`** — no `Date.now()`/`Math.random()` in a render body; route clock reads through `nowMs()` (`lib/utils.ts`).
- **`immutability`** — "use before declaration" inside a mount-once listener (the keydown handler referencing
  `toggleFullscreen`/`totalSubCount` declared lower) goes through a live ref populated by a later effect; hoist
  pure helpers (`detectAspectRatio`) to module scope; iterate live DOM lists via `Array.from(...)` before
  mutating element properties.

---

## 8. Development Workflow

### Running locally

```bash
cd /home/minijoe/dev/unified-frontend/app
npm install
npm run dev        # starts on http://localhost:3000
```

In development, auth is handled by the same SQLite session system as production. No header injection needed — the app uses its own `unified-session` cookie and `requireAuth()` throughout.

Service URLs in `.env.local`:

```
# Jellyfin (host network — must use IP, not container name)
JELLYFIN_URL=http://192.168.0.50:8096
JELLYFIN_API_KEY=<from Jellyfin dashboard>
JELLYFIN_USER_ID=<Jellyfin user UUID>

# Seerr
SEERR_URL=http://192.168.0.50:5055
SEERR_API_KEY=<from /opt/docker/configs/seerr/settings.json>

# UMT (Unified Media Torrent) — connects to qBittorrent backend
UMT_URL=http://192.168.0.50:8080
UMT_USERNAME=<umt username>
UMT_PASSWORD=<umt password>

# *arr services (bridge network — host IPs used in dev; container names work in production)
SONARR_URL=http://192.168.0.50:8989
SONARR_API_KEY=<from Sonarr Settings → General>
RADARR_URL=http://192.168.0.50:7878
RADARR_API_KEY=<from Radarr Settings → General>
PROWLARR_URL=http://192.168.0.50:9696
PROWLARR_API_KEY=<from Prowlarr Settings → General>
BAZARR_URL=http://192.168.0.50:6767
BAZARR_API_KEY=<from Bazarr Settings → General>

# App
NEXT_PUBLIC_APP_URL=http://localhost:3001

# Auth — required on first run to seed admin account
ADMIN_USERNAME=<admin username>
ADMIN_PASSWORD=<strong password meeting policy>
DB_PATH=./unified.db
# Number of trusted reverse proxies in front of the app that each APPEND to
# X-Forwarded-For. Production path is BunkerWeb -> Caddy, so default 2. This is how
# getClientIp() finds the real client IP for rate limiting/audit (A1-005): it reads
# the Nth-from-right XFF entry, so client-forged left-side entries can't spoof a
# fresh rate-limit bucket. Set too low and the spoof reopens; too high and every
# client collapses onto one shared bucket. Unset in dev (direct connection).
TRUSTED_PROXY_COUNT=2

# SMTP — all optional; if unset, verification codes print to stdout (docker logs)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
# Email verification — set to 'true' to require email code at signup; default is false (instant activation)
EMAIL_VERIFICATION_REQUIRED=
```

In production (Docker), use container-name URLs (except Jellyfin — use host IP), set
`NEXT_PUBLIC_APP_URL=https://unified.minijoe.dev`, and set `DB_PATH=/data/unified.db`.

### Reference material

- Source code (read-only): `/home/minijoe/dev/unified-frontend/sources/`
  - `seerr/seerr-api.yml` — OpenAPI spec for the Seerr API
  - `seerr/server/routes/` — Route handlers; authoritative API reference
  - `qbittorrent-webui/src/services/qbit/QbitProvider.ts` — All qBt API calls with types
  - `jellyfin-web/src/apiclient.d.ts` — Jellyfin API client type declarations
- Analysis notes: `/home/minijoe/dev/unified-frontend/analysis/`

### Building the Docker image

```bash
cd /home/minijoe/dev/unified-frontend/app
docker build -t unified-frontend:latest .
```

Multi-stage Dockerfile pattern for Next.js standalone output:

```dockerfile
FROM node:24-slim AS builder
WORKDIR /app
# build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs && \
    mkdir -p /data && chown nextjs:nodejs /data
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
VOLUME ["/data"]
USER nextjs
EXPOSE 3001
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

**Note:** Use `node:24-slim` (Debian), NOT Alpine. `better-sqlite3` downloads a glibc-linked
prebuilt binary that does not work on Alpine (musl). The build stage needs `python3 make g++` so
`npm ci` compiles it from source.

Set `output: 'standalone'` in `next.config.ts`.

### Adding to docker-compose

```yaml
  unified-frontend:
    image: unified-frontend:latest
    container_name: unified-frontend
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - SEERR_URL=http://seerr:5055
      - SEERR_API_KEY=${UNIFIED_SEERR_API_KEY}
      - JELLYFIN_URL=http://192.168.0.50:8096
      - JELLYFIN_API_KEY=${UNIFIED_JELLYFIN_API_KEY}
      - UMT_URL=http://qbittorrent:8080
      - UMT_USERNAME=${UNIFIED_UMT_USERNAME}
      - UMT_PASSWORD=${UNIFIED_UMT_PASSWORD}
    ports:
      - "192.168.0.50:3000:3000"
    labels:
      - "com.centurylinklabs.watchtower.enable=false"
```

Watchtower is disabled because the image is built locally, not pulled from a registry.

**Critical: always rebuild via compose, not `docker build`.** When compose manages the build (via the `build:` key), the resulting image is tagged `compose-<service>:latest` (e.g. `compose-unified-frontend:latest`). Running `docker build -t unified-frontend:latest .` produces a separate image that compose never uses — the container keeps running the old compose-managed image. Correct rebuild sequence:

```bash
docker compose build --no-cache unified-frontend
docker compose up -d --force-recreate unified-frontend
```

### Caddy route for unified.minijoe.dev (v0.4.0+)

The Caddyfile block is simple — no `forward_auth` needed:

```caddyfile
unified.minijoe.dev {
  import compressed
  reverse_proxy unified-frontend:3001
}
```

To update the live Caddyfile, run the helper script (brace-counting Python replacer):

```bash
python3 /home/minijoe/dev/unified-frontend/scripts/update-caddyfile.py
```

Then reload Caddy:

```bash
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

---

## 9. Video Player — Player Tools

All player tool components live in `src/components/player/`. They are composed inside `MediaToolsPanel`, which `VideoPlayer` renders when the Sliders button is clicked.

### Component map

| File | VLC analogue | Description |
|---|---|---|
| `types.ts` | — | Shared interfaces: `PlaybackRate`, `ABLoopState`, `Bookmark`, `VideoFilterState`, `QualityOption`, `AspectRatioMode`, `MediaChapter`, `AudioChainNodes`, EQ presets |
| `MediaSpeedControl` | `rate` Q_PROPERTY | 0.25×–4× speed buttons; syncs from `ratechange` event |
| `MediaABLoop` | `ABLoopA/B`, `toggleABloopState()` | Set A/B points, loop at 300ms poll; clears on unmount |
| `MediaFrameAdvance` | `frameNext()` | Step ±1 frame (1/24s); pauses before stepping |
| `MediaAspectRatio` | `aspectRatio`, `crop`, `fit` | 7 modes; callback to parent to apply CSS |
| `MediaJumpToTime` | Go to Time dialog | MM:SS or HH:MM:SS input, range-validated |
| `MediaVideoEffects` | Extended video effects | CSS `filter` for brightness/contrast/saturation/hue; callback to parent |
| `useAudioChain` | — | Web Audio hook; creates chain lazily, cached in ref — `createMediaElementSource()` can only be called once per element |
| `MediaEqualizer` | `Equalizer`, `equalizer.c` | 10-band EQ via BiquadFilterNodes; 8 presets |
| `MediaAudioTools` | `Compressor`, `gain.c`, `stereo_pan.c` | Volume boost (GainNode), compressor toggle (DynamicsCompressor), stereo pan (StereoPannerNode) |
| `MediaBookmarks` | Bookmarks dialog | localStorage per `storageKey` prop; editable labels |
| `MediaChapters` | chapter TrackListModel | Chapter list from `PlaybackData.chapters`; prev/next nav |
| `MediaSnapshot` | `snapshot()` | Canvas → PNG download |
| `MediaToolsPanel` | Extended panels dialog | 4-tab overlay (Playback / Video / Audio / Info) |
| `MediaQualitySelector` | — | Gear dropdown in controls bar; hidden when only 1 quality available |
| `MediaTransform` | — | Rotation (0/90/180/270°), horizontal/vertical flip, zoom presets, 3×3 alignment grid; emits CSS transform + alignment strings to VideoPlayer via callbacks; persists to localStorage |

### Web Audio chain constraint

The chain (`MediaElementSource → 10×BiquadFilter → DynamicsCompressor → GainNode → StereoPanner → destination`) is created by `useAudioChain(videoRef)` and cached in a `useRef`. Calling `context.createMediaElementSource(video)` a second time on the same element throws `InvalidStateError`. The hook guards against this. The chain initializes lazily on first user interaction with an audio tool (browser autoplay policy).

See `docs/audio-chain.md` for the full chain diagram and per-node parameters.

---

## 10. Video Player — Quality & Resolution System

### How quality options are built (server-side)

`getPlaybackData()` in `src/lib/jellyfin/playback.ts`:

1. Extracts native resolution from `MediaSources[0].MediaStreams` (video track `Width`/`Height`)
2. Stores `nativeWidth`, `nativeHeight` on `PlaybackData`
3. Builds `availableQualities: QualityOption[]`:
   - First element: `{ label: 'Direct Play' | 'Auto', isDirect: true, streamUrl: <original> }`
   - Remaining: standard tiers `[4K, 1080p, 720p, 480p, 360p, 240p]` **filtered to only tiers strictly below `nativeHeight`** — never offers upscaling
   - Each lower-quality URL is built by setting `MaxWidth`, `MaxHeight`, `VideoBitrate` on `hlsTranscodeUrl`
4. Always computes `hlsTranscodeUrl` — if Jellyfin returns a `TranscodingUrl`, uses it; otherwise constructs a manual HLS URL with `h264`/`aac` params so quality switching is available even for direct-play content

### Quality switching in VideoPlayer (client-side)

- `activeStreamUrl` / `activeIsHls` state replace `props.streamUrl` / `props.isHls` in the HLS init effect
- Changing quality: `setActiveStreamUrl(quality.streamUrl)` + `setActiveIsHls(quality.isHls)` + `setRetryCount(c => c + 1)` — the retryCount increment triggers HLS reinitialization
- `MediaQualitySelector` dropdown appears in the controls bar between the time display and the Sliders button; hidden if `availableQualities.length <= 1`

### Auto aspect ratio

On mount, `detectAspectRatio(nativeWidth, nativeHeight)` maps the native AR to the closest `AspectRatioMode` within a tolerance of 0.15. If no mode is close enough, falls back to `'auto'` (CSS `object-fit: contain`). Modes and their target ratios:

| Mode | Ratio |
|---|---|
| `16:9` | 1.778 |
| `4:3` | 1.333 |
| `21:9` | 2.333 |
| `2.35:1` | 2.350 |
| `1:1` | 1.000 |
| `9:16` | 0.5625 |

### Screen-aware quality selection

On mount, if `window.screen.height × devicePixelRatio < nativeHeight × 0.75`, the player auto-selects the highest quality tier that fits the screen. This avoids streaming 4K to a 1080p screen. The 75% threshold prevents unnecessary downgrade when the difference is small.

---

## 10a. Video Player — Chrome, Orientation, and Error Handling (v0.9.3)

### App chrome suppression

`AppLayout` (`src/components/layout/AppLayout.tsx`) checks `usePathname()` on every navigation and skips rendering `Sidebar`, `Header`, and `MobileNav` for player routes:

```tsx
const isWatchPage = pathname?.startsWith('/watch/') || pathname?.startsWith('/play/')
```

Both `/watch/[id]` and `/play/[id]` bypass the full app shell. If a new player route is added it must be listed here, otherwise `MobileNav` (fixed bottom-0 z-50) renders on top of the player controls (z-20) and all bottom controls become unreachable on mobile.

### Fullscreen and screen orientation

`toggleFullscreen` in `VideoPlayer.tsx` is `async` to support the Android orientation lock ordering constraint:

1. `await container.requestFullscreen()` — resolves only after the element is fully in fullscreen. Android Chrome requires this before calling `screen.orientation.lock`.
2. `await screen.orientation.lock('landscape')` — called after fullscreen is confirmed. Wrapped in try/catch; throws `NotSupportedError` on iOS Safari and desktop, which must not interrupt playback.
3. iOS fallback: if `requestFullscreen` throws (div not supported), calls `video.webkitEnterFullscreen()` if present, then attempts the orientation lock (will throw and be caught on iOS).

On exit, `screen.orientation.unlock()` is called before `exitFullscreen` so the device returns to natural orientation. `handleBack` also calls `screen.orientation.unlock()` before `router.back()`.

Fullscreen state is tracked via both `fullscreenchange` and `webkitfullscreenchange` events, checking both `document.fullscreenElement` and `document.webkitFullscreenElement`. Without the webkit variant `isFullscreen` is always false on iOS and the Maximize/Minimize button never toggles correctly.

### Resume seek and loadedmetadata

The resume position (`resumePositionTicks`) is applied in `handleLoadedMetadata` — not in the init effect. Setting `video.currentTime` before the browser fires `loadedmetadata` causes seek stalls on MKV and other container formats where the seek index (Cues element for MKV, moov atom for late-faststart MP4) requires additional range requests before the timestamp can be resolved. The `resumeApplied` ref guards against double-application on quality switches.

```
Init effect: video.src = url  →  browser fetches initial bytes
loadedmetadata fires: browser knows duration + seek table
handleLoadedMetadata: video.currentTime = resumeSeconds  →  browser seeks cleanly
```

For HLS the same `loadedmetadata` handler fires after `MANIFEST_PARSED` triggers native playback.

### Video element error handling

The `<video>` element fires `error` on the DOM element — it does not bubble as a React event and is not caught by try/catch around `video.play()`. Without `onError` wired on the element, any playback failure leaves the player in an infinite spinner: `handleWaiting` sets `isLoading = true`, the error fires with no handler, and `isLoading` never clears.

`handleVideoError` reads `video.error.code` and maps it to an actionable message:

| Code | Meaning | Message |
|---|---|---|
| 2 | MEDIA_ERR_NETWORK | Network error — check connection |
| 3 | MEDIA_ERR_DECODE | Unsupported codec |
| 4 | MEDIA_ERR_SRC_NOT_SUPPORTED | Format not playable — try lower quality |
| other | Unknown | File may be missing on server |

The handler calls `setIsLoading(false)` and `setError(message)`, which replaces the spinner with the error overlay and gives the user a retry path.

### Series containers and /play routing

The scanner (`src/lib/media-server/scanner.ts`) creates series container rows in `media_items` with `file_path = NULL`. These rows exist so episodes can reference a parent via `series_id`, but they have no playable file. Any link to `/play/${series_id}` will throw in `getNativePlaybackData` on the `!item.file_path` guard.

Safety net in `play/[id]/page.tsx`: if `getNativePlaybackData` throws and the item type is `series`, the page calls `redirect('/browse/${id}')` instead of `notFound()`.

Upstream prevention:
- `browse/[id]/page.tsx` Watch Now resolves to episode target via `getSeriesResumeEpisode` / `episodes[0]`, never links series container IDs to `/play/`
- `page.tsx` Recently Added uses `item.type === 'series' ? /browse/${id} : /play/${id}`

**`getSeriesResumeEpisode(userId, seriesId)`** — `src/lib/media-server/library.ts`. Joins `media_items` and `media_watch_state` to find the most recently updated in-progress episode for a series (played=0, position_ticks>0, ordered by updated_at DESC). Returns `undefined` if no episode has been started, in which case `episodes[0]` is used as fallback.

---

## 10b. Video Player — Audio & Subtitle Tracks, Language Defaults (v0.9.4)

Codec knowledge for these features is centralised in `src/lib/media-server/codecs.ts` (client-safe — type-only imports). `PlaybackData.audioStreams`/`subtitleStreams` carry `codec`, audio `relIndex`, and subtitle `forced`/`extractable`, threaded from `probe.ts` through `playback.ts`.

### Embedded subtitle extraction → WebVTT

A plain `<video>` element does **not** render embedded MKV subtitle streams on Direct Play. The old `/api/media/subtitles/[id]/[streamIndex]` route only serves *downloaded external* files (`subtitle_wants`) and treats its index as a position in that list — so embedded-subtitle `<track>`s pointed at it rendered nothing.

Embedded tracks now point at **`/api/media/subtitles/embedded/[id]/[streamIndex]`** (`streamIndex` = absolute ffprobe stream index). It probes, rejects image-based codecs (`isImageSubtitleCodec` → PGS/VOBSUB/DVB) with **415** (they need burn-in, not conversion), then `extractSubtitleToVtt()` runs `ffmpeg -map 0:<idx> -c:s webvtt -f webvtt` and caches the `.vtt` under `TRANSCODE_CACHE/.subs/<mediaId>/<idx>.vtt`. Text codecs (ass, subrip, mov_text) convert cleanly; ASS styling/positioning is flattened. The player renders one `<track>` per stream (index-aligned with `activeSubIndex` and the video's `textTracks`); image tracks are shown disabled. No `default` attr — visibility is driven solely by `activeSubIndex` so multi-default files don't auto-show the wrong track.

### Audio track selection & switching (option B — restart-and-seek)

Browsers can't switch embedded audio tracks on Direct Play, so switching routes through HLS with the chosen track mapped (`-map 0:a:<relIndex>`). HLS URLs are namespaced by audio index: **`/api/media/hls/[id]/a[N]/master.m3u8`** (segments resolve relatively under `aN/`); the transcode cache and job registry are keyed per `(mediaId, audioIdx)` (`TRANSCODE_CACHE/<mediaId>/a<idx>/`).

On switch, the player captures `video.currentTime` into `pendingSeekRef`, swaps the source, and `handleLoadedMetadata` consumes the ref to resume at that exact position. This is **option B**: it reuses the player's single position path (`currentTime` / resume / progress / `position_ticks`) — **no timestamp offset / parallel position system** — so watch-progress and continue-watching stay correct. Selecting the server's default track reverts to the original Direct-Play-or-HLS decision.

**Per-path switch cost:** h264 source → cheap remux (`-c:v copy` + audio→aac); hevc/vp9/av1 source → Tier C full VAAPI (video must be re-encoded for HLS-TS). Full VAAPI is reserved for incompatible video only.

**v1 seek limitation (still applies):** transcodes are linear-from-0; seeking past the transcoded point returns 503 (seek backwards to resume). A switch resumes at the captured position by letting the linear transcode reach it.

**FUTURE (option A, deferred):** start the per-audio transcode at the current position via input-seek (`-ss T`, already supported by `buildArgs` `seekSec`) for an instant switch. Deferred deliberately — it requires a stream-start time offset that would fork position tracking away from the single 0-based timeline the watch-progress feature depends on. Documented at the top of `transcode.ts`.

### Language defaults (English) — `usePlaybackPrefs`

The user preference already existed (`/settings/playback` → `usePlaybackPrefs`, localStorage `unified-playback-prefs`): `audioLang` (default `'en'`), `subtitleLang` (default `''` = off). The player now reads it. `usePlaybackPrefs` exposes a `ready` flag so the one-time default applies on the *hydrated* value, not the pre-hydration default. `selectPreferredAudioRel` picks the matching audio track (else server default); `selectPreferredSubtitleIndex` picks the matching subtitle **preferring the full track over signs-and-songs / forced**, and returns -1 (off) when no subtitle language is set. ffprobe 3-letter codes are normalised to ISO 639-1 via `normalizeLang`/`languageMatches`.

### On-demand subtitle search + live `<track>` injection (v0.9.11)

The background subtitle system (Phase 4) writes `subtitle_wants` rows from a nightly library scan and a
download pass; `getNativePlaybackData` reads `status='downloaded'` rows back into `downloadedSubtitles`, which
the player renders as `<track>`s at page-load. v0.9.11 adds the **mid-playback** path so a viewer can fetch a
subtitle that doesn't exist yet, without a reload.

Player surface: `SubtitleSearchPanel` (`src/components/player/SubtitleSearchPanel.tsx`), opened from the
subtitle menu's "Search online…" entry. The captions button now renders even when a title has **zero** tracks
(gated on `subtitleApiBase`) so the search is reachable when there's nothing to toggle.

Routes (all under the player's existing `subtitleApiBase` = `/api/media/subtitles`):

| Route | Auth | Role |
|---|---|---|
| `GET …/search?mediaId=&language=&hi=` | `requireAuth` | Resolves the item's IMDB id **server-side** (never from the client), queries OpenSubtitles, returns trimmed candidates. **Episodes (v0.10.2)** search by the **series** IMDB id + `season_number`/`episode_number` (`parent_imdb_id`/`season_number`/`episode_number`, parent row resolved via `series_id`), falling back to the episode's own imdb, then a series-title query. Movies use the item imdb with a title-query fallback. Does **not** spend the daily download quota. |
| `POST …/grab` | `requireAuth` + `verifyOrigin`, 10/hr/user | Downloads the picked file, `upsertSubtitleWant` (heals an existing `wanted`/`skipped`/`failed` row via the `(item,lang,forced,hi)` UNIQUE index), writes the `.srt` next to the media with language/HI/forced markers, sets `status='downloaded'`. Returns the stable `wantId` + remaining quota; OpenSubtitles 406 → "daily limit reached". |
| `GET …/want/[wantId]` | `requireAuth` | Serves a downloaded sub by immutable `subtitle_wants.id` as WebVTT. |

**Why a by-id serving route.** The pre-existing `…/{id}/{index}` route keys by *positional* index into the
ordered downloaded query. Adding a sub can reorder that query, shifting the URL of an already-rendered track —
fine at page-load (the list is rebuilt) but wrong for a track injected live. So session grabs are served by
the immutable row id instead. In `VideoPlayer`, session grabs live in `extraTracks` state, appended **after**
the server-provided embedded + downloaded tracks (`subtitleTracks = [...embedded, ...downloaded, ...extra]`),
so existing track indices and `activeSubIndex` never shift; `handleSubtitleAdded` selects the new track by its
appended index. `srtToVtt` is shared from `src/lib/subtitle/vtt.ts`. Requires `OPENSUBTITLES_API_KEY` +
`SUBTITLE_MEDIA_ROOT` (the grab returns a clear 503 if either is unset). Any authenticated viewer can search
and grab; the OpenSubtitles daily download quota is shared (plan-dependent: 5/day free, 1000/day VIP), so the
grab route is rate-limited per user (20/hr) and the panel surfaces the remaining count after each grab.

**OpenSubtitles auth model (two quota buckets — important).** The static `Api-Key` alone draws on a low
**anonymous ~100/day** bucket. The **VIP 1000/day** quota is only reached by logging in: the client
(`opensubtitles.ts`) does `POST /login` with `OPENSUBTITLES_USERNAME` + `OPENSUBTITLES_PASSWORD`, caches the
returned JWT (~24h, refreshed on expiry / 401) and its `base_url`, and sends it as `Authorization: Bearer` on
`/download` and `/infos/user`. Without the credentials the feature still works but is capped at ~100/day (a
warning is logged). `GET /api/subtitle/account` (admin) returns the live `/infos/user` quota so a login/auth
failure can be told apart from a subscription problem — if it shows `allowed_downloads: 1000, vip: true`, auth
is fine. `VIP_DAILY_DOWNLOAD_CEILING = 1000` documents the plan ceiling (the live value comes from
`/infos/user`). **Bug fixed in passing:** `searchSubtitles` used to filter on `attributes.format`, which the
v3 search response leaves `undefined` for every result — so it silently returned **zero** candidates and made
the whole subtitle feature appear dead. The filter is removed; format is normalised at download time via
`sub_format: 'srt'`, and the written file is content-validated.

---

## 11. Profile and Account Settings (v0.5.2+)

The profile page at `/settings/profile` is fully self-contained — no Authentik headers, no external identity provider.

### Profile API routes

All routes require a valid session (`requireAuth()`). All mutations go through server-side API routes — never from client directly to DB.

| Route | Method | Purpose |
|---|---|---|
| `PATCH /api/auth/profile/display-name` | PATCH | Update display name (max 64 chars) |
| `PATCH /api/auth/profile/email` | PATCH | Update email (unique, validated) |
| `PATCH /api/auth/profile/demographics` | PATCH | Save first_name, last_name, bio, location |
| `POST /api/auth/profile/change-password` | POST | Change password; revokes all other sessions on success |
| `GET /api/auth/profile/sessions` | GET | List all active sessions with device/IP/timestamps |
| `DELETE /api/auth/profile/sessions/:id` | DELETE | Revoke a specific session (not current) |
| `POST /api/auth/profile/sessions/revoke-others` | POST | Revoke all sessions except current |

`change-password` is rate-limited to 5 attempts per 15 minutes per userId.

### Avatar generation

Initials-based: first letter of first word + first letter of last word if display name has 2+ words, otherwise first 2 chars. Color is derived by hashing the username: `let h = 0; for (const c of username) { h = (h * 31 + c.charCodeAt(0)) & 0xffffffff }; hue = Math.abs(h) % 360`. The same username always produces the same hue.

### DB changes (v0.5.2)

`ALTER TABLE users ADD COLUMN display_name TEXT` — added as a safe additive migration in `src/lib/db/migrations.ts` wrapped in try/catch. Runs automatically on next `getDb()` call.

### DB changes (v0.5.3)

New columns on `users` (all additive `ALTER TABLE ... ADD COLUMN`, wrapped in try/catch):

- `first_name TEXT`
- `last_name TEXT`
- `bio TEXT`
- `location TEXT`

New table `pending_registrations`:

```sql
CREATE TABLE IF NOT EXISTS pending_registrations (
  id TEXT PRIMARY KEY,          -- pendingId returned to client
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  bio TEXT,
  location TEXT,
  code TEXT NOT NULL,           -- 6-digit verification code
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,  -- Unix epoch ms, TTL 10 minutes
  created_at INTEGER NOT NULL
)
```

Records in `pending_registrations` are deleted on successful verification, on 5 failed attempts, or when expired. There is no background cleanup job — expiry is enforced at verification time.

---

## 12. Unified Torrent System (v0.5.2+)

### Types file

All qBittorrent API types live at `src/types/torrent.ts`. Interfaces use exact qBittorrent API field names so responses can be assigned directly without mapping:

- `QbtTorrentState` — union of 19 state strings
- `QbtTorrent` — full torrent list item (44 fields)
- `QbtTorrentProperties` — per-torrent detail from `/torrents/properties` (33 fields)
- `QbtTrackerInfo`, `QbtPeerInfo`, `QbtFileInfo` — detail panel data
- `QbtTransferInfo` — global speeds and disk space
- `QbtPreferences` — all 90 app preference fields from `/app/preferences`
- `TorrentUIPreferences` — localStorage-only UI settings (stored under `unified-torrent-prefs`)

The legacy `Torrent` interface in `src/lib/qbittorrent/types.ts` is extended with the additional fields (`magnet_uri`, `availability`, `super_seeding`, `force_start`, `seq_dl`, `f_l_piece_prio`, etc.) to remain compatible with existing hooks.

### Proxy audit findings (`src/app/api/qbit/[...path]/route.ts`)

Three gaps were found and fixed:

1. **Multipart passthrough** — the old proxy did `new URLSearchParams(text)` for all POST bodies, destroying multipart data. The proxy now checks `Content-Type`: if it contains `multipart/form-data`, it reads the body as `ArrayBuffer` and forwards it verbatim with the original `Content-Type` header (including `boundary=`). This is required for `.torrent` file upload to `/torrents/add`.

2. **Query params on POST** — the old proxy did not forward query string on POST requests. Fixed by appending `req.nextUrl.search` to the endpoint in both the form-urlencoded and multipart paths.

3. **Re-auth on 403** — the underlying `qbitFetch` in `session.ts` already handled this correctly (clear session, re-login, retry once). The new multipart path adds the same retry logic manually since `qbitFetch` only accepts `URLSearchParams`.

### Downloads page (`/downloads`)

Full qBittorrent client UI. Key components:

| Component | File |
|---|---|
| Main page (table, rows, add-torrent, speed graph, settings slide-over) | `src/app/downloads/page.tsx` |
| Per-torrent detail panel (v0.9.10) | `src/app/downloads/TorrentDetailPanel.tsx` |

**Per-torrent detail panel (v0.9.10):** click a torrent name in the list to expand an inline panel with
four tabs — **Overview** (speeds, seeds/peers, ratio, save path…), **Files** (per-file list with a
priority `<select>` Skip/Normal/High/Max + progress bars), **Trackers** (status/seeds/peers), **Peers**
(IP/client/progress/speeds). All tabs live-refresh every 2s while open. Fetch failures are surfaced as an
explicit error (distinct from a genuinely empty list) so a dead fetch never silently shows "0". Calls go to
the `/api/qbit/...` proxy (note the **`qbit`** spelling — `/api/qbt` 404s).

> The committed `src/app/downloads/components/*` (FilterSidebar/TorrentRow/DetailPanel/AddTorrentModal) are
> a **dead alternate UI** from an earlier draft — not wired into the live page (see the 2026-06-13 audit
> dead-code list). The live UI is `page.tsx` + `TorrentDetailPanel.tsx`.

qBittorrent endpoints used:

| Endpoint | Purpose |
|---|---|
| `GET /torrents/info` | Torrent list (polls every 2s) |
| `GET /transfer/info` | Global speeds, free space, DHT nodes |
| `GET /torrents/categories` | Category list for filter sidebar |
| `GET /torrents/tags` | Tag list for filter sidebar |
| `GET /torrents/properties?hash=` | Per-torrent detail (Overview tab) |
| `GET /torrents/files?hash=` | File tree (Files tab) |
| `GET /torrents/trackers?hash=` | Tracker list (Trackers tab) |
| `GET /sync/torrentPeers?hash=` | Peer list (Peers tab) |
| `GET /app/preferences` | Server preferences (Settings page) |
| `POST /torrents/pause` | Pause selected |
| `POST /torrents/resume` | Resume selected |
| `POST /torrents/delete` | Delete (with optional file removal) |
| `POST /torrents/recheck` | Force recheck |
| `POST /torrents/reannounce` | Force reannounce |
| `POST /torrents/add` | Add by URL (form-urlencoded) or file (multipart) |
| `POST /torrents/filePrio` | Set per-file priority |
| `POST /torrents/addTrackers` | Add tracker to torrent |
| `POST /torrents/removeTrackers` | Remove tracker from torrent |
| `POST /transfer/banPeers` | Ban a peer |
| `POST /transfer/toggleSpeedLimitsMode` | Toggle alt speed limits |
| `POST /torrents/setDownloadLimit` | Per-torrent DL limit |
| `POST /torrents/setUploadLimit` | Per-torrent UL limit |
| `POST /torrents/setShareLimits` | Ratio/seeding time limits |
| `POST /torrents/setSuperSeeding` | Super seeding toggle |
| `POST /torrents/setForceStart` | Force start toggle |
| `POST /torrents/setAutoManagement` | Auto TMM toggle |
| `POST /torrents/toggleSequentialDownload` | Sequential download toggle |
| `POST /torrents/toggleFirstLastPiecePrio` | F/L piece priority toggle |
| `POST /app/setPreferences` | Save preferences diff |

### Torrent settings page (`/settings/torrent`)

Eight tabs — first 7 read/write from qBittorrent via `/app/preferences` → `/app/setPreferences` (sends only changed fields as JSON diff). Tab 8 is localStorage only.

| Tab | Coverage |
|---|---|
| Downloads | Save paths, incomplete dir, .!qB extension, auto-delete, subfolder, TMM defaults |
| Connection | Port, UPnP, DHT/PeX/LSD, max connections, encryption, outgoing port range |
| Speed | DL/UL limits, alternative limits, schedule, LAN/uTP/overhead toggles |
| BitTorrent | Anonymous mode, ratio/seeding/inactivity limits, announce options |
| Queue | Queuing enable, active limits, slow torrent thresholds |
| Privacy | Proxy config, IP filter, banned IPs |
| Advanced | I/O threads, disk cache, socket buffers, HTTPS cert validation, SSRF mitigation |
| Interface | Column visibility/order, sort, rows per page, refresh rate, date format (localStorage) |

---

## 13. Future Ideas Backlog

**Watch party sync** — DONE (v0.9.5). Native party play with shared sync, presence, text chat, and emoji reactions over a dedicated WebSocket server. Control is shared by all members (no host-only mode). See section 16.

**Jellyfin user linking** — associate a unified-frontend account with a specific Jellyfin user ID so watch history and resume position reflect that user's actual Jellyfin state rather than the admin API key user. Store `jellyfin_user_id` in the users table; use it for all `/Users/<id>/...` calls when present.

**Push notifications** — Web Push API when a requested item becomes available, polled from Seerr. Store VAPID-encrypted push subscriptions in the DB. Seerr webhook or polling job checks request status; on transition to `available` fire the push.

**Mobile PWA** — `manifest.json` and a service worker enabling home screen install on iOS and Android. Offline metadata browsing via cache-first strategy for library data. Already has a standalone-capable layout.

**Subtitle search** — DONE (v0.9.11). Background auto-download (Phase 4) plus **on-demand search from the
player**: the subtitle menu's "Search online…" entry hits `GET /api/media/subtitles/search` (IMDB id resolved
server-side from the media id), the viewer picks a result, `POST /api/media/subtitles/grab` downloads + persists
it, and the player injects a live `<track>` served by stable `subtitle_wants.id` at
`GET /api/media/subtitles/want/[wantId]` — no reload. See section 10b.

**Admin tools** — per-user watch history, sessions, audit log, and login history are now implemented at `/admin/users/[id]` (v0.5.3). Remaining backlog: bulk session revoke across all users and audit log CSV export.

**Sonarr/Radarr status** — read-only status on media detail pages: monitoring status, quality profile, path. Uses `http://sonarr:8989` and `http://radarr:7878` (both on the Docker bridge network). Sonarr series lookup by TVDB ID; Radarr movie lookup by TMDB ID.

**Download-to-browse linking** — fuzzy match torrent names to Jellyfin library items and show a "View in library" link on the downloads page. Match by stripping resolution/codec tags from the torrent name and comparing against `item.Name`.

**Keyboard shortcut reference** — modal or page auto-generated from existing shortcut definitions in `src/components/player/` and the global shortcut registry (if one exists).

**Rate limiting audit** — confirm all state-mutating API routes (profile mutations, admin actions, Seerr request creation) match the login handler's 10 attempts per 15 minutes per IP policy.

**Torrent creation** — dialog that lets the user set a file path and tracker URLs and calls `POST /api/v2/torrents/createTorrent` (qBittorrent 5.0+).

**Sequential download piece map** — canvas in the Files tab showing downloaded vs. queued pieces. Data from `QbtTorrentProperties.pieces_have` / `pieces_num` and the `piece_range` field on each `QbtFileInfo`.

**Bandwidth quota** — track cumulative downloads per session user with quota shown on the profile page and a soft limit configurable from the admin panel. Requires a new `bandwidth_usage` table.

**Theme marketplace** — export and import custom themes as JSON or URL-encoded share strings. Builds on the existing custom theme system in `ThemeToggle.tsx` (custom themes stored under `unified-custom-themes` in localStorage).

---

## 14. Independence Build

TypeScript services inside this monorepo replacing external *arr stack + Jellyfin. All tables added to `unified.db` via `src/lib/db/migrations.ts`. Background jobs start from `src/instrumentation.ts`.

### Completed phases

| Phase | Replaces | lib path | Admin route |
|---|---|---|---|
| 1 — Indexer Aggregation | Prowlarr | `src/lib/indexer/` | `/admin/indexers` |
| 2 — Download Automation | Sonarr + Radarr | `src/lib/automation/` | `/admin/automation` |
| 3 — Request Bridge | Seerr→*arr link | `src/lib/automation/bridge.ts` | `/admin/automation/bridge` |
| 4 — Subtitle Management | Bazarr | `src/lib/subtitle/` | `/admin/subtitles` |
| 5 — Media Server | Jellyfin | `src/lib/media-server/` | `/admin/media-server` |
| 6 — Browse/Watch wired to native media server | Jellyfin browse/watch UX | — | — |
| 7 — Native Request Management | Seerr requests | `src/lib/requests/` | `/admin/requests` |

### Admin nav

Overview → User Monitoring → User Management → Invites → Requests → Watch Activity → Audit Log → Server Status → **Indexers** → **Automation** → **Request Bridge** → **Subtitles** → **Media Server** → **Quality Profiles** → **Settings**

### Independence build env vars

| Variable | Phase | Required | Purpose |
|---|---|---|---|
| `JELLYFIN_USER_ID` | 3 | Yes | Admin user UUID — `GET /Users/Me` → `Id` field |
| `SEERR_WEBHOOK_SECRET` | 3 | Optional | Verifies `X-Webhook-Signature` on webhook POSTs |
| `OPENSUBTITLES_API_KEY` | 4 | Yes | OpenSubtitles v3 **static API key** from the Consumers page (not the JWT) |
| `OPENSUBTITLES_USERNAME` | 4 | For VIP | Account username — required to reach the VIP 1000/day quota (see below) |
| `OPENSUBTITLES_PASSWORD` | 4 | For VIP | Account password — the client mints its own JWT via `POST /login` |
| `SUBTITLE_LANGUAGES` | 4 | Optional | Comma-separated codes, default `en` |
| `SUBTITLE_MEDIA_ROOT` | 4 | Optional | Container path to media; required for .srt disk writes |
| `TMDB_ACCESS_TOKEN` | 5 | Yes | TMDB API v3 Bearer token |
| `MEDIA_ROOTS` | 5 | Yes | Colon-separated container paths to scan (e.g. `/media/movies:/media/tv`) |
| `TRANSCODE_CACHE` | 5 | Optional | HLS segment temp dir; default `/tmp/transcode` |

### Seerr webhook (Phase 3)

Configure Seerr → Settings → Notifications → Webhook → URL: `https://unified.minijoe.dev/api/seerr/webhook`. Enable `Request Approved` + `Media Available`. Set secret in both Seerr and `SEERR_WEBHOOK_SECRET` env var.

`/api/seerr/webhook` is implemented and receives `MEDIA_APPROVED`, `REQUEST_APPROVED`, and `MEDIA_AVAILABLE` events.

---

## 15. Two-Mode Request System (v0.9.0+)

Every media request is either **Quick** or **Long-term**. The mode is stored in `media_requests.request_type`.

### Quick requests

- Only available for content released before the current calendar year (`year < currentYear`)
- Auto-approved immediately on creation — no admin action required
- Added to `monitored_items` automatically (triggers the grab loop)
- Slot-limited: **1 active movie** or **2 active TV shows** per user at once (status `approved` or `available`)
- Once the media becomes available in the library, `auto_delete_at` is set to 48 hours from now
- The hourly auto-delete cron removes the media files and marks the request `expired`, freeing the slot
- If the Quick slot limit is full when the request is submitted, the request row is deleted and the API returns `429`

### Long-term requests

- Available for any content (old or new)
- Require manual admin approval — status stays `pending` until an admin approves or declines
- Never auto-deleted — content stays until the admin or user explicitly deletes the request
- No slot limit

### UI

The `RequestOptions` component at `src/components/media/RequestOptions.tsx` handles the user-facing choice:
- **Old content** (year < currentYear): shows two buttons — "Quick (48h)" and "Long-term"
- **New content** (current year or future): shows a single "Request" button (Long-term only)
- Shows the appropriate status badge with a type label ("Quick (48h auto-delete)" / "Long-term") for already-requested items

### Key files

| File | Role |
|---|---|
| `src/lib/requests/types.ts` | `RequestType = 'quick' \| 'longterm'`; `NativeRequest` interface |
| `src/lib/requests/auto-approve.ts` | `tryAutoApprove()` — gates on `request_type === 'quick'` AND `request_method === 'auto-pick'`, year check, slot check |
| `src/lib/automation/availability.ts` | Sets `auto_delete_at` only for quick requests when they become available |
| `src/lib/automation/auto-delete.ts` | Hourly cron: deletes media files + marks expired when `auto_delete_at <= now` |
| `src/app/api/requests/route.ts` | POST accepts `requestType`; returns 429 for failed quick requests |
| `src/components/media/RequestOptions.tsx` | Two-button or single-button request UI |

**`request_method` gate:** `tryAutoApprove()` returns false for any request where `request_method !== 'auto-pick'`. A quick request submitted via `TorrentPickModal` (where the user hand-selected a specific release) has `request_method = 'interactive'` and is NOT auto-approved — it goes to the admin queue regardless of year, slot availability, or any other condition. Only system-selected (`auto-pick`) quick requests are auto-approved.

### Slot limits

| Media type | Max concurrent quick slots |
|---|---|
| Movie | 1 |
| TV show | 2 |

Counted as: requests with `request_type = 'quick'` AND `status IN ('approved', 'available')` for the user.

---

## 16. Party Play (Watch Together) and Chat (v0.9.5)

Native watch-together built on top of the finished player. A party is a shared viewing session for one
media item where every member's player is kept in sync. Anyone in the party can play, pause, or seek and
everyone follows. v1 ships sync, presence, text chat, and ephemeral emoji reactions, all over one socket.
The server is the single authority on party state; clients send intents and render whatever the server
broadcasts back. **Party play coordinates the existing player only — it does not touch transcode, codec,
audio-track, or subtitle behavior, and `position_ticks` remains the single source of truth for progress.**

### Architecture — dedicated WebSocket server on port 3002

The Next.js instrumentation hook **cannot** attach to the Next standalone HTTP server's `upgrade` event
(verified against next 16.2.7: the `http.Server` is function-local in `start-server.js`, never handed to
`register()`, and Next installs its own `upgrade` handler that destroys unrecognised upgrades). So party
play runs a **dedicated `ws` server on its own internal port 3002**, started from `src/instrumentation.ts`
behind a `globalThis`-pinned started guard, in the **same process** as the Next route handlers and the
existing schedulers. That shared process is why the `globalThis`-pinned `PartyStateStore` singleton is
visible to both the WS server and the `/api/party` REST routes. The Docker `CMD` stays `node server.js`.

Public-edge routing. The browser connects same-origin to `wss://unified.minijoe.dev/api/party/ws`. The
live Caddy block routes that path to 3002, everything else to 3001:

```caddyfile
http://unified.minijoe.dev {
    import compressed
    @partyws path /api/party/ws*
    reverse_proxy @partyws unified-frontend:3002
    reverse_proxy unified-frontend:3001
}
```

Caddy upgrades WebSockets automatically (forwards `Upgrade`/`Connection`). **No compose change is needed**:
the service has no host port mapping for 3001 either — Caddy reaches both ports by container DNS over the
compose network (`unified-frontend:3001` / `:3002`). The WS server listens on `0.0.0.0:3002` inside the
container. Dev has no Caddy, so the client connects directly to `ws://<hostname>:3002/api/party/ws` while
the page is served from `:3001` (cookies are not port-scoped, so `unified-session` is still sent).

`next.config.ts` CSP `connect-src` was widened to
`'self' http://ip-api.com wss://unified.minijoe.dev ws://localhost:3002`.

### Data model — durable (SQLite) vs ephemeral (memory)

Durable facts only persist to SQLite; live high-frequency state lives in memory to keep the heartbeat storm
off the single SQLite writer. Two new tables (migration in `src/lib/db/migrations.ts`, idempotent style):

| Table | Key columns |
|---|---|
| `watch_parties` | `id` (32-char), `join_code` (UNIQUE 6-char), `host_user_id`, `media_id`, `status` ('active'\|'ended'), `last_position_ticks`, `last_paused` (checkpoints, recovery only) |
| `watch_party_members` | `party_id`, `user_id`, `joined_at`, `left_at`, `is_host`, `UNIQUE(party_id, user_id)` (makes join idempotent — rejoin reactivates the row) |

`media_id` must reference a **playable** `media_items` row (non-NULL `file_path`); series containers are
rejected at create time. Checkpoints write at most every `CHECKPOINT_THROTTLE_MS` (12s) and on
pause/seek/join — never per heartbeat. Live authoritative state (current position, paused, rate, per-member
heartbeat/readiness, chat ring buffer) lives in the WS process behind `PartyStateStore`.

### The PartyStateStore scale seam

`src/lib/party/state-store.ts` defines the `PartyStateStore` interface and `getPartyStore()` (singleton
pinned on `globalThis`). `src/lib/party/in-memory-store.ts` is the **v1 single-instance** implementation
(a `Map` + per-party `EventEmitter`, chat ring buffer, a per-party promise-chain lock so `updateParty`
mutations are serialized atomically). This interface is the **horizontal-scale boundary**: to run multiple
instances later, swap the in-memory backing for Redis pub/sub or Postgres LISTEN/NOTIFY (subscribe becomes
a subscription, updateParty publishes) without touching any other party code. Do not build that in v1.
Reactions deliberately have no store method — they are fire-and-forget with no backlog.

### Files

| File | Role |
|---|---|
| `src/lib/party/constants.ts` | All timing/tolerance constants (single source of truth) + the 8-emoji reaction set |
| `src/lib/party/types.ts` | Protocol contract — every client/server message, live + durable shapes (client-safe, type-only) |
| `src/lib/party/state-store.ts` | `PartyStateStore` interface + `getPartyStore()` singleton accessor |
| `src/lib/party/in-memory-store.ts` | `InMemoryPartyStateStore` (the scale seam's v1 backing) |
| `src/lib/party/position.ts` | `extrapolatePosition`, `medianReportedPositionTicks`, tick↔seconds helpers |
| `src/lib/party/session.ts` | WS-upgrade auth: `parseSessionCookie`, `lookupPartySession` (extracted session lookup, no rotation) |
| `src/lib/party/db.ts` | Durable query layer (create/join/leave/end, members, `checkpointParty`, `loadActiveParties`) |
| `src/lib/party/server.ts` | `initPartyServer()` — the WS server + full command pipeline + drift + grace + cleanup |
| `src/lib/party/events.ts` | `globalThis`-pinned `partyEvents` emitter — bridges store `endParty()` → WS `party_ended` |
| `src/lib/party/socket-url.ts` | `getPartySocketUrl()` — dev `:3002` vs prod same-origin `wss` |
| `src/lib/party/client.ts` | Client REST wrappers (create/join/info/leave/end) |
| `src/hooks/usePartySync.ts` | The client hook — reconnecting socket, clock offset, state apply, drift, chat/reactions |
| `src/components/party/*` | `PartyPanel`, `ChatPanel`, `ReactionOverlay`, `ReactionBar`, `StartPartyButton`, `JoinByCodeModal` |
| `src/app/api/party/**` | REST lifecycle: `POST /api/party`, `/join`, `GET`+`DELETE /[partyId]`, `POST /[partyId]/leave` |

No new env vars. `NEXT_PUBLIC_APP_URL` is reused to build the join link.

### REST lifecycle (rate-limited via `checkRateLimit`)

- `POST /api/party` — `requireAuth`, body `{mediaId}`, validates playable item, generates id + unique 6-char
  `joinCode`, inserts party + host member, seeds the live store. Returns `{partyId, joinCode, joinUrl}`
  where `joinUrl = ${NEXT_PUBLIC_APP_URL}/play/${mediaId}?party=${joinCode}`. Limit 10/hour/user.
- `POST /api/party/join` — body `{joinCode}` or `{partyId}`, upserts/reactivates membership, ensures live
  state exists. Returns `{partyId, mediaId, joinCode}`. Limit 30/hour/user.
- `GET /api/party/[partyId]` — `requireAuth` + membership; returns durable info + member list.
- `POST /api/party/[partyId]/leave` — marks `left_at`; **last member out ends the party** (host leaving
  does NOT — control is shared).
- `DELETE /api/party/[partyId]` — host only; ends the party. The shared in-process store fans `party_ended`.

### WebSocket protocol and the server-authority pipeline

All messages are JSON. Every client message carries `{type, partyId}` and is membership-checked **per
message** (a valid session that is not a member is rejected — the endpoint is public). Client→server:
`join`, `control{action,positionTicks,clientTime}`, `heartbeat`, `ready`, `ping`, `chat`, `reaction`,
`leave`. Server→client: `state` (full authoritative snapshot), `reseek`, `waiting`, `chat`,
`chat_backlog`, `reaction`, `pong`, `party_ended`, `error`.

The **pause-war fix**: every `control` runs through one serialized per-party path (`updateParty`). Each
applied command stamps a monotonically increasing `commandSeq` (arbitrates which command wins) and an
`effectiveAt` absolute server timestamp (schedules when the winning transition fires on every client).
`effectiveAt` layers on `commandSeq`, it does not replace it. Lead times are asymmetric: `PLAY_LEAD_MS`
(1000) so transcoding clients can pre-buffer, `CONTROL_LEAD_MS` (300) for pause/seek. The server never
echoes a client's command back as a command — it applies it and broadcasts the resulting state to everyone
including the originator. Clients translate `effectiveAt` to local time through a smoothed clock offset
(`CLOCK_OFFSET_EMA_ALPHA` 0.4) computed from `ping`/`pong`. A periodic keepalive `state` every
`KEEPALIVE_STATE_BROADCAST_MS` (10s) corrects drift even absent commands (its `effectiveAt` equals
`serverTime` — "reconcile now").

**Readiness gate** (cross-device fix). A play is held until all CONNECTED members report `ready=true`, or
released after `READINESS_GATE_MAX_WAIT_MS` (20s) — whichever first; while held, a `waiting` broadcast lists
who is still buffering. The gate timeout fires from the server's periodic tick checking `pendingPlay`.

**Drift bands** (single source of truth, in `constants.ts`): below `SEEK_DEADBAND_S` (0.25s) do nothing;
from 0.25s up to `DRIFT_HARD_RESEEK_S` (1.5s) the **client** absorbs it with a `video.playbackRate` nudge
clamped to `[0.90, 1.10]`; at/above 1.5s the server sends that one client a targeted `reseek`. During
`POST_JOIN_SETTLE_MS` (8s) after join/reconnect the hard reseek is suppressed (nudge only) so a slow
transcode start is not punished. With >2 connected members the **median** of reported positions sets the
room timeline (one laggard never stalls everyone); a member beyond `MEDIAN_OUTLIER_RESEEK_S` (1.5s) off the
median gets a reseek. The monotonic high-water-mark guard means a lagging heartbeat never drags the room
backward — authoritative position moves only through applied commands and median reconciliation.

### Resilience

Application heartbeat every `HEARTBEAT_INTERVAL_MS` (5s) + ws protocol ping every `WS_PING_INTERVAL_MS`
(20s); a socket missing `WS_PONG_MISS_LIMIT` (2) pongs is dropped. The client wraps its socket in a
reconnecting wrapper (backoff immediate/1s/2s/5s) and on reconnect re-`join`s and adopts the full snapshot
wholesale. A dropped member sits in `'grace'` for `DISCONNECT_GRACE_MS` (30s) before eviction, so a
backgrounded tab / phone lock / cellular blip does not eject anyone. A party with zero connected members
ends after `EMPTY_PARTY_IDLE_END_MS` (60s). On boot, `loadActiveParties()` rehydrates `status='active'`
parties from their checkpoints so a restart does not destroy in-progress parties.

### Chat and reactions

Both ride the same socket, authorized by the same per-message membership check. **Chat** is ephemeral but
the server keeps a `CHAT_RING_BUFFER_SIZE` (50) in-memory backlog per party, sent as `chat_backlog` on join
so a late joiner sees recent context. Sender name, `ts`, and `id` are all stamped **server-side**; the
client supplies only `text`. Nothing is written to SQLite. **Reactions** (fixed eight: 😂 ❤️ 😮 😢 👍 🔥 🎉 👏)
are fire-and-forget with no backlog — a reaction that arrives after you do is simply not shown.

### Client integration — the three action origins (the critical correctness rule)

`usePartySync(partyId, {videoRef, selfUserId, enabled})` layers onto the existing `VideoPlayer` as a hook;
the player is not rewritten. Every play/pause/seek the player observes has one of three origins and they are
handled differently:

1. **Remote-applied** (the hook moving the player from a `state`/`reseek` message) — done inside an
   `applyingRemoteStateRef`; the `<video>` element's own `onPlay`/`onPause`/`seeked` side-effects must not
   send intents back. Prevents the echo loop.
2. **Player-emitted** (the `<video>` firing pause or a backward micro-seek while buffering/transcoding) —
   NOT user intent, must NOT become commands. Achieved structurally: intents are never derived from element
   events; those only update local UI.
3. **Genuine user action** (the local user clicking play, pressing a shortcut, releasing the scrubber) —
   ONLY these become `control` intents.

In party mode the hook intercepts the user-action surfaces (`togglePlay`, the keyboard handlers via a
`partyKbdRef`, the scrubber commit `handleSeek`) so they call `party.sendIntent(action, positionTicks)`
instead of mutating the video. The video moves only when the resulting server `state` arrives, routed
through the `applyingRemoteState` path. The server thus **never receives** the spurious buffering events
rather than having to filter them. The server-side debounce and high-water guard remain only as a backstop.
All party UI and rerouting is gated behind `partyId` truthiness, so non-party playback is unchanged.

Entry points: on `/play/[id]`, `?party={joinCode}` auto-joins on load (`POST /api/party/join` then connect
the socket); a "Start watch party" button (`StartPartyButton`) creates a party for the current item; a
"Join with code" modal handles manual entry.

### Deploy and the mandated edge test

Caddy route applied and reloaded (section above). To ship the code, rebuild via compose (never bare
`docker build`):

```bash
docker compose build --no-cache unified-frontend
docker compose up -d --force-recreate unified-frontend
```

After deploy, the spec **requires** an edge test: connect from an off-tailnet (cellular) client through the
full BunkerWeb → CrowdSec → Caddy path and confirm the upgrade completes and the socket survives at least
two minutes idle. The 5s heartbeat + 20s ws ping keep the socket under any typical 60s idle reap. **If
BunkerWeb still reaps it**, add a WebSocket-aware per-domain exception for `/api/party/ws` in
`/opt/docker/compose/edge/docker-compose.yml`, in the same style as the existing `unified.minijoe.dev_*`
overrides (raise the reverse-proxy read timeout for that path or exempt it from idle close); confirm the
exact BunkerWeb variable against the running config first. Tailnet clients do not hit this.

### Audit and remediation (v0.9.5)

A full 10-domain code audit of this feature is recorded in `PARTY_PLAY_AUDIT.md` at the repo root, and
**all of its Critical/High/Medium/Low findings have since been fixed** (one round, 10 agents, one file
group each). What was hardened:

- **Input validation.** Every inbound WS field (`positionTicks`, `action`, `text`, `playbackRate`,
  `clientTime`, `partyId`) is validated; positions are clamped to `[0, MAX_POSITION_TICKS]`, `action` is
  allowlisted, oversized frames are rejected (`maxPayload`).
- **Sync correctness.** `reconcileDrift` is now forward-only (the high-water-mark guard holds), drift is
  measured against forward-projected member reports (no phantom drift), the readiness-gate deadline is
  preserved across repeated play presses, and the debounce runs inside the per-party lock.
- **Edge security.** WS upgrade checks `Origin` (`allowedWsOrigins()`), live sockets are re-authorized
  every `SESSION_RECHECK_INTERVAL_MS` (rejecting expired/suspended/`force_pw_change` sessions),
  per-socket per-type rate limiting and per-user/per-party/global resource caps are enforced, and an
  established socket must be a live member on that exact socket (durable fallback only at the `join`
  claim step). REST routes call `verifyOrigin`; join failures are rate-limited; GET returns 404 (not
  403) to non-members.
- **Client robustness.** The `reseek` timer is tracked/cleared, the two-phase late-join second seek is
  implemented, the reconnect counter only resets once a connection proves stable, the heartbeat reports
  the room rate (not the transient nudge), the rate-nudge restores promptly, reaction ids use
  `crypto.randomUUID()`, and the pong RTT is sanity-clamped.
- **Durable + UI.** Atomic last-member-out leave (`leaveAndMaybeEnd`), real FK constraints on fresh DBs,
  copy-link fallback with visible error, chat auto-scroll only when near the bottom, and reaction-timer
  reconciliation.

The new tuning constants (caps, rate-limit windows, `MAX_POSITION_TICKS`, origin allowlist) live in
`src/lib/party/constants.ts`. One item is intentionally deferred: an explicit Caddy idle timeout for
`/api/party/ws` (audit L5) — the heartbeat/ping is the primary keepalive, and the BunkerWeb idle-reap
exception is added only if the mandated off-tailnet cellular idle test shows reaping.

### Shared queue with auto-advance (v0.10.0)

Party Play has a shared **"up next" queue**. Any member may add / remove / reorder items and skip to
the next one — consistent with the existing shared-control model (no host-only gate). When the current
item ends, the party **auto-advances**: every member's player navigates to the next item with zero clicks
(binge a whole season). Items are playable `media_items` only (series containers rejected, same rule as
party create).

- **Durable + live.** The queue lives in `PartyLiveState.queue` (the in-memory authority, mutated through
  the atomic `updateParty`) and is mirrored to the `watch_party_queue` SQLite table on every mutation
  (queue ops are infrequent, so a delete+reinsert keeps positions gap-free). `rehydrate()` reloads it on
  boot via `loadQueue()`, so a restart preserves "up next".
- **Protocol.** Client→server: `queue_add{mediaId,title?}`, `queue_remove{itemId}`,
  `queue_reorder{itemId,toIndex}`, `queue_advance{fromMediaId}`. Server→client: `queue{items}` (full
  snapshot on join + after every mutation) and `queue_advance{mediaId,joinCode,items}` (navigate
  everyone). All are membership-checked per message and field-validated like every other WS message;
  `MAX_QUEUE_LENGTH=200`.
- **Advance is idempotent.** `queue_advance` carries `fromMediaId`; the server advances only if it still
  equals the party's current `mediaId`. The client fires `queue_advance` on the `<video>` `ended` event
  (and from the "Play next" button), so when every member's video ends near-simultaneously the first
  request wins and the rest are no-ops referencing the now-stale media id. On advance the server shifts
  the queue head, sets the new `mediaId`, resets position to 0, sets `paused=false` (the client's
  `applyState` auto-plays once buffered — permitted because the document already had user interaction
  before the client-side nav), bumps `commandSeq`, and clears every member's `ready`.
- **The navigation race (important).** On auto-advance every client `router.push`es to
  `/play/${nextMediaId}?party=${joinCode}`, which unmounts the old `VideoPlayer` and remounts on the new
  route. `usePartySync`'s cleanup normally sends an explicit `leave` on unmount — but that would risk
  last-member-out (`leaveAndMaybeEnd`) ending the party while everyone is mid-navigation. So the
  `queue_advance` handler raises `suppressLeaveRef` and the cleanup **skips the leave**, letting the
  socket close fall into the 30s disconnect grace window; the re-join on the next item reactivates the
  member (its durable `left_at` stayed NULL). The party never hits zero active members during a transition.
- **Files.** `QueueItem`/DTO + messages in `party/types.ts`; queue field in `PartyLiveState`
  (`in-memory-store.ts` inits `queue:[]`); durable helpers `persistQueue`/`loadQueue`/`getPlayableMedia`/
  `setPartyMedia` in `party/db.ts`; server handlers `handleQueueAdd/Remove/Reorder/Advance` +
  `broadcastQueue` in `party/server.ts`; client state/ops (`queue`, `addToQueue`, `removeFromQueue`,
  `reorderQueue`, `playNext`, `onQueueAdvance`) in `usePartySync.ts`; UI in `party/PartyPanel.tsx`
  (the "Up next" list with per-item move-up/down reorder controls (v0.10.2) + remove + Play next, plus a
  library-search `QueueAdder`).

---

## 17. Decision Engine — Gate-Chain + Custom Formats (v0.10.0)

Two-stage release evaluation in the grabber, mirroring Sonarr/Radarr: **hard gates** decide what is
grabbable at all, then a **soft score** ranks what survives. The auto-pick path never grabs a gated
release; the interactive admin picker still lists gated releases (with reasons) and can override-grab them.

### Hard gates (`src/lib/automation/gates.ts`)

`evaluateGates(result, config, blocked)` returns the list of reasons a release failed (empty = passed):

| Gate | Reason | Rule |
|---|---|---|
| Blocklist | `blocklisted` | `info_hash` is in `grab_blocklist` |
| Seed floor | `dead` | `seeders < gate_min_seeders` (default 1) |
| Sample | `sample` | title matches a whole-token `sample` |
| Size cap | `oversize` | `size > gate_max_size_*_gb` (movie default 100, tv 200; 0 disables) |

Thresholds are `app_settings` keys read each search (no redeploy): `gate_min_seeders`,
`gate_max_size_movie_gb`, `gate_max_size_tv_gb`, **editable in the UI at `/admin/automation` → "Grab
Gates"** (v0.10.2; via `GET`/`PUT /api/admin/settings`; 0 on a max-size disables that cap).
`partitionByGates(results, type)` splits scope-matched
results into `passing` + `gatesByKey`; `findBestRelease(passing, …)` auto-picks from the passing pool only.
The pack finders (`findSeasonPack`/`findArcPack`/`findCoveringPacks`) are gate-aware too.

**Blocklist.** `grab_blocklist` (keyed by lowercased `info_hash`) is auto-populated by the metadata
**reaper** (a dead stuck torrent whose indexer-claimed seeders never materialised is blocklisted so the
cron won't re-grab it) and managed by admins via `GET/POST/DELETE /api/automation/blocklist`
(requireAdmin + verifyOrigin), **surfaced in the UI at `/admin/automation` → "Blocklist"** (v0.10.2;
list + remove/unblock + manual block-by-hash form).

**Rejection reasons surface in the UI.** `ScoredCandidate.gates` is persisted in `grab_results`;
`/api/torrent-search` returns per-result `gates`; `SeasonGrabControl` renders them as amber badges
("why didn't this download") while keeping the row grab-able (it's the override surface). A search that
gates out every candidate records `SkipReason` `'gated'` (or `'no_seeders'` when the only failure was the
seed floor).

### Real custom formats (`src/lib/automation/quality.ts`)

`CustomFormatSpec.type` now covers `title_regex | resolution | source | codec | language | release_group |
size | flag`:

- **language** — ISO 639-1 parsed from the title (`meta.language`).
- **release_group** — exact scene-group match (`meta.group`).
- **size** — GB range `min-max` / `min-` / `-max` (needs the release size, threaded through
  `scoreWithProfile(title, profileId, sizeBytes)` from `autoPickScore`).
- **flag** — a named release flag (`proper`/`repack`/`internal`/`remux`/`hdr`/`hdr10plus`/`dv`/`atmos`/
  `imax`/…); unknown keys fall back to a word-boundary match. `CUSTOM_FORMAT_FLAGS` exports the known keys.

Custom formats are scored within `autoPickScore` (`scoreWithProfile(...).totalScore`) and are
created/assigned with per-profile scores on the existing `/admin/quality-profiles` page (the
`CustomFormatBuilder` now offers the new spec types with per-type value hints). The `quality_profile_formats`
score table and the matcher were already scaffolded; this activates the fuller matcher.
