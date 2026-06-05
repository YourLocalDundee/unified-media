# unified-frontend Stack Audit

Generated: 2026-06-04

---

## 1. Production Dependencies

All versions are from `app/package.json` (`"version": "0.4.0"` — note: package.json version has not been bumped to match the v0.8.0 described in CLAUDE.md).

| Package | Version in package.json | Notes |
|---|---|---|
| `@ffprobe-installer/ffprobe` | `^2.1.2` | Bundles ffprobe binary. No known CVEs at audit date. |
| `@jellyfin/sdk` | `^0.13.0` | Current upstream is 0.13.x. CLAUDE.md references "unstable" builds — this is the stable release channel. OK. |
| `@tailwindcss/postcss` | `^4.3.0` | Tailwind v4 PostCSS plugin. Matches tailwindcss `^4.3.0`. Consistent. |
| `@tanstack/react-query` | `^5.100.14` | Current v5 line. OK. |
| `@tanstack/react-query-devtools` | `^5.100.14` | Dev tools shipped in production bundle — consider moving to devDependencies. |
| `@types/nodemailer` | `^8.0.0` | Type package in dependencies, not devDependencies. Should be moved. |
| `bcryptjs` | `^3.0.3` | Pure JS bcrypt. No known CVEs. |
| `better-sqlite3` | `^12.10.0` | Current major. Requires native compilation — Dockerfile handles this correctly. |
| `chokidar` | `^5.0.0` | File watcher used by the media indexer. Current. |
| `clsx` | `^2.1.1` | Current. |
| `hls.js` | `^1.6.16` | Current v1 line. |
| `jose` | `^6.2.3` | JWT/JWK library. Current v6 line. |
| `lucide-react` | `^1.17.0` | Icon library. |
| `next` | `^16.2.7` | **FLAG:** package.json pins Next.js 16. CLAUDE.md says "Next.js 14+" throughout and its Dockerfile example shows `node:22-slim`. The actual Dockerfile uses `node:24-slim` (see section 4). Next.js 16 is a future/beta major — confirm this is intentional and stable for production use. |
| `node-cron` | `^4.2.1` | Current v4 line. |
| `nodemailer` | `^8.0.10` | Current v8 line. |
| `p-limit` | `^7.3.0` | Current. ESM-only package; compatible because package.json has `"type": "module"`. |
| `react` | `^19.0.0` | React 19 stable. OK. |
| `react-dom` | `^19.0.0` | Matches react version. OK. |
| `recharts` | `^3.8.1` | Charting library. Current. |
| `tailwind-merge` | `^3.6.0` | Current v3 line. |
| `xml2js` | `^0.6.2` | Used for torznab/RSS parsing. `^0.6.x` is the current line. No known active CVEs. |
| `zustand` | `^5.0.14` | Current v5 line. |
| `zxcvbn` | `^4.4.2` | Password strength estimator. **FLAG:** Last published 2017; unmaintained. No CVEs, but consider `@zxcvbn-ts/core` as a maintained fork if this becomes a concern. |

**Items to move from dependencies to devDependencies:**
- `@tanstack/react-query-devtools` (only needed in dev; adds bundle weight in production)
- `@types/nodemailer` (types-only package)

---

## 2. Environment Variables — Complete Table

All variables the app reads via `process.env.*` in `src/`, cross-referenced with `.env.local`.

| Variable | Value in .env.local | Required | Documented in CLAUDE.md | Notes |
|---|---|---|---|---|
| `ADMIN_PASSWORD` | `Pr1v@teS3rv!2026` | Required | Yes | Process exits if unset on first DB init. |
| `ADMIN_USERNAME` | `admin` | Required | Yes | Process exits if unset on first DB init. |
| `BAZARR_API_KEY` | `72ca2d1b280e574e3cd62d34b1893fac` | Required (if Bazarr used) | Yes | |
| `BAZARR_URL` | `http://192.168.0.50:6767` | Required (if Bazarr used) | Yes | |
| `DB_PATH` | `./unified.db` (.env.local) / `/data/unified.db` (compose override) | Required | Yes | Compose sets this to `/data/unified.db`, overriding .env.local value. |
| `DOWNLOAD_CLIENT` | `qbittorrent` | Optional | Yes (section 3) | Defaults to `qbittorrent` in code. |
| `EMAIL_VERIFICATION_REQUIRED` | **NOT SET** | Optional | **No** | Controls whether email verification is enforced at registration. When absent, treated as `false`. See Missing Vars section. |
| `FFMPEG_PATH` | **NOT SET** | Optional | **No** | Path to ffmpeg binary. Defaults to `ffmpeg` (uses PATH). ffmpeg is installed in the Dockerfile so the default works. |
| `FLARESOLVERR_URL` | **NOT SET** | Optional | Yes (section 7, CLAUDE.md mentions FlareSolverr) | Defaults to `http://flaresolverr:8191` in code. flaresolverr container exists in compose. |
| `JELLYFIN_API_KEY` | `20f7a0a60bc54ad995078b56f4f3a2d0` | Required | Yes | |
| `JELLYFIN_URL` | `http://192.168.0.50:8096` | Required | Yes | |
| `JELLYFIN_USER_ID` | `9A4FADEB-0255-4BF6-9871-30859DA390F8` | Required (Phase 3+) | Yes (section 14) | |
| `MEDIA_ROOTS` | `/media/movies:/media/tv` | Required (Phase 5) | Yes (section 14) | |
| `NEXT_PUBLIC_APP_URL` | `https://unified.minijoe.dev` | Required | Yes | |
| `NEXT_RUNTIME` | **NOT SET** | Optional (runtime internal) | No | Read by Next.js runtime itself, not app-level code. Can be ignored. |
| `NODE_ENV` | **NOT SET** in .env.local (set to `production` in Dockerfile) | Optional | No | Standard Node/Next.js var; Dockerfile sets it correctly. |
| `OPENSUBTITLES_API_KEY` | *(empty string)* | Required (Phase 4) | Yes (section 14) | Set in .env.local but empty. Phase 4 subtitle fetching will fail silently or error without this. |
| `PROWLARR_API_KEY` | `d6b7242607a642cebc0e727d3c99bbf0` | Required (if Prowlarr used) | Yes | |
| `PROWLARR_URL` | `http://192.168.0.50:9696` | Required (if Prowlarr used) | Yes | |
| `QBIT_PASSWORD` | `WOskXN!234` | Required | Yes (as `QBT_PASSWORD` in CLAUDE.md) | See naming discrepancy note below. |
| `QBIT_URL` | **NOT SET** | Optional | Yes (as `QBT_URL` in CLAUDE.md) | Defaults to `http://qbittorrent:8080` in `config.ts`. **See naming discrepancy note below.** |
| `QBIT_USERNAME` | `admin` | Required | Yes (as `QBT_USERNAME` in CLAUDE.md) | See naming discrepancy note below. |
| `QBT_URL` | **NOT SET** | Optional | Yes | Used only in `api/admin/server-status/route.ts` health check. Defaults to `http://qbittorrent:8080`. Different from `QBIT_URL` used by `download-client/config.ts`. |
| `RADARR_API_KEY` | `f055b2b05b884ce9a712edaaed3cab46` | Required (if Radarr used) | Yes | |
| `RADARR_URL` | `http://192.168.0.50:7878` | Required (if Radarr used) | Yes | |
| `SMTP_FROM` | `Unified Media <no-reply@unified.minijoe.dev>` | Optional | Yes (section 7) | Has a value even without SMTP creds — used as the From address if SMTP is configured later. |
| `SMTP_HOST` | *(empty string)* | Optional | Yes (section 7) | Empty = dev fallback mode (code to stdout). |
| `SMTP_PASS` | *(empty string)* | Optional | Yes (section 7) | |
| `SMTP_PORT` | `587` | Optional | Yes (section 7) | |
| `SMTP_USER` | *(empty string)* | Optional | Yes (section 7) | |
| `SONARR_API_KEY` | `b83a210a3d14415b9c5a37bc9bfa07cc` | Required (if Sonarr used) | Yes | |
| `SONARR_URL` | `http://192.168.0.50:8989` | Required (if Sonarr used) | Yes | |
| `SUBTITLE_LANGUAGES` | `en` | Optional | Yes (section 14) | |
| `SUBTITLE_MEDIA_ROOT` | **NOT SET** | Optional | Yes (section 14) | Required for writing .srt files to disk. Without it, downloaded subtitles cannot be saved. |
| `TMDB_ACCESS_TOKEN` | *(JWT set)* | Required (Phase 5) | Yes (section 14) | |
| `TRANSCODE_CACHE` | `/tmp/transcode` | Optional | Yes (section 14) | |

---

## 3. Missing or Incomplete Env Vars

These are vars the code reads that are absent or empty in `.env.local`:

| Variable | Status | Impact |
|---|---|---|
| `EMAIL_VERIFICATION_REQUIRED` | Not in .env.local | Registration silently skips email verification. No crash, but behavior may not match intended production config. Not documented in CLAUDE.md. |
| `FFMPEG_PATH` | Not in .env.local | Falls back to `ffmpeg` in PATH. ffmpeg is installed in the Dockerfile, so the default is fine. Low priority — only needs to be set if a non-PATH binary is required. |
| `FLARESOLVERR_URL` | Not in .env.local | Falls back to `http://flaresolverr:8191`. The `flaresolverr` container exists in the compose file so the default resolves correctly. No action needed. |
| `OPENSUBTITLES_API_KEY` | Present but empty | Phase 4 subtitle fetching will be broken. The indexer/subtitle code will receive an empty string as the API key, producing 401 errors from OpenSubtitles. Must be filled before subtitle management is used. |
| `QBIT_URL` / `QBT_URL` | Neither set | Both default to `http://qbittorrent:8080`. Works in production. But there are **two different env var names** for what is conceptually the same URL: `QBIT_URL` (used in `download-client/config.ts`) and `QBT_URL` (used in `api/admin/server-status/route.ts`). Both have the same default, so behavior is consistent, but the naming inconsistency means setting one does not affect the other. |
| `SUBTITLE_MEDIA_ROOT` | Not in .env.local | If Phase 4 is active, downloaded subtitles cannot be written to disk. No crash — just silent failure on the disk write step. |
| `SEERR_URL` / `SEERR_API_KEY` | Not in .env.local, not read in src/ | CLAUDE.md documents these and the Phase 1 example compose snippet references them, but no `process.env.SEERR_*` calls exist anywhere in `src/`. The Seerr integration appears to have been absorbed into the independence build (Phase 7 native requests). If external Seerr integration is still active via hardcoded URLs in proxy routes, this is a documentation drift issue. |

---

## 4. Dockerfile Accuracy

CLAUDE.md (section 8, "Building the Docker image") documents this pattern:

```
FROM node:22-slim AS builder
...
FROM node:22-slim AS runner
```

**The actual Dockerfile uses `node:24-slim`, not `node:22-slim`.**

Everything else matches CLAUDE.md's documented pattern:

| Check | CLAUDE.md says | Dockerfile has | Match |
|---|---|---|---|
| Base image | `node:22-slim` | `node:24-slim` | **No — upgraded to Node 24** |
| Build tools | `python3 make g++` | `python3 make g++` | Yes |
| ffmpeg in runner | Not explicitly mentioned in template | `apt-get install -y ffmpeg` | Extra (correct for Phase 5 transcoding) |
| Standalone output | Implied by `COPY .next/standalone` | `COPY .next/standalone` | Yes |
| Port | `3001` | `EXPOSE 3001` + `ENV PORT=3001` | Yes |
| User | `nextjs:nodejs` | `nextjs:nodejs` (gid 1001, uid 1001) | Yes |
| Data volume | `/data` | `VOLUME ["/data"]` | Yes |
| Telemetry disabled | Not in template | `ENV NEXT_TELEMETRY_DISABLED=1` | Extra (correct) |

**Node 24 vs 22 note:** Node.js 24 is the current Active LTS line as of 2026. The upgrade from 22 to 24 is intentional and correct. CLAUDE.md just hasn't been updated to reflect the change.

---

## 5. DB Schema — Tables in migrations.ts

| Table | Purpose | In CLAUDE.md |
|---|---|---|
| `users` | Auth accounts; includes profile columns (display_name, first_name, last_name, bio, location) | Yes |
| `invite_codes` | Admin-created invite codes | Yes |
| `sessions` | Session tokens (30-day TTL, 24h rotation) | Yes |
| `audit_log` | Security/action audit trail | Yes |
| `watch_events` | Per-user watch history with progress | Yes |
| `login_attempts` | Login attempt rate limiting data | Yes |
| `password_resets` | Password reset tokens | **No** — not mentioned anywhere in CLAUDE.md |
| `pending_registrations` | Two-step registration verification codes (10-min TTL) | Yes (section 7 and 11) |
| `indexers` | Torznab indexer registry (Phase 1) | Yes (section 14) |
| `quality_profiles` | Download quality profiles (Phase 2) | Yes (section 14) |
| `monitored_items` | Content being monitored for download (Phase 2) | Yes (section 14) |
| `grab_history` | Records of torrent grabs per monitored item (Phase 2) | Yes (section 14) |
| `grab_results` | Stores search candidates per grab attempt (Phase 2) | **No** — not mentioned in CLAUDE.md |
| `quality_tiers` | Canonical quality tier definitions (seeded with 19 tiers) | **No** — not mentioned in CLAUDE.md |
| `custom_formats` | User-defined release format scoring rules | **No** — not mentioned in CLAUDE.md |
| `quality_profile_formats` | Junction table: profile ↔ custom format scores | **No** — not mentioned in CLAUDE.md |
| `subtitle_wants` | Subtitle download queue (Phase 4) | Yes (section 14) |
| `media_requests` | Native request management with quick/longterm types (Phase 7) | Yes (sections 14 and 15) |
| `app_settings` | Key-value admin config store | **No** — not mentioned in CLAUDE.md |
| `media_items` | Native media server library (Phase 5) | Yes (section 14) |
| `media_watch_state` | Per-user playback position for native media server | **No** — not mentioned in CLAUDE.md |

**Tables in CLAUDE.md that are NOT in migrations.ts:** None. All tables CLAUDE.md references exist in the schema.

**Tables in migrations.ts not documented in CLAUDE.md:** `password_resets`, `grab_results`, `quality_tiers`, `custom_formats`, `quality_profile_formats`, `app_settings`, `media_watch_state`. These are implementation details that have accumulated without docs updates.

---

## 6. SMTP Implementation — Crash Behavior

The implementation in `src/lib/email.ts` is a genuine no-op when SMTP vars are unset, not a crash.

The guard in `createTransport()` is:

```typescript
if (!host || !user || !pass) return null
```

Any of `SMTP_HOST`, `SMTP_USER`, or `SMTP_PASS` being absent or an empty string causes `createTransport()` to return `null`. `sendEmail()` then hits the dev-fallback path, which logs the email content (including the 6-digit verification code) to stdout via `console.log`.

**Behavior with current .env.local:** `SMTP_HOST` and `SMTP_USER` and `SMTP_PASS` are all empty strings. The `!host` check evaluates to `true` (empty string is falsy), so the transport is never created and all emails print to Docker logs. This matches the comment in .env.local: "codes are logged to Docker stdout".

`sendEmail()` returns `true` in both the dev-fallback and the real-send path. Callers treat `false` as a send error (caught exception in the real path). The dev fallback never returns `false`, so the registration flow completes normally even without SMTP configured.

**No crash risk.** The `SMTP_FROM` env var being set to a non-empty value while `SMTP_HOST` is empty has no effect on behavior — the transport is null before `SMTP_FROM` is even used.

---

## 7. Compose Deployment — Accuracy vs. CLAUDE.md

The actual `unified-frontend` service in `docker-compose.yml` differs from the example snippet in CLAUDE.md section 8:

| Aspect | CLAUDE.md example | Actual compose | Notes |
|---|---|---|---|
| Image source | `image: unified-frontend:latest` | `build: context: /home/minijoe/dev/unified-frontend/app` | Compose builds locally — correct per CLAUDE.md's later note about `docker compose build` |
| DB_PATH override | Not shown | `environment: DB_PATH=/data/unified.db` | Correct — overrides `.env.local`'s `./unified.db` |
| env_file | Not shown | `env_file: /home/minijoe/dev/unified-frontend/app/.env.local` | All .env.local vars are passed in |
| Volumes | `none required` in Phase 1 note | `unified-db:/data`, `/mnt/media/movies:/media/movies:ro`, `/mnt/media/tv:/media/tv:ro` | Correct for Phase 5+ media server |
| Port mapping | `192.168.0.50:3000:3000` | No port mapping (internal only via Caddy) | Caddy handles external routing — no exposed port needed |
| Watchtower | `enable=false` | `enable=false` | Match |
| Memory limit | Not shown | `mem_limit: 1g` | Reasonable for a Node app with SQLite |
| Health check | Not shown | `node -e require('http').get(...)` on `:3001/api/health` | Correct port |

**Media mount paths:** The compose file mounts `/mnt/media/movies` and `/mnt/media/tv` as `/media/movies` and `/media/tv` inside the container. `.env.local` sets `MEDIA_ROOTS=/media/movies:/media/tv`, which matches the container-side paths. Consistent.

**`SEERR_URL` / `SEERR_API_KEY` absence:** The compose service does not pass `SEERR_URL` or `SEERR_API_KEY`, and as noted in section 3, no code in `src/` reads those vars. This is consistent.
