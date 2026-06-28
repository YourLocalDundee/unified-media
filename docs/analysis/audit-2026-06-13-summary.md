# Audit — 2026-06-13 (21-agent read-only) — CLOSED

> Moved out of `CLAUDE.md`. This is the original audit block plus the remediation note. **All P0/P1
> are closed.** The live tracker is `analysis/open-issues.md` (read that for current state); the
> per-domain reports are `analysis/audit-2026-06-13/00-SUMMARY.md` + `01..21-*.md`.

A 21-agent read-only audit ran on 2026-06-13 covering every page, all 105 API routes, and the lib
layer, plus cross-cutting passes (a11y/mobile, resilience, deploy/runtime, input validation, temporal,
untrusted-input). Build was clean (`type-check` + `build` pass, `npm audit` 0 vulns). ~379 findings;
the 19 raw criticals collapse to ~10 distinct issues.

## Remediation status — 2026-06-19 (all criticals closed)

All P0 and P1 items are closed. Closed since the audit:

- **S1/S2** — CSRF on every mutating route (qbit/torznab/jellyfin metadata + all admin/automation/
  subtitle/profile routes); `proxy.ts` is intentionally a UX-only redirect guard per the DAL pattern,
  not a security boundary.
- **S3** — force-pw-change confirmed correct (`requireAuth()` redirects those sessions; the change
  route uses `getSession()`).
- **S4** — indexer `api_key` redacted.
- **D1** — auto-delete ownership guards.
- **D2** — `monitored_items` unique index + fetch-or-create.
- **D3** — atomic `grabbing` status.
- **F3** — healthcheck + caddy fragment.
- **P1** — heavy work moved to a background job queue.

Note: `stream`/`playback`/`subtitles`/`sessions/*` jellyfin routes were already gated via
`getSession()` — the original S1 bullet overstated this. Open at the time of writing: P2 no-op
settings (product decision), a11y modal focus traps + light-theme contrast.

## Critical (deduped) — original findings

### Security
- **Unauthenticated internal proxies.** `src/proxy.ts` only checked a session cookie was *present*,
  not valid. The qBittorrent `[...path]` proxy, most jellyfin routes, and `api/torznab/search` ran
  with no `requireAuth()`. (A7-01, A4, A13-01, A12-02, A14-C1/C2)
- **CSRF effectively off.** `verifyOrigin` ran on ~12 of 51 mutating routes and used
  `origin.startsWith()` so `unified.minijoe.dev.evil.com` passed; missing Origin was allowed.
  (`lib/csrf.ts:11`; A6-01, A9-01, A1-002)
- **Forced password change bypassable.** 30-day cookie set before the `force_pw_change` check.
  (`api/auth/login/route.ts:97`; A1-001)
- **Indexer `api_key` leaked to the browser** in plaintext on every indexer GET. (`lib/indexer/config.ts:7`; A12-01)

### Data loss / engine
- **auto-delete could delete user-owned media** — matched `media_items` by `tmdb_id`+`type` with no
  ownership link. (`lib/automation/auto-delete.ts:50`; A11-C1) Highest-risk behavior in the app.
- **`monitored_items` had no unique index** → dead dedup guards → duplicate rows and double grabs.
  (`db/migrations.ts:160`, `automation/monitor.ts:88`; A6-02, A11-C2) Plus a fire-and-forget grab
  racing the cron (A11-C3).

### Functional / resource / deploy
- **Watch history permanently empty** — nothing wrote `watch_events`; the player writes
  `media_watch_state`. (`history/page.tsx:48`; A3-01, A20-03)
- **Player AudioContext never torn down** — browsers cap ~6, so long sessions broke all audio tools.
  (`useAudioChain.ts:16`; A4)
- **Deploy fragments broken** — healthcheck used `curl` (absent from `node:24-slim` → container
  unhealthy forever); committed `caddy.fragment`/`docker-compose.fragment.yml` lacked the party `ws`
  route. (A18-C1/C2)

## Systemic patterns (HIGH)
- Many client mutations never checked `res.ok` (failed delete/suspend/save reported success).
- ~13 of 18 `components/media/*` dead, plus the alt `downloads/components/*` UI and
  `party/JoinByCodeModal`; full list in `analysis/audit-2026-06-13/17-resilience-deadcode.md`.
- No-op settings: Display page (except Theme), 9 of 11 Playback prefs, the Torrent Interface tab.
- Heavy work synchronously in request handlers (`media/scan`, subtitle download, embedded-subtitle
  ffmpeg) — needed a job queue.
- All `next/image` were `unoptimized`.
- No `error.tsx`/`not-found.tsx`/`loading.tsx`/`aria-live` anywhere.

## Remediation order (as planned)
- **P0** — auth on qbit/jellyfin/torznab routes (+ `proxy.ts` validates sessions); enforce
  `verifyOrigin` on all mutations; auto-delete ownership key; gate force-password-change; stop
  returning `api_key`.
- **P1** — unique index on `monitored_items` (dedupe first); atomic `grabbing`; fix healthcheck + edge
  fragments; resolve `auto_approved`/`auto_delete_at` mismatch (A20-01); job queue for scan/subtitle/ffmpeg.
- **P2** — wire/remove watch history; tear down AudioContext; broad `res.ok` handling; add
  `error.tsx`/`not-found.tsx` + `aria-live`; image optimization; delete ~27 dead modules; fix
  continue-watching ordering (A20-02).
