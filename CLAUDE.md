# unified-frontend

A single-pane-of-glass web app for the minime home server media stack (v0.11.10 doc-tracked; see note
below). Replaces the old multi-tab workflow with one fully native interface for browsing, requesting,
watching, and monitoring downloads. The app runs its own media server, indexer aggregation, download
automation, and subtitle management — zero Jellyfin dependency.

> **This file is the lean entry point.** Deep-dives, shipped-feature history, and the backlog now
> live under `docs/`. Start with `docs/README.md` for the index and conventions. Section pointers
> below link to the detail. Keep this file lean — when a feature ships, move its deep-dive to
> `docs/` and leave a pointer here.

---

## Status & docs map

- **Current version:** v0.11.10 is the latest doc-tracked feature-batch label (see
  `docs/complete/FEATURES.md`); `app/package.json` is still `0.11.2`, bumped only at an actual
  release cut, so the two numbers legitimately diverge between cuts. Deployed to production
  (`unified.minijoe.dev`) as of 2026-07-11 — the doc-tracked and deployed versions are in sync as of
  this writing, but re-check `docker inspect unified-frontend` before assuming that still holds.
- **Audit:** the 2026-06-13 21-agent audit is closed (all P0/P1 fixed). History +
  remediation: `docs/analysis/audit-2026-06-13-summary.md`; live tracker `docs/incomplete/open-issues.md`.
- **What's shipped:** `docs/complete/FEATURES.md`.
- **What's open / next:** `docs/incomplete/BACKLOG.md`.
- **Chronology:** `CHANGELOG.md`.

| Topic | Lives in this file | Deep-dive |
| ----- | ------------------ | --------- |
| Overview, architecture, services, env | §1–§5, §8 | — |
| Gotchas / "don't trip over this" | §7 | — |
| Video player (tools, quality, chrome, audio/subs) | pointer §9 | `docs/player/` |
| Torrent system internals (+ admin-only gating, piece map, create-torrent) | pointer §12 | `docs/features/torrent-system.md` |
| Two-mode request system | pointer §15 | `docs/features/request-system.md` |
| Party Play (watch together, incl. ready-check countdown) | pointer §16 | `docs/features/party-play.md` |
| Decision engine (gates + custom formats) | pointer §17 | `docs/features/decision-engine.md` |
| Independence build (native media stack) | pointer §14 | `docs/complete/FEATURES.md` |
| Grab confirmation flow | pointer §18 | `docs/features/grab-confirmation.md` |
| Mobile PWA + Web Push notifications | pointer §19 | `docs/features/pwa-notifications.md` |
| Native phone/TV apps (Capacitor) | pointer §20 | `docs/features/native-apps.md` |

---

## 1. Project Overview

### What this is

A Next.js 16+ web app with a **fully native** media stack. Library browsing, playback, indexer
aggregation, download automation, and subtitle management all run inside the app — it does not call
Jellyfin. Two external services are still used at the edges:

- **Seerr** — TMDB metadata + the request/approval admin surface
- **qBittorrent** — the download client that feeds the library (via the native automation layer)

The end goal is a single URL (`media.minijoe.dev`) that handles the complete workflow: discover →
request → watch, with download status visible inline.

> **Note:** the native stack (own indexer aggregation, download automation, subtitle management, and
> media server) replaced the external *arr services and Jellyfin for the in-app experience. See §14
> and `docs/complete/FEATURES.md`.

### What this is NOT

- Not a replacement for Sonarr, Radarr, or Bazarr — those aren't used by this app at all (removed
  2026-07-09; the native decision engine, quality profiles, and subtitle system fully replace them).
  They still run on minime for direct/power use, just with zero integration here. Prowlarr is
  partially replaced (2026-07-10): the redundant Prowlarr-direct admin surface (`/settings/media`,
  `/api/prowlarr`, `lib/prowlarr/`) is gone — `/admin/indexers` (native `indexers` table) is now the
  only indexer admin surface. Prowlarr itself still backs most seeded indexers as a Torznab source —
  30 configured in Prowlarr, 35 rows in our own `indexers` table as of 2026-07-11 (up from 10/15),
  spanning general movie/TV and anime public trackers, added with zero third-party account signups.
  Full independence would mean porting Prowlarr's Cardigann engine, deferred as high-effort/low-value
  for a home server (see `docs/analysis/prowlarr-analysis.md`).
- The app no longer calls Jellyfin. A standalone Jellyfin still runs at `jellyfin.minijoe.dev` for
  direct TV use, fully independent of this app and out of scope for it.
- Not a full Seerr replacement. Seerr still runs at `seerr.minijoe.dev` for admin/approval.
- Not a torrent manager. qBittorrent's full UI is still at `qbt.minijoe.dev`.
- Not a new backend in the cloud sense — all data is local.

---

## 2. Architecture

### Directory layout

```
/home/minijoe/dev/unified-frontend/
  app/                  # The Next.js application (run npm run dev from here)
  docs/                 # Deep-dives, feature history, backlog (see docs/README.md)
  CLAUDE.md             # This file
```

### How it fits in the stack

```
Internet
  └── BunkerWeb (WAF, TLS termination)
        └── Caddy (reverse proxy)
              └── reverse_proxy → unified-frontend:3001  (this app — auth handled internally)
                  (party-play WebSocket path → :3002, see docs/features/party-play.md)
```

The app calls backing services from **Next.js server components and API routes** — never directly
from the browser. This keeps API keys and qBittorrent session cookies out of client code and avoids
CORS entirely.

### Auth strategy (v0.4.0+)

The app manages its own auth end-to-end. Caddy is a plain reverse proxy with **no external auth
gateway / `forward_auth`** in front of `unified.minijoe.dev`. Auth is SQLite-backed (`better-sqlite3`) at
`$DB_PATH` (default `./unified.db`, production `/data/unified.db` via Docker volume `unified-db:/data`).

Key components:

| File | Purpose |
| ---- | ------- |
| `src/lib/db/index.ts` | Singleton DB, runs migrations + seed on first call |
| `src/lib/db/migrations.ts` | Schema for all tables (users, sessions, indexers, monitored_items, grab_*, media_*, watch_parties, …) |
| `src/lib/db/seed.ts` | Seeds admin from `ADMIN_USERNAME` + `ADMIN_PASSWORD` on first run |
| `src/lib/dal.ts` | `requireAuth()` / `requireAdmin()` / `createSession()` / `logEvent()` — server-only |
| `src/lib/password.ts` | `validatePassword()` / `hashPassword()` / `verifyPassword()` |
| `src/lib/csrf.ts` | `verifyOrigin()` on state-mutating routes |
| `src/lib/safe-redirect.ts` | `getSafeRedirectUrl()` — prevents open redirect via `?from=` |
| `src/lib/email.ts` | Nodemailer wrapper; falls back to console log if SMTP unset |
| `src/context/AuthContext.tsx` | Client context; fetches `/api/auth/me`, exposes `useAuth()` |

**DAL pattern (CVE-2025-29927):** auth is enforced in server components and route handlers via
`requireAuth()` / `requireAdmin()`. Middleware (`proxy.ts`) handles redirects for UX only — never a
security gate.

**Session model:** 30-day TTL cookie `unified-session` (`HttpOnly`, `Secure`, `SameSite=lax`), 24h
rotation, 90-day absolute max, 32-char cryptographically-random ID.

**Registration:** open enrollment; email verification optional via `EMAIL_VERIFICATION_REQUIRED`
(default false → instant activation). Two-step UI; rate-limited 10/15min/IP. Demographics
(`first_name`, `last_name`, `bio`, `location`) collected at signup, editable via
`PATCH /api/auth/profile/demographics`. Full profile/account API: see §11.

**Admin seeding:** on first `getDb()` with an empty users table, `seedAdmin()` reads
`ADMIN_USERNAME`/`ADMIN_PASSWORD`. If the password is absent or weak, a random one is generated,
printed to stderr (`docker logs unified-frontend`), and `force_pw_change=1` is set. Container starts
regardless. `ADMIN_USERNAME` defaults to `admin`.

---

## 3. Service Integrations

All service-to-service calls run from Next.js server code. Credentials live in env vars, never client-side.

| Service | Internal URL | Auth | Proxy route | Env |
| ------- | ------------ | ---- | ----------- | --- |
| Seerr | `http://seerr:5055` (`/api/v1`) | `X-API-Key` header | (native `/api/requests/`; old `/api/seerr/[...path]` removed in Phase 7) | `SEERR_URL`, `SEERR_API_KEY` |
| qBittorrent | `http://qbittorrent:8080` (`/api/v2`) | cookie session (SID), held server-side | `/api/qbit/[...path]` (**`qbit`** with an `i`) | `UMT_URL`, `UMT_USERNAME`, `UMT_PASSWORD` |
| Prowlarr | `http://prowlarr:9696` | `X-Api-Key` | none (no live proxy route; one-time discovery fetch only, see below) | `PROWLARR_URL`, `PROWLARR_API_KEY` |

**Sonarr/Radarr/Bazarr removed (2026-07-09):** `lib/sonarr/`, `lib/radarr/`, `lib/bazarr/` and every
caller (the `/browse/[id]` monitored-status badge, the TV/Movies/Subtitles tabs on the old
`/settings/media`) are gone — no proxy routes ever existed for them despite older docs implying
otherwise. The native decision engine, quality profiles, and subtitle system are the real
replacements.

**Prowlarr-direct admin surface removed (2026-07-10):** `/settings/media`, `/api/prowlarr/[...path]`,
and `lib/prowlarr/` (`client.ts`, `types.ts`, `api.ts`) are gone — that page duplicated
`/admin/indexers` (the native `indexers` table) with a worse UI and no health/rate-limit persistence.
`/admin/indexers` is now the only indexer admin surface. `PROWLARR_URL`/`PROWLARR_API_KEY` are still
read once, at first boot, by `src/lib/indexer/discovery.ts` to seed native `indexers` rows pointing at
Prowlarr's per-tracker Torznab endpoints — that's a one-shot bridge (only fires on an empty
`indexers` table), not a live proxy.

**Indexer expansion (2026-07-11):** Prowlarr grew from 10 to 30 configured indexers — all
zero-signup public trackers, general movie/TV and anime — added directly via Prowlarr's own
`/api/v1/indexer` API (schema pulled from `/api/v1/indexer/schema`; a few needed `enable: false` +
`forceSave=true` first when Prowlarr's live connectivity test flaked, then a follow-up `PUT` to
flip them on). `discovery.ts` itself wasn't touched — its bridge only runs once against an empty
table — so picking up the new Prowlarr indexers into our own `indexers` table required manually
replicating its exact insert loop (`INSERT OR IGNORE ... Prowlarr: ${name}`) against the running
container's DB (`docker exec` + a scratch Node script using the container's own `better-sqlite3`).
That surfaced a real bug: **`indexers.name` had no unique constraint** anywhere (not a migration
artifact — it was simply never declared), so the first sync silently double-inserted 10 rows in
production. Fixed in `migrations.ts` (dedup existing rows, then `CREATE UNIQUE INDEX IF NOT EXISTS
idx_indexers_name`) and redeployed; see the `### Fixed` entry in `CHANGELOG.md`. If Prowlarr gains
more indexers later, the safe re-sync is: same manual script, now protected by the unique index —
`INSERT OR IGNORE` will actually ignore existing rows instead of silently duplicating them.

**qBittorrent (UMT layer):** the client abstraction is **UMT (Unified Media Torrent)**, configured
via `UMT_*`. Cookie session is obtained by POSTing creds to `/api/v2/auth/login`; on 403,
re-authenticate and retry once. See §7 for the v5 cookie-name gotcha and the `/api/qbit` vs `/api/qbt`
typo trap. Full endpoint catalogue: `docs/features/torrent-system.md`.

**Download client registry** (`src/lib/download-client/`): `qbittorrent.ts`, `transmission.ts`, and
`deluge.ts` are all implemented. Active client chosen by `DOWNLOAD_CLIENT` (default `umt`).

---

## 4. Tech Stack

| Concern | Choice |
| ------- | ------ |
| Framework | Next.js 16+ App Router (TypeScript) |
| Styling | Tailwind CSS v4 (no `tailwind.config.js`; `@tailwindcss/postcss`) + shadcn/ui |
| Server state | TanStack Query (React Query) |
| Client state | Zustand |
| qBittorrent API | direct fetch via Next.js API routes (VueTorrent `QbitProvider.ts` is the reference) |
| Seerr API | direct fetch, typed wrappers (`seerr-api.yml` spec in sources) |
| Lint | ESLint + Prettier; react-hooks rules at **error** (see §7) |

**Installed versions (v0.9.1 baseline):** `next ^16.2.7`, `react ^19.0.0`, `typescript ^6.0.3`,
`tailwindcss ^4.3.0`, `@tanstack/react-query ^5.100.14`, `zustand ^5.0.14`.

---

## 5. Page / Feature Map

```
app/app/
  page.tsx                      # / → Home dashboard
  browse/page.tsx               # /browse → TMDB discovery (all tabs are discovery; v0.9.6+)
  browse/[id]/page.tsx          # acquisition detail (request controls)
  browse/discover/[mediaType]/[tmdbId]/  # detail for TMDB items not yet in library
  library/page.tsx              # /library → owned-media grid
  library/[id]/page.tsx         # play-only detail (+ admin delete)
  requests/page.tsx             # /requests → request list
  downloads/page.tsx            # /downloads → qBittorrent queue (+ TorrentDetailPanel)
  search/page.tsx               # /search → unified search (Library + Discover tabs)
  play/[id]/                    # video player route (chrome-suppressed)
  admin/…                       # monitoring, users/[id], indexers, automation, subtitles, media-server, quality-profiles
  settings/…                    # profile, playback, torrent, display; admin link if role===admin
  api/…                         # media/qbit/sonarr/radarr proxies, requests, admin, grab, party, subtitles
```

**Routing rule (ownership determines destination):**
- Owned movie/series → `/library/${id}` (play-only detail). Home Recently Added/Continue Watching
  still link movies straight to `/play/${id}`.
- Discoverable (TMDB, not owned) → `/browse/discover/${mediaType}/${tmdbId}`.
- Already-owned card reached *from discovery* → `/browse/${id}` (acquisition detail, intentional).
- **Never** link home/library-context cards to `/browse/[id]` for owned content — that drops the user
  into the acquisition UI for something they already have. See §7 for the series-container `/play`
  trap.

---

## 6. Build Phases & Independence Build → see `docs/complete/FEATURES.md`

The original five build phases (scaffolding → Jellyfin → Seerr → qBittorrent → unified UX) and the
seven-phase **Independence Build** (native Prowlarr/Sonarr/Radarr/Bazarr/Jellyfin/Seerr replacements)
are all shipped. The completed-phase tables, admin nav order, and independence-build env vars now live
in `docs/complete/FEATURES.md`. The env vars an agent needs day-to-day are in §8 below.

---

## 7. Known Constraints and Gotchas

These are the live "don't trip over this" rules. Kept in full because they're load-bearing.

### qBittorrent
- **Session auth (v5.2.1):** login returns `204` on success (code checks `res.ok`, fine). Cookie name
  changed `SID` → `QBT_SID_{port}`; both `session.ts` and `download-client/qbittorrent.ts` capture
  the pair via `/((?:QBT_SID_\d+|SID)=[^;]+)/`. On 403, re-auth + retry once. Flow stays server-side.
- **Upload fields are `up_*` not `ul_*` (Bug 6):** `/transfer/info` + `server_state` use
  `up_info_speed`/`up_info_data`/`up_rate_limit`. Reading `ul_*` returns `undefined` → "NaN
  undefined/s". Code reads `up_*` (with `ul_*` fallback); `formatBytes` is NaN/≤0-safe.
- **Add returns 409 on duplicate (v0.9.10):** several per-episode `wanted` items can resolve to the
  same pack; first add wins, rest 409. `addTorrent` swallows 409 as a no-op grab so the grabber
  doesn't retry forever.
- **Proxy is `/api/qbit/...` (with an `i`):** `/api/qbt/...` is not a route and returns 404 HTML with
  status 200 — looks like a garbage success to any caller checking only `res.ok`.

### Auth / Next.js 16
- **Self-managed auth (v0.4.0+):** `unified.minijoe.dev` uses its own SQLite sessions. No external
  SSO / `forward_auth` gateway and no trusted-auth request headers — never reintroduce header-based
  auth. If `ADMIN_PASSWORD` is missing/weak, a random one is logged to stderr on first start.
  Never delete the `unified-db` volume without a backup.
- **Proxy file naming:** Next.js 16 replaced `middleware` with `proxy`. The guard must be `src/proxy.ts`
  exporting `export function proxy(...)`; the old names silently fail to register. UX-only, not a
  security boundary.
- **Stale session cookie loop:** `getSession()` must `cookieStore.delete(SESSION_COOKIE)` before every
  `return null` on a stale/expired session, or you get an infinite `/login ↔ /` redirect.
- **Cookie mutations throw in Server Component context:** `cookies().set()/delete()` throw during a
  Server Component render. All three mutation sites in `dal.ts` are wrapped in try/catch (no-op in SC
  context, succeed in Route Handler context). Without this, expired-session users get a 500 on every load.

### Edge / infra
- **BunkerWeb WAF:** several features are disabled per-domain for `unified.minijoe.dev` in
  `/opt/docker/compose/edge/docker-compose.yml` — `USE_BAD_BEHAVIOR`, `USE_CROWDSEC`, `USE_DNSBL`,
  `USE_MODSECURITY`, `USE_BLACKLIST` all `no` (RSC prefetch scoring, VPN/cellular-NAT false bans,
  password-field CRS triggers). Rate limiting stays on. Fix per-domain, not globally.
- **Pi-hole wildcard DNS:** resolves `*.minijoe.dev` → `192.168.0.50` for LAN + Docker host; no
  `/etc/hosts` needed in the container.
- **Docker network:** the app's backing containers are on the implicit `compose_default` bridge.
  *arr services are reachable by container name or host IP; `.env.local` uses host IPs.

### Data model / routing
- **Series containers have `file_path = NULL`:** scanner creates a parent series row as an FK target
  only; it has no playable file. Never generate `/play/${id}` for `type = 'series'`. `play/[id]/page.tsx`
  redirects series IDs to `/browse/${id}` as a safety net, but upstream links must not produce them.
- **Library vs Browse:** context determines destination (see §5).

### Video player
- **`<video>` errors don't bubble as React events:** keep `onError={handleVideoError}` wired or a
  failure leaves `isLoading` stuck true forever.
- **MKV seek-before-loadedmetadata:** set `video.currentTime` only in the `loadedmetadata` handler;
  earlier causes silent stalls (container index not parsed yet). `resumeApplied` ref guards double-apply.
- **`screen.orientation.lock` needs active fullscreen (Android):** `await requestFullscreen()` first,
  then lock; wrap in try/catch (iOS/desktop throw).
- **Nav active-highlight:** use `pathname === href || pathname.startsWith(href + '/')` — the trailing
  slash matters or `/browse` falsely matches sibling routes.

### Lint — react-hooks at `error` (v0.10.1)
`eslint.config.mjs` keeps `set-state-in-effect`, `refs`, `purity`, `immutability` at **error** (a new
violation fails the build). Use the compliant patterns, not `eslint-disable`:
- **set-state-in-effect:** defer fetch/restore work a tick (`setTimeout(fn, 0)`); for reset-on-prop use
  the during-render adjust pattern; for localStorage hydration use `useSyncExternalStore` or a lazy
  `useState(() => …)`.
- **refs:** never read/write `ref.current` during render; keep "latest value" refs in an effect.
- **purity:** no `Date.now()`/`Math.random()` in render; route clock reads through `nowMs()`.
- **immutability:** use-before-declaration in mount-once listeners goes through a live ref; hoist pure
  helpers to module scope; `Array.from(...)` live DOM lists before mutating.

---

## 8. Development Workflow

### Running locally
```
cd /home/minijoe/dev/unified-frontend/app
npm install
npm run dev        # http://localhost:3000
npm run lint        # eslint
npm run type-check  # tsc --noEmit
npm run test        # vitest run — unit tests live next to their source (*.test.ts)
```
Auth in dev is the same SQLite session system as prod — no header injection.

### `.env.local` (core keys)
```
# Seerr
SEERR_URL=http://192.168.0.50:5055    SEERR_API_KEY=<settings.json main.apiKey>
# UMT → qBittorrent
UMT_URL=http://192.168.0.50:8080      UMT_USERNAME=<…>   UMT_PASSWORD=<…>
# *arr (host IPs in dev; container names in prod)
SONARR_URL / SONARR_API_KEY, RADARR_URL / RADARR_API_KEY,
PROWLARR_URL / PROWLARR_API_KEY, BAZARR_URL / BAZARR_API_KEY
# App + auth
NEXT_PUBLIC_APP_URL=http://localhost:3001
ADMIN_USERNAME=<…>   ADMIN_PASSWORD=<strong>   DB_PATH=./unified.db
TRUSTED_PROXY_COUNT=2     # XFF depth: BunkerWeb→Caddy=2; unset in dev. Drives getClientIp() (A1-005)
# SMTP (all optional; unset → codes print to docker logs)
SMTP_HOST= SMTP_PORT=587 SMTP_USER= SMTP_PASS= SMTP_FROM=
EMAIL_VERIFICATION_REQUIRED=          # 'true' to require email code; default false
# Web Push (all optional; unset → push is a logging no-op, mirrors SMTP above)
VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= VAPID_SUBJECT=   # generate: npx web-push generate-vapid-keys
```

### Independence-build env (native stack)
`OPENSUBTITLES_API_KEY` (+ `OPENSUBTITLES_USERNAME`/`PASSWORD` for the VIP 1000/day quota),
`SUBTITLE_LANGUAGES`, `SUBTITLE_MEDIA_ROOT`, `TMDB_ACCESS_TOKEN`, `MEDIA_ROOTS` (colon-separated),
`TRANSCODE_CACHE`, `SEERR_WEBHOOK_SECRET`. Full table + which phase needs which:
`docs/complete/FEATURES.md`.

### Deploy — always via compose, never bare `docker build`
Compose tags the image `compose-unified-frontend:latest`; a bare `docker build -t unified-frontend`
produces an image compose never uses (container keeps the old one).
```
docker compose build --no-cache unified-frontend
docker compose up -d --force-recreate unified-frontend
```
Use `node:24-slim` (Debian, not Alpine) — `better-sqlite3` needs glibc; build stage needs
`python3 make g++`. `output: 'standalone'` in `next.config.ts`.

### Caddy
```
unified.minijoe.dev {
  import compressed
  reverse_proxy unified-frontend:3001
}
```
Party-play adds a `/api/party/ws*` route to `:3002` — see `docs/features/party-play.md`.
Update via `python3 scripts/update-caddyfile.py`, then
`docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.

### Reference material
- `docs/analysis/` — per-service mining notes (jellyfin, seerr, sonarr, radarr, prowlarr,
  qbittorrent/vuetorrent, flood, watchparty sources, stack audit, 21-domain audit reports).
  Upstream `sources/` was purged at v0.11.2; `docs/analysis/source-mining-log.md` is the record.
- `docs/incomplete/feature-mining-summary.md` — ranked feature candidates from the mining.
- `docs/` — feature deep-dives + history.

---

## 9. Video Player → see `docs/player/`

The player is feature-complete (tools, quality/resolution, chrome/orientation, audio+subtitle tracks).
All component-level detail moved out of this file:
- `docs/player/player-tools.md` — the `src/components/player/*` tool components (speed, A/B loop, EQ,
  audio chain, bookmarks, chapters, snapshot, transform, …) + the Web Audio chain constraint.
- `docs/player/quality-resolution.md` — server-side quality option building, client switching, auto
  aspect ratio, screen-aware tier selection.
- `docs/player/chrome-orientation.md` — chrome suppression on player routes, fullscreen + orientation
  lock ordering, resume-seek timing, `<video>` error handling, series-container `/play` safety net.
- `docs/player/audio-subtitles.md` — embedded subtitle → WebVTT extraction, audio track switching
  (option B restart-and-seek), English language defaults, on-demand OpenSubtitles search + live
  `<track>` injection, the two-quota-bucket OpenSubtitles auth model.

Key load-bearing constraints from these are summarized in §7.

---

## 10. (moved) Player quality/chrome/audio → `docs/player/`

Former §10 / §10a / §10b are consolidated under `docs/player/` (see §9).

---

## 11. Profile and Account Settings (v0.5.2+)

`/settings/profile` is self-contained — no external identity provider. All mutations go through server routes
(`requireAuth()`), never client→DB.

| Route | Method | Purpose |
| ----- | ------ | ------- |
| `/api/auth/profile/display-name` | PATCH | Display name (≤64) |
| `/api/auth/profile/email` | PATCH | Email (unique, validated) |
| `/api/auth/profile/demographics` | PATCH | first/last/bio/location |
| `/api/auth/profile/change-password` | POST | Change pw; revokes other sessions; 5/15min/user |
| `/api/auth/profile/sessions` | GET | List active sessions |
| `/api/auth/profile/sessions/:id` | DELETE | Revoke one (not current) |
| `/api/auth/profile/sessions/revoke-others` | POST | Revoke all but current |

**Avatar:** initials-based; hue derived by hashing username (`h = h*31 + c` → `% 360`), stable per user.
**DB (v0.5.2/0.5.3):** additive `ALTER TABLE users ADD COLUMN display_name/first_name/last_name/bio/
location` (try/catch wrapped) + `pending_registrations` table (id, username, email, password_hash,
demographics, 6-digit code, attempts, 10-min `expires_at`). Expiry enforced at verification time; no
cleanup job.

---

## 12. Unified Torrent System → see `docs/features/torrent-system.md`

The full qBittorrent client UI (`/downloads` + `TorrentDetailPanel`), the `src/types/torrent.ts` type
catalogue (44-field `QbtTorrent`, 90-field `QbtPreferences`, etc.), the proxy multipart/query/re-auth
fixes, the complete endpoint table (~40 ops), the 8-tab `/settings/torrent` page, the Files-tab piece
map, and the create-torrent dialog are documented in `docs/features/torrent-system.md`. Live-page note:
`src/app/downloads/components/*` is a **dead alternate UI** — the live UI is `page.tsx` +
`TorrentDetailPanel.tsx`. Proxy spelling is **`/api/qbit`**.

**Downloads are admin-only:** `/downloads`, `/api/qbit` (GET+POST), `/settings/torrent`, the dashboard
"Active Downloads" section, and the Downloads nav item are all gated to `role === 'admin'` — the GET
proxy carries the server-side qBittorrent session cookie, so a regular authed user could otherwise
read the full queue/prefs via it. Detail: `docs/features/torrent-system.md`.

---

## 13. Backlog → see `docs/incomplete/BACKLOG.md`

Future ideas and remaining work live in `docs/incomplete/BACKLOG.md`. Items shipped since the original
§13 list (watch-party sync → v0.9.5, on-demand subtitle search → v0.9.11) are recorded in
`docs/complete/FEATURES.md`.

---

## 14. Independence Build → see `docs/complete/FEATURES.md`

Seven shipped phases of native TypeScript services replacing the external *arr stack + Jellyfin
(indexer aggregation, download automation, request bridge, subtitle management, media server, native
browse/watch, native request management). Completed-phase table, admin nav order, env vars, and the
Seerr webhook config are in `docs/complete/FEATURES.md`.

---

## 15. Two-Mode Request System → see `docs/features/request-system.md`

Every request is **Quick** (old content, auto-approved, slot-limited 1 movie/2 TV per user, 48h
auto-delete after availability) or **Long-term** (any content, manual admin approval, never
auto-deleted, no slot limit) — `media_requests.request_type`. Full rules, the auto-approve gate
conditions, and key files: `docs/features/request-system.md`.

---

## 16. Party Play (Watch Together) → see `docs/features/party-play.md`

Native watch-together (v0.9.5; shared queue + auto-advance v0.10.0). Shared control (no host-only),
sync + presence + text chat + emoji reactions over one WebSocket on a **dedicated `ws` server on port
3002** (the Next standalone server can't take the `upgrade` event), same process as the route handlers
so the `globalThis`-pinned `PartyStateStore` is shared. Browser connects same-origin to
`wss://unified.minijoe.dev/api/party/ws`; Caddy routes that path to 3002.

Full architecture (data model, the PartyStateStore scale seam, the server-authority command pipeline,
drift bands, readiness gate, resilience/grace, the three action-origin correctness rule, the shared
queue + idempotent auto-advance + navigation-race handling, creator-kick/control-lock, guest join, the
**ready-check + 5s start countdown lobby** (`userReady`, separate from the technical buffer-readiness
`ready` flag), the v0.9.5 audit remediation, and the **mandated off-tailnet cellular idle edge test**)
is in `docs/features/party-play.md`. The feature audit is `PARTY_PLAY_AUDIT.md` at repo root (all
findings fixed).

**Party play coordinates the existing player only** — it does not touch transcode/codec/audio/subtitle
behavior, and `position_ticks` remains the single source of truth for progress.

---

## 17. Decision Engine — Gate-Chain + Custom Formats → see `docs/features/decision-engine.md`

Two-stage release evaluation in the grabber (Sonarr/Radarr-style): **hard gates** (blocklist /
seed-floor / sample / size-cap, editable at `/admin/automation` → "Grab Gates") decide what's
grabbable, then a **soft score** (custom formats incl. edition/HC/AKA-alternate-title fallback search)
ranks survivors. Auto-pick never grabs a gated release; the interactive admin picker lists gated
releases (with reasons) and can override-grab. Full gate table, custom-format types, flag catalogue,
and AKA fallback details: `docs/features/decision-engine.md`.

---

## 18. Grab Confirmation Flow → see `docs/features/grab-confirmation.md`

Every user-initiated auto-pick action shows the release it would grab and lets the user Grab it /
walk to the Next best / drop to the interactive picker / Cancel, instead of firing straight to the
download client. The 5-minute background cron and the Seerr webhook path are **untouched** —
confirmation only applies where there's a live user session to show a modal to. Core split
(`searchAndScoreItem` → `grabSpecificRelease`), the tiered candidate API (`GET /api/grab/candidates`,
`POST /api/grab/confirm`), the shared `<GrabConfirmModal>` client, and the Vitest setup notes are in
`docs/features/grab-confirmation.md`.

---

## 19. Mobile PWA + Web Push Notifications → see `docs/features/pwa-notifications.md`

Installable PWA shell (manifest, service worker, offline fallback) plus VAPID Web Push notifications
on request-available, sent alongside the existing Discord/ntfy channels. The service worker's cache
boundary is load-bearing: it caches **only** static assets + `/offline`, **never** `/api/*` or any
personalized HTML — this app has no external auth gateway and Cache Storage isn't user-scoped, so
caching an authenticated response could leak across accounts on a shared device. VAPID env vars are
in §8. Full detail: `docs/features/pwa-notifications.md`.

---

## 20. Native Phone/TV Apps (Capacitor) → see `docs/features/native-apps.md`

6-phase plan to turn the app into a phone app (Android + iOS) and an Android TV/Fire TV/Google TV
app plus Chromecast casting. **Phase 1 (Android phone wrapper) shipped and emulator-verified
2026-07-14; phases 2-5 not started.** New `native/` directory (sibling to `app/`, outside the
Docker build context) holds the Capacitor project — `capacitor.config.ts` points its WebView at the
live `https://unified.minijoe.dev` instead of a bundled build, so the existing cookie-session auth
and CSRF check work completely unmodified for the phone/TV wrappers themselves. Testing workflow is
`.claude/skills/test-unified-android/SKILL.md` (headless emulator, driven via adb). Full detail,
including the not-yet-started phases (`/tv` route, Android TV APK, Chromecast's signed-token
requirement): `docs/features/native-apps.md`.
