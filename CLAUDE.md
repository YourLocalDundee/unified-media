# unified-frontend

A single-pane-of-glass web app for the minime home server media stack. Replaces the multi-tab workflow
(Jellyfin + Seerr + qBittorrent) with one unified interface for browsing, requesting, watching, and
monitoring downloads.

---

## 1. Project Overview

### What this is

A Next.js 14+ web app that acts as a **UX aggregation layer** on top of three existing services:

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
| `src/lib/db/migrations.ts` | Schema for users, sessions, invite_codes, audit_log, watch_events, login_attempts, pending_registrations |
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

**Registration (two-step, v0.5.3+):** Open enrollment with email verification. Rate-limited to 10 attempts per 15 minutes per IP.

1. `POST /api/auth/register` validates all fields (username, email, password, and demographics: first_name, last_name, location, bio). On success it creates a `pending_registrations` DB record containing a 6-digit code with a 10-minute TTL and sends the code via `src/lib/email.ts`. It returns `{ pendingId }` — no user or session is created yet.
2. `POST /api/auth/verify-email` accepts `{ pendingId, code }`. On correct code it creates the user + session. Maximum 5 incorrect attempts before the pending record is deleted. Code expires after 10 minutes regardless.

The register page UI is two-step: Step 1 collects account info and demographics; Step 2 shows the 6-digit code entry form.

The `/admin/invites` system still exists for admin use but is no longer enforced at registration. The `/invite/{code}` route still functions for direct links.

**Demographics fields (v0.5.3+):** The `users` table has four optional profile columns: `first_name`, `last_name`, `bio`, `location`. These are collected at registration (Step 1 of the two-step flow; bio and location are optional) and editable post-registration via `PATCH /api/auth/profile/demographics` on the `/settings/profile` "About Me" section.

**Admin seeding:** On first `getDb()` call with an empty users table, `seedAdmin()` reads
`ADMIN_USERNAME` and `ADMIN_PASSWORD` from env and creates the admin account. If either is missing,
the process exits with an error — do not start the container without these set.

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
  Store credentials as `QBT_USERNAME` and `QBT_PASSWORD` env vars.
- **CORS / proxy requirement:** All qBittorrent calls must go through Next.js API routes
  (`/api/qbt/...`). The session cookie (`SID`) is held server-side. Never expose qBt credentials
  or cookies to the browser.

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

- **Internal URL:** `http://192.168.0.50:8989` (host network container — use host IP, not container name)
- **API:** REST; auth header `X-Api-Key: <SONARR_API_KEY>`
- **Proxy route:** `/api/sonarr/[...path]`
- **Env vars:** `SONARR_URL`, `SONARR_API_KEY`
- **Used for:** series monitoring status on media detail pages

### Radarr

- **Internal URL:** `http://192.168.0.50:7878` (host network container — use host IP, not container name)
- **API:** REST; auth header `X-Api-Key: <RADARR_API_KEY>`
- **Proxy route:** `/api/radarr/[...path]`
- **Env vars:** `RADARR_URL`, `RADARR_API_KEY`
- **Used for:** movie monitoring status on media detail pages

### Prowlarr

- **Internal URL:** `http://192.168.0.50:9696` (host network container — use host IP, not container name)
- **API:** REST; auth header `X-Api-Key: <PROWLARR_API_KEY>`
- **Proxy route:** `/api/prowlarr/[...path]`
- **Env vars:** `PROWLARR_URL`, `PROWLARR_API_KEY`
- **Used for:** indexer status and search

### Bazarr

- **Internal URL:** `http://192.168.0.50:6767` (host network container — use host IP, not container name)
- **API:** REST; auth header `X-Api-Key: <BAZARR_API_KEY>`
- **Proxy route:** `/api/bazarr/[...path]`
- **Env vars:** `BAZARR_URL`, `BAZARR_API_KEY`
- **Used for:** subtitle management

### Download Client Registry

Client selection is abstracted behind `src/lib/download-client/`:

| File | Status |
|---|---|
| `registry.ts` | Selects active client from `DOWNLOAD_CLIENT` env var |
| `qbittorrent.ts` | Fully implemented (primary client) |
| `transmission.ts` | Stub — not yet implemented |
| `deluge.ts` | Stub — not yet implemented |
| `types.ts` | Shared type definitions |

---

## 4. Tech Stack Decision

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js 14+ App Router (TypeScript) | Matches Seerr's stack; server components solve CORS and auth header forwarding cleanly |
| Styling | Tailwind CSS + shadcn/ui | Fast to build, accessible, no design system to maintain |
| Server state | TanStack Query (React Query) | Caching, background refetch, loading/error states; ideal for live download queue polling |
| Client state | Zustand | Lightweight; manages selected media item, player open/closed, sidebar state |
| Jellyfin API | `@jellyfin/sdk` | Official TypeScript SDK, typed responses, handles auth headers |
| qBittorrent API | Direct fetch via Next.js API routes | No official SDK; the VueTorrent source (`QbitProvider.ts`) is the reference implementation |
| Seerr API | Direct fetch with typed wrappers | Seerr exposes a clean REST API; API spec at `seerr-api.yml` in the source |
| Package manager | npm (or pnpm) | Use pnpm if using pnpm workspaces; npm otherwise |
| Linting | ESLint + Prettier | Standard Next.js config |

### Key package versions (match Seerr where possible)

- `next`: 15+ (App Router stable)
- `react` / `react-dom`: 19+
- `typescript`: 5.4+
- `tailwindcss`: 3.4+
- `@tanstack/react-query`: 5+
- `zustand`: 5+
- `@jellyfin/sdk`: latest unstable or stable release

---

## 5. Page / Feature Map

```
app/
  app/
    layout.tsx                  # Root layout: nav sidebar, auth header injection
    page.tsx                    # / → Home dashboard
    browse/
      page.tsx                  # /browse → Library browser
      [id]/
        page.tsx                # /browse/[id] → Media detail
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
      seerr/[...path]/
        route.ts                # Proxy to Seerr (API key injection)
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
- Continue Watching row (Jellyfin `/Users/<id>/Items/Resume`)
- Recently Added row (Jellyfin `/Users/<id>/Items/Latest`)
- Recent Requests strip (Seerr `GET /request?take=5`)
- Download queue summary (qBt `GET /transfer/info` + active torrents count)
- Auto-refreshes download summary every 10 seconds via React Query `refetchInterval`

**`/browse` — Library browser**
- Library selector (Movies / TV Shows / Music) from Jellyfin user views
- Grid of poster cards with title, year, duration
- Filter by genre, sort by name/date/rating
- Infinite scroll or paginated `GET /Users/<id>/Items`
- Search box that routes to `/search`

**`/browse/[id]` — Media detail**
- Jellyfin item detail: poster, backdrop, synopsis, metadata
- Watch button → embedded Jellyfin video player (if `CanDirectPlay` or transcoding available)
- Request button (if item is NOT in Jellyfin) → calls Seerr `POST /request`
- Request status badge (if already requested) from Seerr `GET /media` cross-referenced by TMDB ID
- Related content row

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
  - Env: `SEERR_API_KEY`, `JELLYFIN_API_KEY`, `QBT_USERNAME`, `QBT_PASSWORD`
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
- Image proxy: create `app/api/jellyfin-image/[itemId]/route.ts` to serve images with auth
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

qBittorrent's Web API uses cookie-based sessions, not API keys. The `SID` cookie must be obtained
by POSTing credentials to `/api/v2/auth/login`. All subsequent requests must include the
`Cookie: SID=<value>` header. This entire flow must stay server-side in Next.js API routes.
On a 403 response, re-authenticate and retry once.

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

**Critical:** Do not start the container without `ADMIN_USERNAME`, `ADMIN_PASSWORD`, and `DB_PATH`
set in the environment. The first call to `getDb()` will `process.exit(1)` if the users table is
empty and these vars are absent.

**Docker volume:** The SQLite DB lives at `/data/unified.db` inside the container. The compose
file mounts the named volume `unified-db:/data`. Never delete this volume without a backup.

### Middleware file naming

Next.js middleware must be in `src/middleware.ts` (for src-dir projects) and must `export function middleware(...)`. Any other filename (e.g. `src/proxy.ts`) or export name is silently ignored — Next.js will not register the middleware and the manifest will be empty. After correcting the name and export and rebuilding, the manifest shows the middleware registered at `/`.

### Stale session cookie loop

`getSession()` in `src/lib/dal.ts` must delete the session cookie before returning null when it finds no matching DB row. If the cookie is left in place on a stale/expired session, the result is an infinite redirect: unauthenticated route → `requireAuth` fails → redirect `/login` → middleware sees cookie → redirect `/` → repeat. The fix is to call `cookieStore.delete(SESSION_COOKIE)` before every `return null` path where a stale cookie was detected.

### Next.js 15: cookie mutations throw in Server Component context

`cookies().set()` and `cookies().delete()` (from `next/headers`) throw `"Cookies can only be modified in a Server Action or Route Handler"` when called during a Server Component render. `getSession()` is invoked from Server Components via `requireAuth()`, so any cookie mutation inside it (session deletion on expiry, 24h rotation set) must be wrapped in `try { ... } catch { /* server component context — no-op */ }`. In Route Handler context the mutations succeed as before. Without this guard, users with expired sessions or sessions past the 24h rotation window get a 500 on every page load: middleware passes them through (cookie present), the page calls `requireAuth()` → `getSession()`, and the bare `cookieStore.delete()` / `cookieStore.set()` throws. All three cookie mutation sites in `src/lib/dal.ts` are already wrapped.

### SMTP for email verification (v0.5.3+)

Email verification on registration uses `src/lib/email.ts` (nodemailer). The following env vars are all optional:

| Variable | Purpose | Default |
|---|---|---|
| `SMTP_HOST` | SMTP server hostname (e.g. `smtp.gmail.com`) | — |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username / email | — |
| `SMTP_PASS` | SMTP password or app password | — |
| `SMTP_FROM` | From address for outgoing emails | — |

**Dev fallback:** If any of `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` are not set, `email.ts` does not attempt a real send. The 6-digit verification code is printed to stdout instead, visible via `docker logs unified-frontend`. This is safe in a dev/LAN context where email delivery is not required.

### BunkerWeb WAF / ModSecurity CRS

BunkerWeb runs ModSecurity CRS in front of Caddy. Avoid:

- Large JSON responses containing patterns that match SQLi/XSS rules (unlikely with media data)
- Inline `<script>` tags containing dynamic content in server-rendered HTML
- Query strings with characters like `<`, `>`, `'` unencoded — always encode search terms
- Excessively large request bodies on API routes; set explicit `Content-Type` headers

If a legitimate request is blocked, check BunkerWeb logs and add a CRS exclusion rule rather
than disabling WAF rules globally.

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

### *arr services network_mode: host

All *arr services (Sonarr, Radarr, Prowlarr, Bazarr) run with `network_mode: host` — use the host IP `192.168.0.50`, not container names. Transmission and Deluge download clients exist as stubs in `src/lib/download-client/` but are not yet implemented.

### Seerr API key auth

Seerr checks the `X-API-Key` request header against `settings.main.apiKey`. If the key matches,
the request runs as the admin user (ID 1) by default, or as a specific user if `X-API-User: <id>`
is also provided. Keep the key in `SEERR_API_KEY` env var; never hardcode it.

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

# qBittorrent
QBIT_URL=http://192.168.0.50:8080
QBIT_USERNAME=<qbt username>
QBIT_PASSWORD=<qbt password>

# *arr services (host network — must use IP, not container name)
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

# SMTP — all optional; if unset, verification codes print to stdout (docker logs)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
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
FROM node:22-slim AS builder
WORKDIR /app
# build tools needed for better-sqlite3 native compilation
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runner
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

**Note:** Use `node:22-slim` (Debian), NOT Alpine. `better-sqlite3` downloads a glibc-linked
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
      - QBT_URL=http://qbittorrent:8080
      - QBT_USERNAME=${UNIFIED_QBT_USERNAME}
      - QBT_PASSWORD=${UNIFIED_QBT_PASSWORD}
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
| Main page | `src/app/downloads/page.tsx` |
| Filter sidebar | `src/app/downloads/components/FilterSidebar.tsx` |
| Torrent row | `src/app/downloads/components/TorrentRow.tsx` |
| Detail panel | `src/app/downloads/components/DetailPanel.tsx` |
| Add torrent modal | `src/app/downloads/components/AddTorrentModal.tsx` |

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

**Watch party sync** — shared room WebSocket where multiple users watch in sync and the host controls seeking. Requires a lightweight WebSocket server (could be a Next.js API route with server-sent events as fallback) and a room code/invite model.

**Jellyfin user linking** — associate a unified-frontend account with a specific Jellyfin user ID so watch history and resume position reflect that user's actual Jellyfin state rather than the admin API key user. Store `jellyfin_user_id` in the users table; use it for all `/Users/<id>/...` calls when present.

**Push notifications** — Web Push API when a requested item becomes available, polled from Seerr. Store VAPID-encrypted push subscriptions in the DB. Seerr webhook or polling job checks request status; on transition to `available` fire the push.

**Mobile PWA** — `manifest.json` and a service worker enabling home screen install on iOS and Android. Offline metadata browsing via cache-first strategy for library data. Already has a standalone-capable layout.

**Subtitle search** — OpenSubtitles API queried by IMDB ID. SRT or VTT loaded directly into the player as an additional `<track>` element. The IMDB ID is available from Jellyfin's `ProviderIds.Imdb` field on item detail.

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

Overview → User Monitoring → User Management → Invites → Requests → Watch Activity → Audit Log → Server Status → **Indexers** → **Automation** → **Request Bridge** → **Subtitles** → **Media Server**

### Independence build env vars

| Variable | Phase | Required | Purpose |
|---|---|---|---|
| `JELLYFIN_USER_ID` | 3 | Yes | Admin user UUID — `GET /Users/Me` → `Id` field |
| `SEERR_WEBHOOK_SECRET` | 3 | Optional | Verifies `X-Webhook-Signature` on webhook POSTs |
| `OPENSUBTITLES_API_KEY` | 4 | Yes | OpenSubtitles v3 key (free: 5/day) |
| `SUBTITLE_LANGUAGES` | 4 | Optional | Comma-separated codes, default `en` |
| `SUBTITLE_MEDIA_ROOT` | 4 | Optional | Container path to media; required for .srt disk writes |
| `TMDB_ACCESS_TOKEN` | 5 | Yes | TMDB API v3 Bearer token |
| `MEDIA_ROOTS` | 5 | Yes | Colon-separated container paths to scan (e.g. `/media/movies:/media/tv`) |
| `TRANSCODE_CACHE` | 5 | Optional | HLS segment temp dir; default `/tmp/transcode` |

### Seerr webhook (Phase 3)

Configure Seerr → Settings → Notifications → Webhook → URL: `https://unified.minijoe.dev/api/seerr/webhook`. Enable `Request Approved` + `Media Available`. Set secret in both Seerr and `SEERR_WEBHOOK_SECRET` env var.
