# CLAUDE.md Accuracy Audit

Audited against `app/src/` on 2026-06-04. For each finding: **accurate**, **wrong/outdated**, or **missing**.

---

## Section 1 — Project Overview

**Accurate.** High-level description of the app, its three backing services, and what it is not matches the actual codebase.

---

## Section 2 — Architecture

### Directory layout

**Accurate.** The layout table matches what exists on disk.

### Architecture diagram

**Accurate.** Next.js server components proxy to Jellyfin/Seerr/qBittorrent. No CORS issues, API keys server-side. Correct.

### Auth strategy / Key components table

**Accurate.** All seven files listed in the table exist:
- `src/lib/db/index.ts` ✓
- `src/lib/db/migrations.ts` ✓
- `src/lib/db/seed.ts` ✓
- `src/lib/dal.ts` ✓
- `src/lib/password.ts` ✓
- `src/lib/csrf.ts` ✓
- `src/lib/safe-redirect.ts` ✓
- `src/lib/email.ts` ✓
- `src/context/AuthContext.tsx` ✓

### Session cookie name

**Accurate.** `dal.ts` line 32: `const SESSION_COOKIE = 'unified-session'`. Cookie options (HttpOnly, Secure, SameSite=lax, 30-day TTL, 24h rotation, 90-day absolute max) all match the code.

### Admin seeding

> **RESOLVED v0.9.1, 2026-06-04:** CLAUDE.md corrected. See "Resolved Since Audit" section. Finding preserved below for historical reference.

~~**Wrong.** CLAUDE.md states: "If either [ADMIN_USERNAME or ADMIN_PASSWORD] is missing, the process exits with an error."~~

The actual `seed.ts` does **not** call `process.exit()`. If `ADMIN_PASSWORD` is missing or fails policy validation, it auto-generates a random password (`randomBytes(12).toString('hex') + '!Aa1'`), prints it to stderr, and sets `force_pw_change=1`. The container starts normally. Missing `ADMIN_PASSWORD` is a warning, not a fatal error.

Additionally, `ADMIN_USERNAME` defaults to the string `'admin'` if not set — it is never required.

---

## Section 3 — Service Integrations

### Sonarr / Radarr / Prowlarr / Bazarr — Internal URL and network_mode

**Wrong — multiple points:**

1. CLAUDE.md says all four `*arr` services run with `network_mode: host` and must be reached via host IP `192.168.0.50`. This is false. The actual `docker-compose.yml` has them on the bridge network with port bindings:
   - Sonarr: `192.168.0.50:8989:8989`
   - Radarr: `192.168.0.50:7878:7878`
   - Prowlarr: `192.168.0.50:9696:9696`
   - Bazarr: `192.168.0.50:6767:6767`

   Because they are on the bridge network, they are reachable by container name (`http://sonarr:8989`, `http://radarr:7878`, etc.) from within the Docker network. The host IP approach works but is not the actual deployment pattern.

2. The source-code defaults in each client file use the host IP as a fallback (`process.env.SONARR_URL ?? 'http://192.168.0.50:8989'`), which is consistent with the CLAUDE.md advice, but the compose file does not define `SONARR_URL` etc. so the fallback is what fires in production. The fallback is functional because Pi-hole resolves the host IP within the Docker host, but the accurate statement would be "reachable by container name."

3. The summary internal-address table at the bottom of Section 7 contradicts the Section 3 text: the table correctly lists `http://sonarr:8989` and `http://radarr:7878` (container names), but the prose in Section 3 and the "Known Constraints" section say to use the host IP.

### qBittorrent — SID format

**Accurate.** `session.ts` line 46 uses the regex `/((?:QBT_SID_\d+|SID)=[^;]+)/` which handles both `QBT_SID_{port}=VALUE` (v5) and `SID=VALUE` (v4) as documented.

### Seerr proxy route

**Partially outdated — webhook resolved, catch-all note stands.** CLAUDE.md page map (Section 5) shows `api/seerr/[...path]/route.ts` as a Seerr proxy route. This catch-all file does not exist. The app has fully replaced Seerr's request functionality with the native request system in `src/lib/requests/` and `src/app/api/requests/`. No `/api/seerr/...` catch-all proxy exists.

> **RESOLVED (webhook) v0.9.1, 2026-06-04:** The Seerr webhook route listed in Section 14 (`/api/seerr/webhook`) **does** now exist at `src/app/api/seerr/webhook/route.ts`. It implements HMAC-SHA256 verification and handles `MEDIA_APPROVED`, `REQUEST_APPROVED`, `MEDIA_AVAILABLE` events. See "Resolved Since Audit" section below.

### Jellyfin proxy route

**Wrong.** CLAUDE.md page map shows `api/jellyfin/[...path]/route.ts` as a single catch-all proxy. The actual implementation uses specific sub-routes:
- `api/jellyfin/continue-watching/`
- `api/jellyfin/image/[itemId]/`
- `api/jellyfin/playback/[id]/`
- `api/jellyfin/seasons/[seasonId]/episodes/`
- `api/jellyfin/series/[id]/next-episode/`
- `api/jellyfin/series/[id]/seasons/`
- `api/jellyfin/sessions/playing/`, `.../progress/`, `.../stopped/`
- `api/jellyfin/stream/[...path]/`
- `api/jellyfin/subtitles/[itemId]/[streamIndex]/`

There is no `api/jellyfin/[...path]` catch-all.

### Jellyfin image proxy path

**Wrong.** Section 6 Phase 2 says to create `app/api/jellyfin-image/[itemId]/route.ts`. The actual route lives at `src/app/api/jellyfin/image/[itemId]/route.ts` — it's a sub-route under the `jellyfin/` namespace, not a top-level `jellyfin-image/` route.

---

## Section 4 — Tech Stack / Package Versions

**Partially resolved.** CLAUDE.md previously listed stale floor targets. Updated in v0.9.1.

> **RESOLVED v0.9.1, 2026-06-04:** CLAUDE.md "Key package versions" section updated to match actual `package.json`. See "Resolved Since Audit" section.

Historical finding (for reference):

| Package | Old CLAUDE.md | Actual (package.json) | Current CLAUDE.md |
|---|---|---|---|
| `next` | `15+` | `^16.2.7` | `16+` |
| `react` / `react-dom` | `19+` | `^19.0.0` | `19+` ✓ |
| `typescript` | `5.4+` | `^6.0.3` | `6+` |
| `tailwindcss` | `3.4+` | `^4.3.0` | `4.4+` |
| `@tanstack/react-query` | `5+` | `^5.100.14` | `5+` ✓ |
| `zustand` | `5+` | `^5.0.14` | `5+` ✓ |
| `@jellyfin/sdk` | `latest unstable or stable` | `^0.13.0` | unchanged |

Note: Tailwind 4 has a different config format from Tailwind 3 (no `tailwind.config.js`; uses `@tailwindcss/postcss` instead of `tailwindcss` in PostCSS config).

---

## Section 5 — Page / Feature Map

### API route table

Multiple discrepancies:

| CLAUDE.md claim | Actual state |
|---|---|
| `api/jellyfin/[...path]/route.ts` — catch-all proxy | Does not exist; replaced by specific sub-routes (see Section 3 above) |
| `api/seerr/[...path]/route.ts` — Seerr proxy | Does not exist at all |
| `api/qbt/login/route.ts` — SID acquisition | Does not exist. Login is handled inside `qbitFetch()` in `session.ts` via the `[...path]` catch-all route; there is no separate login sub-route |
| `api/admin/users/[id]/route.ts` — "PATCH (role/is_active/force_pw_change) + DELETE" | Accurate in function, but there are also `/suspend/` and `/activate/` sub-routes not mentioned |

Routes that exist but are not in the page map:
- `api/admin/activity/route.ts` and `api/admin/activity/export/route.ts`
- `api/admin/audit/route.ts`
- `api/admin/server-status/route.ts`
- `api/admin/settings/route.ts`
- `api/admin/stats/route.ts`
- `api/admin/users/[id]/suspend/route.ts` and `.../activate/route.ts`
- `api/auth/change-password/route.ts`, `api/auth/forgot-password/route.ts`, `api/auth/reset-password/route.ts`, `api/auth/resend-verification/route.ts`, `api/auth/register-config/route.ts`, `api/auth/history/route.ts`, `api/auth/check-username/route.ts`
- All `api/automation/...`, `api/indexer/...`, `api/media/...`, `api/quality-profiles/...`, `api/requests/...` routes (entire independence build API layer)

### Browse page

**Partially accurate.** Section 5 describes `/browse` and the discover sub-route. The actual path `browse/discover/[mediaType]/[tmdbId]` exists (`src/app/browse/discover/[mediaType]/[tmdbId]/page.tsx`). Accurate.

---

## Section 6 — Build Phases

### Phase 2 — Jellyfin integration

**Wrong path.** "configure a server-scoped Jellyfin API client in `lib/jellyfin.ts`" — actual file is `src/lib/jellyfin/client.ts`. There is no top-level `lib/jellyfin.ts`.

### Phase 3 — Seerr integration

**Outdated.** "Install no new packages; use fetch wrapper in `lib/seerr.ts`" — `lib/seerr.ts` does not exist. The app does not proxy Seerr for user-facing requests; it uses the native request system (`src/lib/requests/`) instead.

### Phase 4 — qBittorrent

**Wrong path.** "`lib/qbt.ts`: server-side session manager" — actual file is `src/lib/qbittorrent/session.ts`. There is no `lib/qbt.ts`.

"`/api/qbt/[...path]/route.ts`: transparent proxy" — accurate, this file exists.

### docker-compose example

> **RESOLVED v0.9.1, 2026-06-04:** The docker-compose example now uses `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD` consistently with source code. See "Resolved Since Audit" section.

~~**Wrong env var prefix.** The YAML example in Section 8 uses `QBT_URL`, `QBT_USERNAME`, `QBT_PASSWORD` (prefix `QBT_`). The actual source code (`session.ts`, `config.ts`) reads `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD` (prefix `QBIT_`). The `.env.local` example just above correctly uses `QBIT_`, making the docker-compose snippet internally inconsistent and wrong.~~

**Missing fields in compose example.** The actual `docker-compose.yml` does not use the inline `environment:` block shown in CLAUDE.md. It uses `env_file: /home/minijoe/dev/unified-frontend/app/.env.local` plus a single `environment: - DB_PATH=/data/unified.db`. It also has `mem_limit: 1g` and media volume mounts (`/mnt/media/movies:/media/movies:ro`, `/mnt/media/tv:/media/tv:ro`) not shown in the example.

**No `ports:` mapping.** The CLAUDE.md example shows `ports: - "192.168.0.50:3000:3000"` but the actual compose service has no `ports:` block. The container is reachable only via Caddy on the bridge network.

---

## Section 7 — Known Constraints and Gotchas

### Middleware file naming gotcha

> **RESOLVED 2026-06-04:** This finding was wrong. `src/proxy.ts` with `export function proxy(...)` is the correct Next.js 16 convention, not a bug. Next.js 16 replaced `middleware.ts` / `export function middleware` with `proxy.ts` / `export function proxy`. The build manifest confirms `ƒ Proxy (Middleware)` is registered and active. The UX redirect guard works correctly. CLAUDE.md already documents this correctly under "Proxy file naming (Next.js 16)". See "Resolved Since Audit" section below.

~~**Wrong / inconsistent with actual codebase state.** CLAUDE.md correctly documents that Next.js middleware must be named `src/middleware.ts` and must `export function middleware(...)`. It says that `src/proxy.ts` is silently ignored.~~

~~However, the **actual file in the repo is `src/proxy.ts` with `export function proxy(...)`**, not `src/middleware.ts` with `export function middleware(...)`. This means the middleware is currently **not registered** by Next.js — the section documents the known fix but the fix has not been applied. The UX redirect guard (bounce to `/login`) is inactive. Real auth enforcement via `requireAuth()` in server components still works, but unauthenticated users see broken pages rather than a login redirect.~~

### Admin seeding exit behavior

> **RESOLVED v0.9.1, 2026-06-04:** CLAUDE.md was corrected in v0.9.1. The current text accurately says "a random password is auto-generated, printed to stderr, and `force_pw_change=1` is set." See "Resolved Since Audit" section below.

~~**Wrong** (same as Section 2 note). CLAUDE.md says missing `ADMIN_USERNAME`/`ADMIN_PASSWORD` causes `process.exit(1)`. The actual `seed.ts` auto-generates a password and prints it to stderr. No exit.~~

### *arr services network_mode: host

> **RESOLVED v0.9.1, 2026-06-04:** CLAUDE.md was corrected. The *arr services section now reads "All *arr services (Sonarr, Radarr, Prowlarr, Bazarr) run on the `compose_default` bridge network… reachable by both container name and host IP." `docker inspect sonarr` confirms `NetworkMode: compose_default`. The prose and table in CLAUDE.md now agree. See "Resolved Since Audit" section below.

~~**Wrong.** As documented under Section 3: Sonarr, Radarr, Prowlarr, and Bazarr use bridge networking with port bindings in the actual compose file, not `network_mode: host`. They are reachable by container name within the Docker bridge network.~~

### Internal address summary table

> **RESOLVED v0.9.1, 2026-06-04:** The contradiction between the table (container names) and the prose (host IP required) was resolved. CLAUDE.md now consistently uses container names in the table and notes both forms work for *arr services.

~~**Contradictory.** The table near the end of Section 7 shows `Sonarr | http://sonarr:8989` and `Radarr | http://radarr:7878` (container names), which is correct. But the prose three lines below the table says "All *arr services run with `network_mode: host` — use the host IP `192.168.0.50`, not container names." The table and the prose directly contradict each other. The table is the accurate one.~~

### BunkerWeb WAF

> **RESOLVED v0.9.1, 2026-06-04:** CLAUDE.md Section 7 now has a complete BunkerWeb WAF table documenting all five disabled modules (`USE_BAD_BEHAVIOR`, `USE_CROWDSEC`, `USE_DNSBL`, `USE_MODSECURITY`, `USE_BLACKLIST`) with per-module explanations. See "Resolved Since Audit" section below.

~~**Missing — significant gap.** The BunkerWeb section in CLAUDE.md is generic advice (avoid SQLi patterns, large payloads, etc.). It does not document the actual per-domain settings that have been applied to `unified.minijoe.dev` in the edge compose file:~~

```
unified.minijoe.dev_USE_BAD_BEHAVIOR=no
unified.minijoe.dev_USE_CROWDSEC=no
unified.minijoe.dev_USE_DNSBL=no
unified.minijoe.dev_USE_MODSECURITY=no
unified.minijoe.dev_USE_BLACKLIST=no
unified.minijoe.dev_ALLOWED_METHODS=GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD
unified.minijoe.dev_USE_GZIP=yes
```

All five WAF modules that would normally run — ModSecurity CRS, CrowdSec, DNSBL, IP reputation blacklist, and bad-behavior scoring — are **disabled** for the unified domain. Comments in the compose file explain why each is off (Next.js RSC prefetch requests tripping bad-behavior scoring; CrowdSec/DNSBL blocking VPN and cellular NAT IPs; ModSecurity CRS triggering on registration POST bodies). None of this is in CLAUDE.md. A developer reading the WAF section would not know the app is running with essentially all WAF modules off.

---

## Section 8 — Development Workflow

### .env.local example

> **RESOLVED v0.9.1, 2026-06-04:** Both the `.env.local` example and the docker-compose example now use `QBIT_URL` / `QBIT_USERNAME` / `QBIT_PASSWORD` consistently.

~~**Wrong env var prefix (qBittorrent).** The `.env.local` section correctly uses `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD`. The docker-compose example in the same section uses the wrong `QBT_` prefix.~~

**Accurate for all other vars.** `SEERR_URL`, `SEERR_API_KEY`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_USER_ID`, `SONARR_*`, `RADARR_*`, `PROWLARR_*`, `BAZARR_*`, `NEXT_PUBLIC_APP_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `DB_PATH`, SMTP vars — all match source code usage.

### Dev port

**Accurate.** `package.json` scripts: `"dev": "next dev --port 3001"` — matches CLAUDE.md's `http://localhost:3001` reference.

### Dockerfile

**Mostly accurate, base image updated.** Multi-stage build, `output: 'standalone'` in `next.config.ts`, `apt-get` build tools for `better-sqlite3`, `EXPOSE 3001`, `ENV PORT=3001` — all verified correct. Note: the base image was updated from `node:22-slim` to `node:24-slim` in v0.9.1. CLAUDE.md Dockerfile example reflects this change.

---

## Section 9 — Video Player (Player Tools)

### Component map

**Partially accurate — one extra file not documented.**

> **RESOLVED v0.9.1, 2026-06-04:** `MediaTransform.tsx` added to the CLAUDE.md player component map. It provides rotation (0/90/180/270°), horizontal/vertical flip, zoom presets, and a 3×3 alignment grid — all emitted as CSS strings to the parent VideoPlayer. See "Resolved Since Audit" section.

All components listed in the table exist. `src/components/player/MediaTransform.tsx` was missing from the table; it is now documented.

`MediaAspectRatio` listed in the table — the actual file is `MediaAspectRatio.tsx` ✓. No issue there.

### Web Audio chain

**Accurate.** The chain description and constraint (can only call `createMediaElementSource` once per element) match the `useAudioChain.ts` implementation.

---

## Section 10 — Quality & Resolution System

**Accurate.** `src/lib/jellyfin/playback.ts` exists. The description of `getPlaybackData()`, quality tiers, direct play logic, and `VideoPlayer` quality switching matches the actual component at `src/components/media/VideoPlayer.tsx`.

---

## Section 11 — Profile and Account Settings

### Profile API routes

**Accurate.** All seven routes listed exist:
- `PATCH /api/auth/profile/display-name` ✓
- `PATCH /api/auth/profile/email` ✓
- `PATCH /api/auth/profile/demographics` ✓
- `POST /api/auth/profile/change-password` ✓
- `GET /api/auth/profile/sessions` ✓
- `DELETE /api/auth/profile/sessions/:id` ✓ (at `sessions/[id]/route.ts`)
- `POST /api/auth/profile/sessions/revoke-others` ✓

### DB changes (v0.5.2 and v0.5.3)

**Accurate.** `migrations.ts` includes `ALTER TABLE users ADD COLUMN display_name TEXT` and all four demographic columns (`first_name`, `last_name`, `bio`, `location`). All wrapped in try/catch as described.

### `pending_registrations` schema

**Accurate** but column order differs. CLAUDE.md shows `id, username, email, password_hash, code, ...` — migrations.ts has `id, email, username, password_hash, code, ...` (email before username). Functionally identical.

---

## Section 12 — Unified Torrent System

### Proxy audit findings

**Accurate.** `src/app/api/qbit/[...path]/route.ts` implements multipart passthrough, query-string forwarding on POST, and re-auth on 403 as described.

### Downloads page component files

**Accurate.** All four components exist:
- `src/app/downloads/components/FilterSidebar.tsx` ✓
- `src/app/downloads/components/TorrentRow.tsx` ✓
- `src/app/downloads/components/DetailPanel.tsx` ✓
- `src/app/downloads/components/AddTorrentModal.tsx` ✓

Note: `src/app/downloads/page.tsx` does not live at `src/app/downloads/components/` — it's directly in `downloads/`, which matches the table entry for "Main page."

### Download client registry table

> **RESOLVED v0.9.1, 2026-06-04:** `config.ts` added to the CLAUDE.md download-client table. It exports `getDownloadClientConfig()` and reads `DOWNLOAD_CLIENT`, `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD` env vars. See "Resolved Since Audit" section.

~~**Missing one file.** The table lists `registry.ts`, `qbittorrent.ts`, `transmission.ts`, `deluge.ts`, `types.ts`. The actual directory also contains `config.ts` (configuration loader for DOWNLOAD_CLIENT env var and QBIT_* credentials). Not documented.~~

---

## Section 13 — Future Ideas Backlog

**Mostly accurate** as a backlog. One note: "Sonarr/Radarr status — uses `http://sonarr:8989` and `http://radarr:7878` (both on the Docker bridge network)" — this is correct about network reachability (they are on bridge), but the Section 3 text says to use the host IP. This is internally inconsistent (the backlog note is the accurate one).

---

## Section 14 — Independence Build

### Lib paths table

**Accurate.** All six lib paths exist:

| Phase | Lib path | Exists |
|---|---|---|
| 1 | `src/lib/indexer/` | ✓ |
| 2 | `src/lib/automation/` | ✓ |
| 3 | `src/lib/automation/bridge.ts` | ✓ |
| 4 | `src/lib/subtitle/` | ✓ |
| 5 | `src/lib/media-server/` | ✓ |
| 7 | `src/lib/requests/` | ✓ |

### Admin nav order

**Wrong — two items missing.** CLAUDE.md documents 13 nav items ending at Media Server. The actual `admin/layout.tsx` NAV array has 15 items:

```
Overview, User Monitoring, User Management, Invites, Requests, Watch Activity,
Audit Log, Server Status, Indexers, Automation, Request Bridge, Subtitles,
Media Server, [Quality Profiles], [Settings]
```

`Quality Profiles` (`/admin/quality-profiles`) and `Settings` (`/admin/settings`) are present in the code but missing from the CLAUDE.md nav list.

Corresponding admin pages also exist but are not documented:
- `src/app/admin/quality-profiles/page.tsx`
- `src/app/admin/settings/page.tsx`
- `src/app/admin/server/page.tsx` (the "Server Status" page — route is `/admin/server` not `/admin/server-status`)
- `src/app/admin/activity/page.tsx` (Watch Activity)
- `src/app/admin/audit/page.tsx` (Audit Log)

---

## Section 15 — Two-Mode Request System

### Key files table

**Partially wrong.** The table lists `src/lib/automation/availability.ts` as the file that "Sets `auto_delete_at` only for quick requests when they become available." This is accurate about what the file does.

However, `src/lib/requests/auto-approve.ts` is described as "gates on `request_type === 'quick'`, year check, slot check." The actual code has an additional gate not mentioned: **`request_method !== 'auto-pick'`**. Interactive quick requests (where the user hand-picked a release) are not auto-approved via `tryAutoApprove()`. This is a meaningful omission — a quick request with `request_method = 'interactive'` returns false from `tryAutoApprove()` even if all other conditions are met.

> **RESOLVED v0.9.1, 2026-06-04:** CLAUDE.md Section 15 (Two-Mode Request System) now documents the `request_method` gate: "Auto-approval only triggers on `auto-pick` quick requests." See "Resolved Since Audit" section.

The `RequestOptions.tsx` component and `src/app/api/requests/route.ts` paths are accurate.

### DB schema

**Accurate.** `media_requests` table exists with `request_type TEXT DEFAULT 'longterm'`, `auto_approved INTEGER`, `auto_delete_at INTEGER`, `available_at INTEGER` as described. The `UNIQUE(user_id, tmdb_id, media_type)` constraint exists.

---

## Summary of Issues by Priority

### Open Issues

Things that remain genuinely wrong or undocumented in CLAUDE.md as of the last update (2026-06-04):

**Medium impact (outdated documentation, wrong paths):**

1. **Jellyfin no catch-all proxy** — CLAUDE.md page map shows `api/jellyfin/[...path]/route.ts`. This does not exist. Seven specific sub-routes replace it: `continue-watching/`, `image/[itemId]/`, `playback/[id]/`, `seasons/[seasonId]/episodes/`, `series/[id]/next-episode/`, `series/[id]/seasons/`, `sessions/playing/`+`progress/`+`stopped/`, `stream/[...path]/`, `subtitles/[itemId]/[streamIndex]/`. Medium impact for developers adding new Jellyfin features.

2. **Phase 2/3/4 lib file paths wrong** — Build phases section references `lib/jellyfin.ts`, `lib/seerr.ts`, `lib/qbt.ts`. These do not exist. Actual paths: `lib/jellyfin/client.ts`, no seerr client (native requests only), `lib/qbittorrent/session.ts`. Low-to-medium impact: dev environment only.

3. **Admin nav missing two items** — CLAUDE.md Section 14 admin nav list stops at "Media Server". The actual nav has two more entries: `Quality Profiles` (`/admin/quality-profiles`) and `Settings` (`/admin/settings`). These pages exist and work — just undocumented.

4. **`password_resets` table not in Section 2 table** — `migrations.ts` creates this table for forgot-password flows. CLAUDE.md Section 2 lists 21 tables but the table row in the key components table already includes `password_resets` in its list. Low impact: the count is correct (21 tables listed), but the Section 2 prose note doesn't call this out separately.

**Low impact (informational gaps):**

5. **Compose service structure outdated** — CLAUDE.md docker-compose example shows inline `environment:` block and `ports:` mapping. The actual compose uses `env_file: .env.local` plus a single `DB_PATH` environment override, no `ports:` block (container only reachable via Caddy), and adds `mem_limit: 1g` plus media volume mounts. Low impact for people using the example as a starting point.

---

### Resolved Since Audit

Items that were accurate findings when written but have since been fixed in CLAUDE.md or in the codebase. All resolved as of v0.9.1, 2026-06-04.

**1. Middleware not active (was HIGH)**
- Original finding: `src/proxy.ts` with `export function proxy` is silently ignored by Next.js; UX redirect to `/login` is inactive.
- Resolution: This was never a bug. Next.js 16 replaced `middleware.ts` / `export function middleware` with `proxy.ts` / `export function proxy`. The build manifest shows `ƒ Proxy (Middleware)` is registered and active. CLAUDE.md already correctly documents this under "Proxy file naming (Next.js 16)." The audit finding was based on Next.js 14/15 assumptions.
- Confirmed: `src/proxy.ts` line 39 exports `function proxy(request: NextRequest)`. Build is correct.

**2. `QBT_` vs `QBIT_` env var prefix mismatch (was HIGH)**
- Original finding: docker-compose example used `QBT_URL`/`QBT_USERNAME`/`QBT_PASSWORD`; source code reads `QBIT_*` prefix.
- Resolution: CLAUDE.md docker-compose example corrected to use `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD`. Both the `.env.local` section and the compose snippet now agree with source code.
- Confirmed: `session.ts` and `config.ts` both read `process.env.QBIT_URL`.

**3. No Seerr webhook route existed (was HIGH)**
- Original finding: `/api/seerr/webhook` endpoint listed in Section 14 did not exist.
- Resolution: `src/app/api/seerr/webhook/route.ts` implemented in v0.9.1. Handles `MEDIA_APPROVED`, `REQUEST_APPROVED`, `MEDIA_AVAILABLE`. HMAC-SHA256 verification via `timingSafeEqual` when `SEERR_WEBHOOK_SECRET` is set.
- Confirmed: file exists on disk.

**4. Admin seeding exits on missing password (was HIGH)**
- Original finding: CLAUDE.md stated the container exits with `process.exit(1)` on missing `ADMIN_PASSWORD`.
- Resolution: CLAUDE.md corrected. Current text accurately describes auto-generation of a random password, stderr output, and `force_pw_change=1`. The container never exits.
- Confirmed: `seed.ts` has no `process.exit()` call; uses `randomBytes(12).toString('hex') + '!Aa1'` fallback.

**5. `*arr` services documented as `network_mode: host` (was MEDIUM)**
- Original finding: CLAUDE.md prose said all four *arr services use host networking; the internal address table contradicted this.
- Resolution: CLAUDE.md updated. *arr services section now says bridge network, reachable by container name or host IP. Table and prose agree.
- Confirmed: `docker inspect sonarr` shows `NetworkMode: compose_default`.

**6. BunkerWeb WAF settings undocumented (was LOW)**
- Original finding: CLAUDE.md had no per-domain WAF settings; all five modules off was undocumented.
- Resolution: CLAUDE.md Section 7 now has a complete table with all five disabled modules (`USE_BAD_BEHAVIOR`, `USE_CROWDSEC`, `USE_DNSBL`, `USE_MODSECURITY`, `USE_BLACKLIST`) and per-module explanations.

**7. Package version floor targets outdated (was LOW)**
- Original finding: CLAUDE.md said `next: 15+`, `typescript: 5.4+`, `tailwindcss: 3.4+`. Actual: 16, 6, 4.
- Resolution: CLAUDE.md updated to `next: 16+`, `react/react-dom: 19+`, `typescript: 6+`, `tailwindcss: 4.4+`.

**8. `config.ts` missing from download-client table (was LOW)**
- Original finding: `src/lib/download-client/config.ts` not in CLAUDE.md table.
- Resolution: `config.ts` added to the table. It exports `getDownloadClientConfig()` and reads `DOWNLOAD_CLIENT`, `QBIT_URL`, `QBIT_USERNAME`, `QBIT_PASSWORD`.

**9. `MediaTransform.tsx` missing from player component map (was LOW)**
- Original finding: `src/components/player/MediaTransform.tsx` not in the player tools table.
- Resolution: added to CLAUDE.md Section 9. Provides rotation (0/90/180/270°), flip, zoom presets, 3×3 alignment grid — emitted as CSS callbacks to VideoPlayer.

**10. `auto-approve.ts` `request_method` gate undocumented (was MEDIUM)**
- Original finding: CLAUDE.md Section 15 omitted that `tryAutoApprove()` also gates on `request_method === 'auto-pick'`, blocking auto-approval for interactive requests.
- Resolution: CLAUDE.md Section 15 updated. `auto-approve.ts` description now reads "gates on `request_type === 'quick'` AND `request_method === 'auto-pick'`, year check, slot check." A note was added explaining that interactive quick requests go to the admin queue regardless of other conditions.
