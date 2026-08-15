# Open Issues — reconciled register

Single source of truth for what is still broken or missing, reconciled against the live code on
**2026-06-16** (the docs were stale in several places). Supersedes the scattered status in
`CLAUDE.md` "Known Issues", `audit-2026-06-13/`, `FEATURE_STATUS.md`, and `implementation-status.md`
for the question "what is still open."

Sources scanned: `CLAUDE.md`, `../analysis/audit-2026-06-13/00..21`, `FEATURE_STATUS.md`,
`implementation-status.md`, `PARTY_PLAY_AUDIT.md`, `CHANGELOG.md`, `{claude-md-audit,stack-audit}.md`.

Severity tags mirror the audit (S = security, D = data/engine, F = functional, A##-## = audit finding id).

---

## Closed (verify when convenient, then delete from this list)

**2026-08-15 — Wiring-audit cleanup pass: dead code deleted, open-redirect guard consolidated —
plus a correction to the audit's dead-export methodology (commit `53caca8`)**
- Net −1083/+30 across 7 files. Deleted, all superseded by code that already shipped:
  - `app/src/app/admin/requests/AdminRequestsClient.tsx` — 962 lines, imported by nothing.
    `admin/requests/page.tsx` is now seven lines that `requireAdmin()` then `redirect('/requests')`.
  - `app/src/app/library/LibraryCard.tsx` (28 lines) and `app/src/app/requests/ApproveButton.tsx`
    (21 lines) — never imported.
  - The Zustand store's modal-player slice in `app/src/store/index.ts`: `openPlayer`, `closePlayer`,
    `currentItemId`, `isPlayerOpen`, `playerStartTicks`. Playback moved to the `/play/[id]` route;
    only the sidebar half (`sidebarOpen`/`toggleSidebar`/`setSidebarOpen`, used by
    `components/layout/Sidebar.tsx`) was ever read. Header comment updated to say so.
  - `app/src/lib/automation/grabber.ts`: `findSeasonPack` and `findArcPack` — thin wrappers that just
    returned `.best` from their `*Candidates` counterpart, called by nothing.
- **The open-redirect guard was consolidated, not deleted.** `app/src/app/login/page.tsx` carried its
  own copy of `getSafeRedirect`, annotated "mirrors `src/lib/safe-redirect.ts` but inlined here to
  avoid pulling a server-only module into a client component." That reason didn't hold —
  `safe-redirect.ts` is a pure function with no imports and nothing server-only. Result: the lib copy
  was dead while the inline copy did the work, i.e. two versions of a security check free to drift.
  The inline copy was the stricter of the two (rejected any colon; the lib version only rejected one
  before the first slash), so the lib version adopted the stricter blunt rule — with a comment
  documenting the trade (it also rejects an otherwise-legal path whose query string contains a colon;
  acceptable because redirect targets here are plain in-app paths, and it drops all position/ordering
  logic that could be subtly wrong). `login/page.tsx` now imports `getSafeRedirectUrl`; the inline
  copy is gone. CLAUDE.md's auth table already listed `src/lib/safe-redirect.ts` as the mechanism —
  that's now actually true.
- **IMPORTANT — a correction to the audit that prompted this work.** The wiring audit claimed all
  **four** grabber pack-finders (`findSeasonPack`, `findSeasonPackCandidates`, `findArcPack`,
  `findArcPackCandidates`) were dead, ~120 lines. **That was wrong.**
  `findSeasonPackCandidates`/`findArcPackCandidates` each have two live call sites *inside
  `grabber.ts` itself* — one from their wrapper, one from `searchCandidatesForItem`, which the
  season/arc grab-confirmation preview depends on. Deleting them was attempted and caught before it
  shipped. Only the two wrappers were genuinely unused; `scorePackPool` (non-exported helper) also
  stays because the surviving `*Candidates` functions call it. Four comments pointing at the removed
  wrappers were repointed rather than left dangling.
  - **Root cause:** the audit's detector counted references from **other files only**, so a symbol
    exported and consumed within its own module read as zero references.
  - **This is broader than this one case.** Any remaining "dead export" counts from this audit are
    unreliable and must be re-derived with same-file callers included before anything else is
    deleted on their say-so. The audit's headline figure of "45 exported symbols never referenced
    outside their own file" is exactly that flawed measure — it's a list of over-wide `export`
    keywords, **not** a list of dead code. Now tracked as its own open item — see "OPEN — Medium /
    Low remainder" below ("Wiring-audit '45 dead exports' figure must be re-derived before anything
    is deleted").
- **Verified.** `tsc --noEmit` clean, `eslint` clean on all changed files, 57 vitest tests pass, image
  rebuilt via compose, container recreated healthy. Post-deploy smoke test: `/api/auth/login`,
  `/library`, `/requests`, `/admin/requests`, `/login` all 200.

**2026-08-15 — Wiring-audit no-op settings, part 1: `sidebarLabels` and `hwAccel` wired; `skipIntro`
remains open (see the OPEN section below)**
- A wiring audit found three user-facing settings that rendered a control, persisted a value, and had
  **no consumer anywhere in the codebase**: `sidebarLabels` (Display), `skipIntro` and `hwAccel`
  (Playback). Two are now wired; `skipIntro` is blocked on a missing prerequisite feature and is tracked
  as a fresh open item rather than closed here.
- **`sidebarLabels` (commit `28b66a3`).** `app/settings/display/page.tsx` shows "Sidebar → Show Labels".
  Nothing read it — labels rendered whenever the sidebar was open, so the toggle did nothing.
  `src/components/layout/Sidebar.tsx`'s `SidebarNav` now takes a `showLabels` prop; a local
  `labelled = sidebarOpen && showLabels` gates the `<span>{label}</span>`. Turning the pref off gives an
  icon-only nav at full width. The `title` attribute (tooltip) now applies whenever the text is absent
  for **either** reason — collapsed sidebar, or labels off — where previously it keyed off the collapse
  state alone, so with labels off there would have been neither text nor tooltip.
- **`hwAccel` (commit `574fba4`).** `app/settings/playback/page.tsx` shows "Hardware Acceleration"
  (auto/software). Nothing read it: a non-h264 source always transcoded through VAAPI, and
  `transcode.ts`'s header comment explicitly said "there is no silent CPU fallback" — so a user had no
  way to force software transcoding when the render node misbehaves, which is exactly what the control
  offered.
  - Added tier D `full_software` to `src/lib/media-server/transcode.ts`: the same re-encode as tier C
    (`full_vaapi`) but `-c:v libx264 -preset veryfast -crf 23 -profile:v high -pix_fmt yuv420p`. New
    exported type `HwAccelMode = 'auto' | 'software'`; `chooseTier(videoCodec, audioCodec, hwAccel =
    'auto')` returns `full_software` instead of `full_vaapi` when the pref is `software`. Tiers A
    (`remux`) and B (`audio_transcode`) are untouched — they copy the video stream and never reach an
    encoder.
  - **Plumbing.** Playback prefs are localStorage-backed and therefore client-only, so the
    server-rendered stream URL can't carry the choice. `VideoPlayer.tsx` gained a module-scope
    `withHwAccel(url, hwAccel)` helper that appends `hw=software` to **HLS manifest URLs only** (a
    Direct Play URL is served straight from disk and never reaches an encoder), read via the existing
    `prefsRef` so the choice doesn't add a dependency to the player's init effect.
    `app/api/media/hls/[id]/[...slug]/route.ts` reads `?hw=` on the `master.m3u8` request and passes it
    to `ensureHls(..., hwAccel)`.
  - **Deliberate documented limitation.** The tier applies only to a transcode the call actually
    *starts*. The segment cache is keyed by `(mediaId, audioIdx)` and **not** by tier, so an
    already-cached transcode is reused regardless of the requester's preference. Rationale: both tiers
    emit equivalent h264, so a per-tier cache namespace would double disk use for no visible benefit —
    and segment URLs couldn't carry the parameter anyway, because hls.js resolves segment URIs relative
    to the manifest path, dropping the query string.
  - **Verified end-to-end** against a real HEVC source (an `x265` Avatar episode): requesting the
    manifest with `?hw=software` logged `start tier=full_software` and an ffmpeg command line containing
    `-c:v libx264 -preset veryfast -crf 23` with no `-vaapi_device`; the same request without the
    parameter logged `start tier=full_vaapi`. Both test transcodes were then killed and their cache
    directories removed.
- **`skipIntro` was investigated and found NOT wirable yet — not closed, see the new OPEN entry below.**
  `src/lib/media-server/playback.ts` returns a hardcoded `chapters: []` (the field exists on the type in
  `types.ts`, but chapter extraction was never implemented — matches the "Chapter extraction — chapters
  always returns []" gap in `implementation-status.md`). Wiring `skipIntro` needs chapter data first.
- Doc note: the general propagation pattern used for `hwAccel` — a localStorage-only pref appended as a
  query param on the HLS **manifest** URL, since segment URLs can't carry it — is written up in
  `../player/audio-subtitles.md` ("Client-only playback prefs on the HLS URL").

**2026-08-13 — Wiring-audit re-raise of A17-4 (cron try/catch) — NOT REPRODUCIBLE, obsoleted by a
dependency upgrade; A17-5 (no process-level rejection handler) genuinely fixed**
- A wiring audit re-raised **A17-4** from the 2026-06-13 audit
  (`../analysis/audit-2026-06-13/17-resilience-deadcode.md:104-118`): the automation scheduler's
  `cron.schedule` callbacks in `src/lib/automation/scheduler.ts` had no `try/catch` around their
  `await`ed bodies, so a rejection (indexer outage, qBit hiccup) would escape the async callback as an
  unhandled promise rejection on a recurring timer — at worst process-fatal.
- **Testing disproved it as currently applicable.** `node-cron` is pinned `^4.2.1` (installed 4.2.1).
  node-cron 4.x wraps every task execution in its own try/catch internally and routes failures to an
  `onError` handler that defaults to logging `[NODE-CRON][ERROR]` with a stack — confirmed by reading
  `node_modules/node-cron/dist/cjs/scheduler/runner.js` (`runAsync` and the surrounding catch blocks at
  lines ~79, ~97, ~161, ~173). A runtime proof was then run against the app's own installed node-cron: a
  task body that always rejects was scheduled every second, both unwrapped and wrapped in a manual
  `try/catch`. Result over the test window: `escaped=0, caught=2`. The unwrapped version did **not**
  produce an `unhandledRejection` — node-cron caught and logged it internally.
  - A17-4 was accurate when filed — node-cron 3.x (the version at audit time) did not catch async task
    errors — and was silently resolved by the later dependency upgrade to 4.x, not by any code change.
    It should not be re-raised as a live defect.
- **Change made anyway, for attribution — not because anything was crashing:** `safeCron(expression,
  label, body)` was added in `src/lib/automation/scheduler.ts` and all eight `cron.schedule` call sites
  were routed through it (labels: `grab`, `availability`, `import`, `upgrade-scan`, `import-lists`,
  `collections`, `reaper`, `auto-delete`). node-cron's default error handler prints a stack with no job
  identity, so all eight jobs previously shared one indistinguishable error shape in the log; the label
  now names the job that failed. This also keeps error behaviour owned by the app rather than inherited
  from a library default that could change under a future node-cron bump. The file's header comment was
  also stale (claimed "three background cron jobs" and "every 15 min — grab loop"; there are eight and
  the grab loop is every 5 min) and was corrected to list all eight schedules.
- **A17-5 is genuinely fixed, and is a different bug from A17-4.** A17-5
  (`../analysis/audit-2026-06-13/17-resilience-deadcode.md:120-132`) covers the *absence of a
  process-level safety net* — detached promises **outside** the cron ticks (the chokidar watcher, the
  party WebSocket server, other fire-and-forget work in `instrumentation.ts`) that node-cron's internal
  catch does nothing for. `src/instrumentation.ts` now registers `process.on('unhandledRejection', …)`
  (log and keep serving) and `process.on('uncaughtException', …)` (log, then `process.exit(1)` so
  compose's `restart: unless-stopped` brings the container back into a clean state). Do not conflate the
  two findings: A17-4 was disproved by an external version bump; A17-5 was real and is closed by this
  app-level code change.
- **Verified.** `tsc --noEmit` clean, `eslint` clean on both changed files (`scheduler.ts`,
  `instrumentation.ts`), all 50 vitest tests pass, image rebuilt via compose and container recreated
  healthy. Startup log shows `[automation] Scheduler started` with no errors.
- `../analysis/audit-2026-06-13/17-resilience-deadcode.md` is left unedited (frozen historical record,
  same precedent as `01-auth-session.md` for A1-005 above); this entry is the closure record for both
  A17-4 (not reproducible) and A17-5 (fixed).

**2026-08-13 — Wiring-audit XFF / rate-limit-bypass finding — NOT REPRODUCIBLE, disproven by testing**
- A wiring audit re-examined A1-005's fix (`getClientIp()` in `src/lib/client-ip.ts`, which reads the
  `parts.length - trustedProxyCount()`-th `X-Forwarded-For` entry, N defaulting to 2 for an assumed
  BunkerWeb→Caddy chain) and raised a **HIGH** finding: BunkerWeb is not currently deployed (mid-rebuild;
  it lands at rebuild step 12), Caddy is the only proxy, so N=2 reads one entry too far left and
  resolves to a client-forged value — supposedly letting an attacker rotate `X-Forwarded-For` to dodge
  every login/register/forgot/verify rate limit, same class of bug as the original A1-005.
- **Testing disproved it.** All three checks went through Caddy at `<app-host>` against
  `POST /api/auth/login`, reading the recorded `login_attempts.ip_address`:
  1. A single forged entry (`X-Forwarded-For: 203.0.113.99`) recorded the real peer `172.22.0.1`, not
     the forged value.
  2. Two forged entries (`203.0.113.99, 198.51.100.50`) still recorded `172.22.0.1` — if Caddy had
     appended to the header (the audit's assumption), N=2 would have picked the second forged entry.
     It did not.
  3. A request from a container at `172.22.0.3` with a forged header correctly recorded `172.22.0.3`,
     confirming real-client-IP attribution works end to end; earlier `172.20.0.1` rows seen in
     `audit_log`/`login_attempts` were host-originated test traffic, not evidence of broken attribution.
  - Root cause of the disproof: Caddy v2.11.4's `trusted_proxies` is unset, so it trusts nothing and
    **replaces** the inbound `X-Forwarded-For` with the direct peer rather than appending — the app
    only ever sees a single-entry chain, which `getClientIp`'s lower clamp
    (`Math.max(0, parts.length - N)`) resolves identically at **both** N=1 and N=2. The finding's
    premise (a reachable client-controlled entry at N=2) doesn't hold against the current edge.
- **Change made anyway, for accuracy/defence-in-depth — not because anything was broken:**
  `TRUSTED_PROXY_COUNT=1` was added to the deployment `.env` (`/home/joe/docker/unified-media/.env`,
  **outside this git repo** — grepping the repo for the variable only turns up `src/lib/client-ip.ts`
  and the `.env.local` example in `CLAUDE.md` §8), replacing a stale comment that read "leave unset
  until behind Caddy (step 9)" (step 9 shipped since). It's a functional no-op today; it becomes
  load-bearing only if Caddy's `trusted_proxies` is ever configured (Caddy would then preserve the
  inbound chain and it would grow). **Must be raised to `2` when BunkerWeb is reintroduced in front of
  Caddy at rebuild step 12.** Container was recreated and is healthy; behavior verified identical
  before and after the change.

**2026-08-13 — Wiring-audit dead-route finding (`/api/media/image`) — VALID, but the obvious
remediation was inverted: the route was deleted, not wired in**
- A wiring audit found `/api/media/image` (49 lines, `src/app/api/media/image/route.ts`) had **zero
  callers** while 16 call sites across the app built `https://image.tmdb.org/t/p/...` URLs inline.
  The route existed to prevent open SSRF by constraining the upstream URL — it required auth,
  allowlisted TMDB sizes (`w92`…`original`), and validated the path against
  `^/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|svg|avif)$`. Unlike the two entries above, this finding was
  **accurate** — the route genuinely was dead and its SSRF constraint genuinely bypassed by every
  caller.
- **The obvious remediation (route the 16 call sites through it) was analyzed and rejected as a
  regression; the route was deleted instead.** All 12 files that reference `image.tmdb.org` render
  through `next/image` (confirmed: no plain `<img>` call site, no `unoptimized` prop, no custom
  `loader` anywhere in the tree) — e.g. `app/library/page.tsx` builds the URL and passes it as the
  `imageUrl` prop to `components/media/MediaCard.tsx`'s `<Image>`. That means the request path is
  already `browser → /_next/image (same-origin) → server → image.tmdb.org`: the browser never talks
  to TMDB directly, and `next.config.ts` `images.remotePatterns` already pins the host to
  `image.tmdb.org` (and `www.themoviedb.org`) with pathname `/t/p/**`. The SSRF protection the
  deleted route provided was therefore already enforced by `remotePatterns` — which is *why* the
  bypass across 16 call sites went unnoticed.
- Wiring the route in would have cost real things for no security gain: keeping `next/image` on top
  of it means a double server hop (`/_next/image` → `/api/media/image` → TMDB) — two round-trips,
  two auth checks, extra memory churn on a 1 GB-limited container, for grids that load dozens of
  posters at once; switching to plain `<img>` to dodge the double hop would drop `next/image`
  resizing, WebP/AVIF conversion, and lazy loading entirely; and server-side image fetches traverse
  gluetun (TMDB isn't in `NO_PROXY`), so each extra hop is extra VPN bandwidth. The route's only
  unique contribution over `remotePatterns` was the size allowlist — an invalid size just 404s at
  TMDB, not a vulnerability.
- **Change made:** deleted `src/app/api/media/image/route.ts` and its now-empty directory. API route
  count went 119 → 118. Nothing in code referenced it; three historical docs mention it
  (`../complete/audit-v0.10.2-master-progress.md`,
  `../analysis/audit-2026-06-13/15-subtitles-global-opt.md`,
  `../analysis/audit-2026-06-13/03-library-catalog.md`) and were left unedited (frozen historical
  records, same precedent as `01-auth-session.md` and `17-resilience-deadcode.md` above).
- **Related observation, recorded as fact, not as a finding or a risk:** `/_next/image` is itself
  unauthenticated (returns 200 without a session), whereas the deleted route called `requireAuth()`.
  In practice this changes nothing — nothing used the route, so image loading was already
  unauthenticated end to end, and the content is public TMDB poster art already constrained by
  `remotePatterns`.
- **Verified.** `tsc --noEmit` clean, all 50 vitest tests pass, image rebuilt via compose and
  container recreated healthy. The route is absent from the built route manifest.
  `/_next/image?url=...image.tmdb.org...` still returns HTTP 200 `image/jpeg` (22,528 bytes),
  confirming posters still render through the optimizer.

**2026-06-23 (v0.10.2) — Bucket-1 loose ends** (see `../complete/bucket1-cleanup-session-2026-06-23.md`)
- **Grab-gate thresholds admin UI** — `gate_min_seeders` / `gate_max_size_movie_gb` / `gate_max_size_tv_gb`
  (v0.10.0 `app_settings` keys, previously SQL-only) now editable on `/admin/automation` → "Grab Gates"
  via the existing `GET`/`PUT /api/admin/settings`. 0 on a max-size disables that cap.
- **Blocklist admin page** — `/admin/automation` → "Blocklist": lists `grab_blocklist` rows with
  remove/unblock + a manual block form, over the existing `GET/POST/DELETE /api/automation/blocklist`.
- **Party queue reorder** — `PartyPanel` "Up next" rows gained move-up/down controls wired to the
  already-built `reorderQueue(itemId, toIndex)` op (chose move buttons over drag for touch reliability).
- **Episode subtitle matching** — on-demand search now uses the **series** IMDB id + season/episode
  (`parent_imdb_id`/`season_number`/`episode_number`) instead of the weak per-episode imdb id.
- All four are `type-check` + `lint` (error level) + `build` clean. **Not done (carried over):** the
  two-browser Party auto-advance manual test — needs a human at two clients, not codeable headless.

**2026-06-23 (v0.10.1) — importer log-spam / item stuck on empty `info_hash`** (working tree)
- **Fix (a) — the unstick.** `importer.ts` no longer log-and-skips a grabbed item whose `info_hash` is the
  empty string (or missing). It now leaves `torrent` undefined for any hashless item and falls through to the
  **same fallbacks used for departed torrents**: detect it already reached the library by `tmdb_id`, else match
  the completed file by title in `/media/downloads/complete` and import it. The misleading
  `"No info_hash found … skipping"` line is gone; the residual fallback log now reads accurately
  (`"… (no info_hash recorded) not in qBt and not in library — … awaiting manual import"`).
- **Fix (c) — stop writing hashless rows.** `recordGrab()` (`monitor.ts`) now recovers the infohash centrally
  from a magnet's `urn:btih:` (40-char v1 hex **and** 32-char base32) via a new `urls` field, used when the
  explicit `info_hash` is empty. Wired at all **6** grab sites: cron `grabber.ts`, `grab/season` override +
  both pack paths, `requests/[id]/grab` override, and `requests/[id]/approve` preferred-grab. magnet/URL adds
  now persist the real hash so the importer's **primary** `setLocation` path works. A `.torrent`-download-URL
  add is genuinely hashless until qBit computes it post-add — those still record empty and rely on fix (a)'s
  by-title fallback by design.
- **Existing stuck row.** Self-heals via fix (a): the next import tick matches item 7's completed file by title
  (or detects it already in the library) and marks it `imported`, so the every-2-min spam stops with **no
  manual DB surgery**. If that item's download genuinely never completed, it stays `grabbed` but logs the
  accurate "awaiting manual import" line, not the old false "No info_hash found".
- **Deliberately not done:** option (b) (terminal `failed` state after N misses). It's a backstop, not the root
  cause, and a blind miss-counter would wrongly fail an item whose torrent is merely slow to finish. Revisit
  only if a real hashless-and-never-completing case shows up.
- **Verified.** `type-check` + `lint` clean; `resolveInfoHash` logic unit-checked across explicit/magnet-hex/
  magnet-base32/torrent-URL/empty cases. Source: `importer.ts`, `monitor.ts` (`recordGrab`/`resolveInfoHash`),
  the 4 grab routes.

**2026-06-23 (v0.10.1) — lint cleanup**
- **All 78 `eslint-plugin-react-hooks` v6 warnings fixed with real code changes (no suppressions)** and the
  four React-Compiler-era rules (`set-state-in-effect`, `refs`, `purity`, `immutability`) promoted from
  `warn` back to `error` in `eslint.config.mjs`. `lint` (error level) + `type-check` + `build` all green;
  behavior preserved. Patterns used (setTimeout-deferral, during-render adjust, `useSyncExternalStore`,
  lazy init, live-ref bridges) are documented in CLAUDE.md §7 "react-hooks rules enforced at error" and
  `analysis/lint-cleanup-session-2026-06-23.md`. This closes the only open follow-up from the 2026-06-22
  decision-engine/party-queue session.

**Before the 2026-06-15 session**
- `verifyOrigin` `startsWith` bypass (A1-002) — `csrf.ts` is exact-match now.
- **F1 watch history empty** (A3-01, A20-03) — `watch_events` is now written in
  `media-server/library.ts:212`. Confirm the `/history` + admin-stats read path matches the new rows.
- Rate-limiting audit item — done.

**This session (2026-06-15) — working tree, not yet committed**
- **D2** `monitored_items` duplicate rows (A6-02, A11-C2) — scope-aware `UNIQUE(tmdb_id,type,scope_key)`
  index + backfill/merge migration + `createItem` fetch-or-create. Smoke-tested against `better-sqlite3`.
- **D1** auto-delete destroying user-owned media (A11-C1) — two ownership guards in `auto-delete.ts`
  (skip when another active request shares the title; never touch files added before the request).
  Smoke-tested.
- **S1 (partial)** auth gates added to the qbit proxy, torznab search, and the 4 ungated the old media server
  metadata/image routes. (Note: `stream`/`playback`/`subtitles`/`sessions/*` were already gated via
  `getSession()` — the audit/CLAUDE list overstated this one.)
- **S2 (partial)** `verifyOrigin` added to all 5 requests routes + the 5 indexer routes.
- **S4** indexer `api_key` no longer returned to the browser (`redactIndexer` + PATCH "empty = keep").
- **A6-03** approve rejects non-pending (409). **A6-08** year guard → 422 + `code`. **A6-10**
  deterministic item resolution. **A6-12** grab-override URL validation. **A7-03** interactive picks
  go to the admin queue per the spec (also removes the A6-06 orphaned-download race).

**2026-06-19**
- **P1** Heavy work in request handlers (A10-08, A15-H1/H2, A19-H1) — `POST /api/media/scan` and
  `POST /api/subtitle/download` now enqueue background jobs via `src/lib/jobs/queue.ts` (FIFO,
  max-1 concurrency) and return `202 { jobId }` immediately. Callers poll `GET /api/jobs/[id]`.
  Embedded subtitle ffmpeg extraction (`extractSubtitleToVtt`) is now capped at 2 concurrent
  processes via `pLimit(2)` with a double-check inside the limit slot to avoid redundant extractions.
- **a11y (A16)** — focus-trap/restore/Escape is fully wired (`useFocusTrap`) on all modals (all
  were already done). `Modal.tsx` close button got `aria-label="Close"` + `aria-hidden` on the icon.
  Light-theme contrast fixed: 5 page roots (`bg-zinc-950 text-white` → `bg-background text-foreground`),
  request table expansion rows (`bg-zinc-950` → `bg-card`), TorrentPickModal container + sticky header
  (`bg-zinc-950` → `bg-card`). Video player chrome kept hardcoded dark (correct — always dark).
- **Doc drift** — `FEATURE_STATUS.md` watch party line corrected (`[ ]` → `[x]`). Version bumped to
  0.9.8 in `package.json` and CLAUDE.md header. CLAUDE.md "Known Issues" remediation note updated to
  reflect all criticals/P1 closed.
- **No-op settings (A08)** — all wirable settings now wired:
  - *Sidebar*: `sidebarCollapsed` seeds Zustand `sidebarOpen` on mount via `useDisplayPrefs`. `browsePageSize` Zustand slice removed (no readers).
  - *Home carousels*: `showContinueWatching` / `showRecentlyAdded` now show/hide the Continue Watching and Recently Added sections. `carouselLimit` slices both carousels client-side. `showNextUp` removed from settings UI (no Next Up section exists). Home sections refactored through `ContinueWatchingCarousel` / `RecentlyAddedCarousel` client components in `app/HomeCarousels.tsx`.
  - *Library cards*: `showTypeBadge` / `showYear` wired through new `LibraryCard` client component; `MediaCard` accepts `showTypeBadge`/`showYear` props (default true).
  - *Light-theme page roots*: `bg-zinc-950 text-white` replaced by `bg-background text-foreground` on 5 pages (search, library, requests, browse, browse/discover).
  - *VideoPlayer playback prefs*: `resumeMode` (resume/restart/ask + dialog), `autoPlayNext` (gate the next-episode fetch), `autoPlayDelay` (countdown length; 0 = navigate immediately), `quality` (pref bitrate matched to best available quality option on mount), subtitle appearance (`subtitleSize`/`subtitleBg`/`subtitleColor`) wired via inline `::cue` style.
  - *Not wired*: `defaultView` (list view layout not yet built), `posterSize` (no grid column count hook), `hwAccel` (server-side transcoding decision, out of scope), `skipIntro` (no intro-detection system).

**2026-06-16 (two subagents) — working tree, type-check + build clean**
- **S2 (rest)** `verifyOrigin` now on every remaining mutating route (admin invites/settings/users/*,
  automation/*, the old media server sessions/*, media playback/progress/scan, quality-profiles/*, subtitle/*).
  Only `the old request app/webhook` is intentionally excluded (external caller).
- **S3** confirmed already correct — `requireAuth()` redirects `force_pw_change` sessions to
  `/change-password`, and that one route uses `getSession()` so the flag can be cleared. No bypass.
- **D3** atomic grab claim — `monitored_items.status` gained `'grabbing'` (idempotent CHECK-widening
  recreation; data-preservation smoke-tested), `grabItem` claims `wanted→grabbing` and bails on
  `changes===0`, with a release-on-failure; manual admin grabs pass `force:true`.
- **A20-01** quick+interactive approvals now set `auto_approved=1` so the auto-delete query and slot
  accounting stay consistent.
- **A19** `req.json()` parse guards (400) added broadly; Range header was already validated; pagination
  already capped.
- **A7-04** client mutations check `res.ok` (qbit hooks, downloads page, admin user actions, settings
  save) and surface errors instead of false success.
- **A16/A17** added `error.tsx` / `global-error.tsx` / `not-found.tsx` / `loading.tsx` + aria-live regions.
- **A17-B** deleted 17 confirmed-dead modules (each verified zero importers). `JoinByCodeModal` was
  **kept** — the audit was stale, it is live via `JoinPartyButton` on the home page.
- **Images** removed `unoptimized` from all 5 live `next/image` files (all srcs are TMDB, already in
  `remotePatterns`).
- **A6-18** progress polling stops at terminal state + backoff; grab-results load moved to `useEffect`.
- **A7-13** `useMainData` pauses on hidden tab + honors the user refresh interval.
- **A7-02** download-client registry fails clearly for transmission/deluge (+ `isDownloadClientImplemented`).
- **A7-11** `clearSession()` before throwing on a failed 403 re-auth retry (no login storm).
- **A20-02** continue-watching orders by `updated_at` (was always-NULL `last_played`).
- **A9-04/A21** CSV exports neutralize `= + - @` formula injection.
- **A7-07** `match-torrent` input capped + LIKE wildcards escaped.
- **F3** deploy: `curl` healthcheck (in `docker-compose.fragment.yml`, not the Dockerfile) → `node -e`
  one-liner; party `ws` route added to `caddy.fragment`.

---

## OPEN — Critical / P0

- **`proxy.ts` validates only cookie presence** (A14, the original S1/S2 framing) — **by design, not a
  fix target.** Per the DAL pattern (CVE-2025-29927) the proxy is a UX redirect guard only and cannot
  use better-sqlite3 in the edge runtime. The real gate is per-route `requireAuth`/`requireAdmin`,
  which is now complete (S1/S2 done). Leave as-is; documented in CLAUDE.md §7.
- *(S1, S2, S3, S4 are all closed — see the Closed section.)*

## OPEN — P1 (engine correctness + deploy)

*(All P1 items closed — see Closed section.)*

## OPEN — P2 / systemic

- **No-op settings — all wirable prefs now closed** (A08-H1/H2/H3/H4, A7-05) **CLOSED 2026-06-19–20**:
  - Torrent Interface tab: `/downloads/page.tsx` loads `unified-torrent-prefs`, wires `sortColumn`/`sortReverse`/`rowsPerPage`/`confirmDelete`/`confirmDeleteFiles`. Delete confirm replaced with `DeleteConfirmModal` offering "Delete torrent only" / "Delete torrent + files".
  - `defaultView`: `/library` has a grid/list toggle via `?view=` URL param; list view renders a compact linked list with thumbnail.
  - `posterSize`: wired through `LibraryViewLayout` client component; small/medium/large map to different responsive grid column counts.
  - `hwAccel` — **CLOSED 2026-08-15** (see the Closed section above): tier D `full_software` added to
    `transcode.ts`, propagated via `?hw=software` on the HLS manifest URL.
  - `skipIntro` — **still open**, moved below to "OPEN — Medium / Low remainder" with its dependency
    chain; the earlier "leave as-is" framing undersold it as a decision rather than a missing
    prerequisite.
- ~~**`S`/`N` shortcuts**~~ — **CLOSED 2026-06-20**: `S` cycles subtitle tracks (off→0→1→…→off) and `N` skips to next episode. Both bound in VideoPlayer keydown handler via `nextEpisodeRef` (keeps closure current). Shortcuts page expanded with all real bindings (K/J/L/,/./0-9/I/Shift+arrows).

## OPEN — Medium / Low remainder

- **`skipIntro` no-op setting (Playback prefs)** — `app/settings/playback/page.tsx` renders a "Skip
  Intro" toggle that persists to `usePlaybackPrefs` but has **no consumer**: the control is live and
  currently does nothing when toggled. Blocked on a dependency chain, not a decision:
  1. **Chapter extraction** — `src/lib/media-server/playback.ts` returns a hardcoded `chapters: []`.
     The field exists on the `PlaybackData` type (`types.ts`) but nothing populates it; needs ffprobe
     `-show_chapters` wired through `probe.ts` into `playback.ts`. Tracked separately in
     `implementation-status.md`'s "Known remaining gaps".
  2. **Intro detection** — once chapters exist, something has to identify which chapter (if any) is the
     intro; not designed yet (chapter titles are inconsistent across sources, so this likely needs a
     heuristic, not just "chapter 2").
  3. **Wire the toggle** — only after 1 and 2 exist does `skipIntro` have data to act on (e.g. auto-seek
     past the intro chapter on load, or surface a "Skip Intro" button during it).
  - This is a feature to build, not a wiring task. See the 2026-08-15 entry in the Closed section above
    for the sibling `sidebarLabels`/`hwAccel` closures from the same audit pass.

- **`media-server` barrel import boundary is unenforced** — `src/lib/media-server/index.ts`'s own
  header states consumers "should import from this barrel file rather than individual modules so
  internal module boundaries can be refactored without touching call sites" and re-exports 10
  symbols. Measured 2026-08-15: exactly **1** import in the whole tree goes through the barrel
  (`tmdbImageUrl` in `app/page.tsx`); **58** imports reach past it directly into
  `@/lib/media-server/<module>` (`scanner.ts`, `enricher.ts`, `library.ts`, `tmdb.ts`,
  `transcode.ts`, `playback.ts`, …). The boundary the header describes doesn't exist in practice.
  Nothing is broken today — this is an architecture-intent mismatch, not a bug — so this is a
  decision, not a task:
  - **Route imports through it** — rewrite the 58 direct imports to go through the barrel, making the
    stated boundary real. Mechanical but wide-reaching; touches many files for no behavioural change.
  - **Delete the barrel and its claim** — accept direct module imports as the actual convention and
    remove a file whose documented contract is fiction. Smaller, and arguably more honest.

- **Wiring-audit "45 dead exports" figure must be re-derived before anything is deleted** — currently
  only a caveat buried inside the 2026-08-15 Closed entry above ("Wiring-audit cleanup pass…");
  promoted here so it's tracked as actionable work rather than a footnote. That audit's detector
  counted **cross-file references only**, so a symbol exported and consumed within its own module
  read as zero references — exactly how it wrongly flagged `findSeasonPackCandidates` /
  `findArcPackCandidates` as dead and nearly shipped a deletion that would have broken the season/arc
  grab-confirmation preview (caught before it shipped — see that entry for the full story).
  1. The audit's headline "45 exported symbols never referenced outside their own file" is a list of
     **over-wide `export` keywords**, **not** a list of dead code.
  2. It must be **re-derived with same-file callers counted** before any of the 45 are acted on.
  3. For whatever survives re-derivation as genuinely unreferenced, the correct remediation is to
     **drop the `export` keyword** (narrowing the module's public surface) — **not** to delete the
     function.

- **`sessions.device_name` column is written by nobody and read by nobody** — verified 2026-08-15: of
  the schema's 194 columns, `device_name` is the only one that appears nowhere outside
  `src/lib/db/migrations.ts:688` (`ALTER TABLE sessions ADD COLUMN device_name TEXT`). Nothing
  populates it at session creation and nothing reads it. Two options:
  - **Populate it** — set it from the `User-Agent` header in `createSession()` (`src/lib/dal.ts`).
    The more useful option: a session-management surface already exists and would benefit —
    `GET /api/auth/profile/sessions` lists active sessions, `DELETE /api/auth/profile/sessions/:id`
    revokes one, `POST /api/auth/profile/sessions/revoke-others` revokes the rest (CLAUDE.md §11) —
    and right now that list has no way to tell one session from another, which makes "revoke this
    one" close to guesswork for the user. A small genuine feature, not just cleanup.
  - **Drop the column** in a migration if the session list is never going to show device names.

- **A7-10** two parallel qBit SID caches — left separate by design (different lifetimes/credential
  sourcing); the `clearSession`-on-failed-retry fix (A7-11) was applied to both. Unify only if revisited.

**CLOSED 2026-06-20 (medium/low triage):**
- **A21-02** CSS injection via custom theme colors — `buildCustomThemeCSS` now sanitizes all six color fields through `sanitizeColor(val, fallback)` (rejects anything not matching `#[0-9a-fA-F]{3,8}`).
- **A21-08** Unguarded `JSON.parse` in grabber — all 5 call sites in `grabber.ts` now wrapped in try/catch with `Array.isArray` guard; malformed DB columns fail safely instead of crashing the cron.
- **A15-M4/M5** Subtitle file write — added `r.ok` check on the download link fetch, basic SRT validation (content must begin with a digit), and atomic write (write to `.pid.tmp` then rename).
- **A7-15** TorrentPickModal season/episode re-search — `runSearch` now uses an `AbortController` ref; each call aborts the previous in-flight search so rapid dropdown changes don't produce stale overwrites.
- **A8-M2** Dead the old media server URL override — section marked disabled + "not yet wired" label; controls non-functional to prevent user confusion.
- **A8-L1** Sidebar whole-store subscription — replaced `useAppStore()` with 3 atomic selectors (`s => s.sidebarOpen`, `s => s.setSidebarOpen`, `s => s.toggleSidebar`).
- **A8-L6** Button `aria-busy` missing — added `aria-busy={isLoading ?? undefined}` to Button component.

**CLOSED 2026-06-20 (rounds 2–3):**
- **A16-M9** MediaCard onClick non-keyboard-operable — `onClick` path now renders `<button type="button">` instead of `<div onClick>`. Shared visual content extracted into `content` fragment; `<Link>` path unchanged.
- **A4-M1** HLS resume seek jump — `prefsRef` ref added (synced via effect to current `prefs`). In `MANIFEST_PARSED`, when `resumeMode === 'resume'` and position > 30s, seek is applied before `video.play()` so HLS starts at the right position without a 0→resume jump. `ask`/`restart` cases still handled by `handleLoadedMetadata`.
- **A4-M6** Subtitle delay control — already implemented (cue timestamp shifting via `useEffect`, `WeakMap` for originals). Closed retroactively; was listed as open in error.
- **A21-07** Log forging via unsanitised newlines — `sanitizeLog(s)` helper (strips `\r\n`) applied to all `item.title` and `filePath` interpolations in `scanner.ts` and `grabber.ts`.
- **A21-04** Polynomial backtracking in parsers — input length capped at 512 chars in `parseFilename`, `extractTitle`, and `parseReleaseName` before running any regex.

**CLOSED 2026-06-20 (rounds 4–5):**
- **A21-05** xml2js parsing unbounded indexer XML — `MAX_XML_BYTES = 5 MB` guard added in `parseXml`; oversized responses are logged and skipped before xml2js is invoked.
- **A20-06** formatDate overload ambiguity — shared `formatDate(value: string | number)` in `lib/utils.ts` widened to accept either type; `formatDateShort` added for the short-month variant. `RequestsTable.tsx` local copy removed; now imports `formatDateShort` from utils.
- **A15-M7** scanAll re-probes nothing useful — replaced the old DB-row iteration (which hit `scanFile`'s early-return guard on every row) with a real filesystem walk via `walkDirectory` (recursive `fs.readdir`). `scanAll` now walks all `MEDIA_ROOTS` directories and discovers files added during watcher downtime. `knownRoots` set before walk so type resolution works correctly.

*(All Medium/Low audit items from the triage list are now closed.)*

---

## Partials / genuinely in progress

- **Download clients** — DONE (2026-06-27). Transmission (RPC) + Deluge (JSON-RPC) now fully implement
  the `DownloadClient` interface; registry instantiates all three; per-client `*_URL/*_USERNAME/*_PASSWORD`
  env vars with UMT_* fallback. See `analysis/backlog-buildout-progress.md` (2a).
- **Subtitle search** — DONE (v0.9.11). Server-side auto-download plus on-demand player search with live
  `<track>` injection (IMDB id resolved server-side); served by stable `subtitle_wants.id`. See CLAUDE.md §10b.
- **Theme marketplace** — DONE (2026-06-27). `encodeThemeShare`/`decodeThemeShare` (`umt-theme-v1:` URL-
  safe unicode codec, color-sanitized import) + wired Share/Import UI in ThemeSection. (2b)
- **Keyboard shortcut reference** — DONE (2026-06-27). `PLAYER_SHORTCUTS` registry (`src/lib/shortcuts.ts`)
  is the single source; `/settings/shortcuts` is generated from it; player cases annotated to ids. (2c)
- **Admin audit-log CSV export** — DONE (already shipped). `api/admin/audit/export` + Export button on
  `/admin/audit` already existed; this line was stale. (2d)
- **Independence build is past MVP** — decision **gate-chain + rejection reasons**, **real custom
  formats** (language/group/size/flags), and **blocklist** shipped v0.10.0 (CLAUDE.md §17);
  **notifications** v0.11.0 (§18); **upgrade-until-cutoff** v0.11.0 + **proper/repack** (2026-06-27, 3a);
  **auto-retry on failed grab** (reaper.ts: blocklist+reset-to-wanted+max-attempts — was already shipped,
  3b); **indexer health/backoff** (2026-06-27, 3c); **import lists** Trakt/RSS (2026-06-28, 3d). Still NOT
  built from the mining docs: per-indexer request-rate limiting, voice chat, movie Collections.

## Feature backlog (CLAUDE.md §13 + feature-mining)

Not defects. **SHIPPED v0.10.0** from the mining list: decision gate-chain + rejection reasons (Tier-1 #1),
real custom formats (Tier-1 #2), Party Play shared queue with auto-advance (Tier-1 #3). Remaining top
candidates: voice chat, Discord/ntfy notifications, upgrade-until-cutoff, blocklist auto-retry, indexer
health/backoff. See retired design notes.

---

## Doc drift

*(All three doc-drift items closed 2026-06-19 — see session notes above.)*
