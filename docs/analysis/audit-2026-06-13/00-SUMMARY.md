# Unified Media — Full Audit Summary (2026-06-13)

Read-only audit of `app/` (Next.js 16, React 19, better-sqlite3) by 21 focused agents across
logic flow, interactions/buttons, optimizations, security, a11y, runtime, and data integrity.
Notifications and SMTP were excluded by request. Build status at audit time: `npm run type-check`
and `npm run build` both PASS; `npm audit` reports 0 dependency vulnerabilities.

Each `NN-*.md` in this directory is the full report for one domain; this file consolidates them.

## Per-report counts

| # | Report | Crit | High | Med | Low |
|---|--------|------|------|-----|-----|
| 01 | auth-session | 1 | 4 | 7 | 6 |
| 02 | browse-discover | 0 | 3 | 6 | 6 |
| 03 | library-catalog | 1 | 5 | 7 | 5 |
| 04 | player-playback | 2 | 6 | 8 | 6 |
| 05 | party-play | 0 | 1 | 5 | 6 |
| 06 | requests | 2 | 5 | 6 | 5 |
| 07 | downloads-torrents | 1 | 4 | 7 | 6 |
| 08 | settings-shell-ui | 0 | 4 | 6 | 6 |
| 09 | admin-users-rbac | 2 | 5 | 7 | 5 |
| 10 | admin-config-monitoring | 0 | 4 | 8 | 4 |
| 11 | automation-engine | 3 | 6 | 7 | 5 |
| 12 | indexers | 2 | 4 | 6 | 5 |
| 13 | integration-proxies | 1 | 2 | 5 | 4 |
| 14 | data-layer-security | 2 | 3 | 7 | 6 |
| 15 | subtitles-global-opt | 0 | 4 | 9 | 7 |
| 16 | a11y-responsive-ux | 0 | 6 | 13 | 8 |
| 17 | resilience-deadcode | 8 resilience findings + ~27 dead-code items |||
| 18 | deploy-runtime-infra | 2 | 4 | 6 | 5 |
| 19 | input-validation | 0 | 3 | 9 | 6 |
| 20 | temporal-correctness | 0 | 3 | 3 | 4 |
| 21 | untrusted-input-handling | 0 | 0 | 3 | 5 |

Raw criticals total 19; these collapse to ~10 distinct issues after merging cross-report duplicates.

---

## The distinct CRITICAL issues (deduped, with corroboration)

### Security

**S1. Internal proxy routes reachable without authentication (credentialed SSRF / open relay).**
`src/proxy.ts` only checks that a session cookie is *present*, not valid, so several routes hand
attacker input to internal services using server-held credentials.
- qBittorrent `[...path]` proxy has no `requireAuth` — full unauthenticated control of qBit incl.
  `torrents/delete` (with files), `torrents/add`, `app/setPreferences`. `api/qbit/[...path]/route.ts:19,32` (A7-01, A14-C1).
- Jellyfin routes missing `requireAuth`: `stream`, `playback/[id]`, `sessions/{playing,progress,stopped}`,
  `subtitles/...` (A4) plus `image/[itemId]`, `series/[id]`, `series/[id]/next-episode`,
  `series/[id]/seasons`, `seasons/[seasonId]/episodes` (A13-01). Only `continue-watching` is gated.
- `api/torznab/search/route.ts:11` unauthenticated, fans out to every indexer (amplification, tracker-ban abuse) (A12-02).
Fix: add `requireAuth()`/`requireAdmin()` at the top of each handler; make `proxy.ts` validate the session, not just its presence.

**S2. CSRF unprotected on state-changing routes.** `verifyOrigin` exists but is called on only ~12 of 51
mutating routes. All of requests, admin (suspend/activate/delete/reset-password/promote), automation,
indexer, subtitle, and profile mutations omit it, on a `SameSite=lax` cookie with no CSRF token.
Where present, `verifyOrigin` uses `origin.startsWith(allowed)` so `https://unified.minijoe.dev.evil.com`
passes, and a missing Origin is allowed. `lib/csrf.ts:11-12` (A6-01, A9-01, A14, A1-002, A10-02).
Fix: tighten `verifyOrigin` to exact host match + deny missing Origin; call it on every POST/PUT/PATCH/DELETE.

**S3. Forced-password-change session bypass.** `force_pw_change` is checked only in the login *response*,
after the real 30-day session cookie is already set, so a user who ignores the client redirect keeps a
fully valid session. `api/auth/login/route.ts:97-116` + `lib/dal.ts:58-122` (A1-001).

**S4. Private-tracker passkey leaked to the browser.** Indexer GET does `SELECT *` and returns `api_key`
in plaintext to the admin edit modal. `lib/indexer/config.ts:7` + `api/indexer/route.ts:7` (A12-01).

### Data loss / engine correctness

**D1. auto-delete can destroy user-owned media.** `runAutoDelete()` selects `media_items` by `tmdb_id`+`type`
only, with no ownership link, so it can permanently delete a file that merely shares a title with an
auto-deletable quick request. `lib/automation/auto-delete.ts:50-67` (A11-C1). Highest-risk behavior in the app.

**D2. `monitored_items` has no unique index → duplicate rows → double grabs.** Plain INSERT from 3 call
sites; the "already exists" try/catch guards are dead code; progress/grab-results then bind to an
arbitrary duplicate. `db/migrations.ts:160-176` + `automation/monitor.ts:88` (A6-02, A11-C2, A14).

**D3. Immediate-grab races the cron → double grab.** Approval fires a non-awaited grab that races the
15-min cron on the same `wanted` row; no in-flight `grabbing` state. `automation` paths (A11-C3).

### Functional / resource / deploy

**F1. Watch history is permanently empty.** Nothing writes `watch_events`; `/history` and admin watch
stats read it, while the player writes `media_watch_state` instead. `history/page.tsx:48` (A3-01, A20-03).

**F2. AudioContext never torn down.** `useAudioChain.ts:16-91` builds a Web Audio graph with no cleanup
and never `close()`s it; browsers cap ~6 contexts, so binge-watching eventually breaks all audio tools (A4).

**F3. Deploy fragments broken.** Healthcheck runs `curl -f` but `curl` is not in the `node:24-slim` runtime
image (container reports unhealthy forever, A18-C1); committed `caddy.fragment`/`docker-compose.fragment.yml`
are stale and lack the party `ws` route/port, so deploying from the repo's own fragments breaks party play
at the edge (A18-C2).

---

## Systemic themes (the high-leverage HIGH-severity patterns)

- **Fire-and-forget fetches.** Many client mutations never check `res.ok`; failed pause/resume/delete,
  admin suspend/activate/promote, and Save show success on failure (A7-04, A9-10/11, A10-03/06/07, A17-A6).
- **Large dead-code surface.** 13 of 18 `components/media/*` are unmounted (two superseded detail-panel and
  episode-carousel chains, `SeasonSelector`, a shadowed `RequestButton`); the entire `app/downloads/components/*`
  alt UI, `party/JoinByCodeModal`, and an alternate `TorrentRow` are also dead. ~27 dead items total (A17-B,
  A02-004, A03-03, A07-08).
- **No-op settings.** The whole Display settings page except theme, 9 of 11 Playback prefs, the Torrent
  Interface tab, the Advanced Jellyfin-URL override, sidebar-collapse prefs, and the documented `S`/`N`
  shortcuts persist values that nothing reads (A08-H1..H4, A08-M1..M3).
- **Heavy work synchronously inside request handlers.** `media/scan` runs full ffprobe + serial TMDB
  enrichment in-request; subtitle download runs the whole queue in-request; embedded-subtitle extraction
  spawns unbounded ffmpeg per request (A10-08, A15-H1/H2, A19-H1). Needs a job queue / concurrency caps.
- **All images unoptimized.** Every `next/image` sets `unoptimized`, bypassing the configured
  `remotePatterns`; full-res posters on the browse/library grids (A02-006, A15-G).
- **Resilience + a11y gaps.** No `error.tsx`/`global-error.tsx`/`not-found.tsx`/`loading.tsx` anywhere; zero
  `aria-live`; several custom modals lack focus trap/restore/Escape; light theme unreadable on ~17 hardcoded
  `bg-zinc-950` pages (A16, A17-A1).
- **Input validation is hand-rolled and inconsistent.** Unvalidated `Range` header into `createReadStream`,
  ~22 handlers `await req.json()` with no try/catch, unbounded pagination, value-type gaps on column-allowlisted
  writes (A19).
- **Misc correctness.** Quick requests get `auto_delete_at` but never `auto_approved=1`, so they never delete
  and leak quick-slots (A20-01). Continue-watching orders by `last_played`, which is always NULL for resumable
  rows (A20-02). CSV exports do not neutralize `= + - @` (A9-04, A21). Interactive torrent picks are
  auto-approved against the documented spec (A7-03).

---

## Suggested remediation order

**P0 (security + data loss, do first).** S1 add auth to qbit/jellyfin/torznab routes and make `proxy.ts`
validate sessions; S2 fix and enforce `verifyOrigin` on all mutations; D1 give auto-delete an ownership key
before it can run; S3 force-password-change session gate; S4 stop returning `api_key` to the client.

**P1 (engine correctness + deploy).** D2 unique index on `monitored_items` (dedupe existing rows first);
D3 atomic `grabbing` status; F3 fix healthcheck + edge fragments; A20-01 auto_approved/auto_delete column
mismatch; move `media/scan`, subtitle download, and embedded-subtitle extraction to a job queue with caps.

**P2 (correctness + UX + cleanup).** F1 wire watch history (or remove the page); F2 tear down the AudioContext;
add `res.ok` handling broadly; add `error.tsx`/`not-found.tsx` + `aria-live`; enable image optimization; wire
or delete the no-op settings; delete the ~27 dead modules; fix continue-watching ordering; input-validation pass.

---

## Report index

01 auth-session · 02 browse-discover · 03 library-catalog · 04 player-playback · 05 party-play ·
06 requests · 07 downloads-torrents · 08 settings-shell-ui · 09 admin-users-rbac · 10 admin-config-monitoring ·
11 automation-engine · 12 indexers · 13 integration-proxies · 14 data-layer-security · 15 subtitles-global-opt ·
16 a11y-responsive-ux · 17 resilience-deadcode · 18 deploy-runtime-infra · 19 input-validation ·
20 temporal-correctness · 21 untrusted-input-handling

Notable verified-good (not defects): no SQL injection (column allowlists + bound params), migrations are
idempotent/transaction-guarded, OpenSubtitles and *arr API keys stay server-side, ffmpeg/ffprobe use argv
arrays (no shell), party server-authority/anti-echo model is sound, session DAL primitives (CSPRNG ids,
cookie flags, rotation) are correct, and the build is clean.
