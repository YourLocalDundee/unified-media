# Audit 15 — Subtitles + Ingestion Scanning + Global Optimization/Build Pass

Scope: subtitle scan/match/download subsystem, media ingestion scanner + filename parser, and a
whole-app optimization/build pass. App root: `/home/minijoe/dev/unified-frontend/app`.

## Summary

The subtitle subsystem is well-structured and reasonably defensive: the OpenSubtitles API key is
strictly server-side (never `NEXT_PUBLIC`, never imported into a client component), scan/download
scheduler is guarded against hot-reload double-registration, and **every** subtitle + media-scan API
route enforces `requireAdmin()`. `npm run type-check` passes clean (exit 0) and `npm run build`
succeeds (exit 0, Next 16.2.7 / Turbopack) with a single NFT-tracing warning.

The most significant correctness issue is in the **download pipeline**: a long-running synchronous
POST (`/api/subtitle/download`) runs the entire pending queue in-request (1s sleep per item + network
fetch) with no job/locking, so the admin "Download Pending" button hangs for minutes and a second
click double-runs the queue, racing the OpenSubtitles 5/day quota. The **embedded-subtitle extraction
route** is gated only by `requireAuth()` (not admin) and spawns an unbounded ffmpeg per request — any
logged-in user can drive CPU/disk. Several **filename-parser edge cases** (multi-episode ranges,
absolute anime numbering vs. SxxExx, year-in-title collisions) silently mis-tag items that then feed
bad titles into the OpenSubtitles search.

The headline **global-optimization** finding is that **`unoptimized` is set on all 17 `next/image`
usages**, fully bypassing the `images.remotePatterns` config in `next.config.ts` — TMDB/poster art is
shipped at full source resolution with no resizing or AVIF/WebP. Secondary items: the `/api/media/scan`
route runs full ffprobe + TMDB enrichment synchronously in-request, the Turbopack NFT warning indicates
the whole project is being traced into the standalone bundle (73 MB) via `transcode.ts`, and React
Query global defaults omit `retry`/`refetchOnWindowFocus` tuning.

## Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 9 |
| LOW | 7 |
| **Total** | **20** |

Build/type-check headline: **type-check PASS (exit 0)**, **build PASS (exit 0)**, 1 Turbopack NFT
warning (whole-project trace via `transcode.ts`).

---

## PART A — SUBTITLES + INGESTION (Logic flow + Buttons/Interactions)

### HIGH

**A15-H1 — `/api/subtitle/download` runs the whole queue synchronously in-request; no job, no lock, double-click double-runs the 5/day quota**
- Severity: HIGH
- File: `src/app/api/subtitle/download/route.ts:7-15`, `src/lib/subtitle/downloader.ts:92-116`
- What's wrong: The POST handler `await`s `downloadPendingSubtitles()`, which loops every `wanted` row
  with a mandatory `await setTimeout(1000)` per item plus a network search + download + file fetch.
  For N wanted rows this blocks the request for ≥ N seconds. There is no in-flight guard, so the admin
  UI button (`admin/subtitles/page.tsx:87-99`) clicked twice (or by two admins) runs the loop twice
  concurrently, each consuming OpenSubtitles' 5-downloads/day quota and racing `updateSubtitleStatus`.
- Why it matters: The fetch will appear to hang (no streaming/progress), is prone to proxy/gateway
  timeouts (BunkerWeb/Caddy), and concurrent runs burn the tiny free-tier quota and can mark the same
  want both `downloaded` and `failed` depending on interleaving.
- Suggested fix: Make the download pass a background job (kick off, return `202` immediately) with a
  module-level `isRunning` guard, and have the UI poll `/api/subtitle?filter=wanted` for progress.
  At minimum add an `isRunning` boolean lock in `downloader.ts` that early-returns if a pass is active.

**A15-H2 — Embedded-subtitle extraction route is `requireAuth()` only and spawns unbounded ffmpeg per request (DoS / resource exhaustion)**
- Severity: HIGH
- File: `src/app/api/media/subtitles/embedded/[id]/[streamIndex]/route.ts:29,59-71`, `src/lib/media-server/transcode.ts:421-446`
- What's wrong: Any authenticated (non-admin) user can hit this route for any `mediaId` + arbitrary
  `streamIndex`; on a cache miss it runs `ffmpeg -i <file> -map 0:<idx> -c:s webvtt`. There is no
  concurrency cap, no rate limit, and no per-user budget. Each request also runs a full `probeFile`
  first (another `ffprobe` spawn). A loop over indices/items multiplies ffmpeg processes.
- Why it matters: A single logged-in client can saturate CPU and fill `TRANSCODE_CACHE/.subs` by
  fanning out requests. ffmpeg/ffprobe are heavyweight; the host also runs transcode jobs.
- Suggested fix: Add a small concurrency limiter (e.g. `p-limit`) shared across extraction + probe,
  cap by user, and consider caching the probe result. The cache key (`mediaId/<idx>.vtt`) is safe
  (mediaId from DB, idx integer-validated), so traversal is not the issue — resource use is.

**A15-H3 — filename-parser mishandles multi-episode ranges (S01E01E02 / E01-E02); only the first episode number is captured**
- Severity: HIGH
- File: `src/lib/media-server/filename-parser.ts:18-29`
- What's wrong: The SxxExx regex `^(.+?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,2})` captures a single episode
  number. Double-episode files (`Show.S01E01E02.mkv`, `Show.S01E01-E02.mkv`, `Show 1x01-1x02`) are
  parsed as just E01; the `1xNN` style is not matched at all and falls through to the movie branch.
- Why it matters: The scanner writes the row with the wrong/absent episode number, and the subtitle
  scanner builds the OpenSubtitles query title from it (`scanner.ts:64`). A wrong S/E yields wrong or
  no subtitle matches and a mis-labeled library item.
- Suggested fix: Extend the regex to optionally capture a second episode token and the `NNxNN` form;
  store an episode range or at least the first episode of a multi-ep file deliberately.

**A15-H4 — Anime absolute-numbering collides with SxxExx detection and season is hard-coded to 1**
- Severity: HIGH
- File: `src/lib/media-server/filename-parser.ts:32-64`, `src/lib/media-server/scanner.ts:49-67,84-100`
- What's wrong: All three anime patterns (`Episode NNN`, `[Group] Show - NNN - Title`, `Show - NNN`)
  hard-code `season: 1`. The directory override in `extractSeriesFromPath` (`scanner.ts:62-64`) can
  flip the season for files under a `Season NN` folder, but absolute-numbered anime (e.g. `... - 416`)
  whose folder is not a `Sxx` dir keeps season 1 with episode 416. OpenSubtitles searches by IMDB ID
  + type only (`opensubtitles.ts:56-75`) and never sends season/episode, so the right *show* may match
  but never the right *episode* — for episodic anime this is effectively wrong-episode subs.
- Why it matters: Anime libraries (explicitly supported via the `anime` TV-root regex,
  `scanner.ts:29`) get systematically wrong S/E metadata, and subtitle matching cannot distinguish
  episodes because the search omits episode_number entirely.
- Suggested fix: Pass `season_number`/`episode_number` (the OpenSubtitles `/subtitles` endpoint accepts
  `season_number` + `episode_number`) into `buildSearchParams`/`searchSubtitles` for episodes; treat
  absolute anime numbering explicitly (season 1 + absolute episode) rather than by accident.

### MEDIUM

**A15-M1 — OpenSubtitles search never sends season_number/episode_number for episodes**
- Severity: MEDIUM
- File: `src/lib/subtitle/downloader.ts:12-19`, `src/lib/subtitle/opensubtitles.ts:49-97`, `src/lib/subtitle/types.ts:100-107`
- What's wrong: For an episode want, only `imdb_id` (the series IMDB), `languages`, `type=episode`, and
  HI flag are sent. `SubtitleSearchParams` has no season/episode field, so the search returns subtitles
  for the *series*, ordered by download count — usually the wrong episode.
- Why it matters: Episode subtitle downloads will frequently grab a popular-but-wrong-episode file.
  This is the core matching-correctness gap for TV.
- Suggested fix: Add `season_number`/`episode_number` to `SubtitleSearchParams`, populate them from the
  `subtitle_wants` row (store S/E on the want), and set them on the query string.

**A15-M2 — `created` counter in scanLibrary is unreliable (timestamp-equality heuristic)**
- Severity: MEDIUM
- File: `src/lib/subtitle/scanner.ts:82-86`, `src/lib/subtitle/monitor.ts:39-83`
- What's wrong: `created` is incremented when `existing.created_at === existing.updated_at`. Because
  `upsertSubtitleWant` sets both to the same `Date.now()` on insert, a freshly *inserted* row and a row
  that has *never been updated since insert* are indistinguishable. With `INSERT OR IGNORE`, an
  already-existing untouched want is counted as "created" on every scan.
- Why it matters: The admin UI reports inflated "new wanted" counts (`admin/subtitles/page.tsx:80`);
  misleading but not data-corrupting.
- Suggested fix: Have `upsertSubtitleWant` return `{ inserted: boolean }` from `result.changes` of the
  INSERT, and count that instead of comparing timestamps.

**A15-M3 — `hasExistingSubtitle` ignores forced/hi, so multi-variant wants are silently skipped**
- Severity: MEDIUM
- File: `src/lib/subtitle/scanner.ts:25-34,73-87`
- What's wrong: The scan dedupe query keys on `(jellyfin_item_id, language, status != 'failed')` only,
  but `upsertSubtitleWant` keys uniqueness on `(item, language, forced, hi)`. If a forced or HI variant
  exists, `hasExistingSubtitle` returns true and the normal variant is never created (and vice-versa).
- Why it matters: Inconsistent dedupe semantics between scan-time and upsert-time can drop legitimately
  distinct wants. Today the scanner only ever creates `forced=0,hi=0`, so impact is latent, but it is a
  correctness trap for any future forced/HI scan.
- Suggested fix: Make `hasExistingSubtitle` match the same key columns as the unique constraint
  (`forced`, `hi`), or drop it entirely and rely on `INSERT OR IGNORE`.

**A15-M4 — Downloaded subtitle content is written to disk without validation or atomic write**
- Severity: MEDIUM
- File: `src/lib/subtitle/downloader.ts:75-82`, `src/lib/subtitle/downloader.ts:21-45`
- What's wrong: `fetch(downloadResponse.link).then(r => r.text())` is written verbatim to
  `<base>.<lang>.srt` with no check that the response was OK, non-empty, or actually subtitle text
  (could be an HTML error page or gzip). `fs.writeFile` is non-atomic; a crash mid-write leaves a
  truncated `.srt` next to the media that the player will pick up.
- Why it matters: Corrupt/garbage subtitles get auto-loaded by Jellyfin/player naming convention; a
  half-written file is worse than none.
- Suggested fix: Check `res.ok` and content length, sniff for `WEBVTT`/SRT timestamp lines, and write
  to a temp file then `fs.rename` into place.

**A15-M5 — Download status response not checked for HTTP failure on the .text() fetch; `remaining===0` quota only warns**
- Severity: MEDIUM
- File: `src/lib/subtitle/downloader.ts:75`, `src/lib/subtitle/opensubtitles.ts:99-115`
- What's wrong: The final `fetch(link)` has no `.ok` check (an error body becomes "subtitle text").
  `getDownloadLink` logs a warning when `remaining === 0` but still returns the link and the loop keeps
  issuing further download requests for the rest of the queue, each guaranteed to 4xx once the quota is
  exhausted — marking the remainder `failed`.
- Why it matters: Quota-exhaustion turns the tail of the queue into spurious `failed` rows that will be
  retried (they're not `wanted` anymore, but the admin sees failures), and a bad link silently writes
  junk.
- Suggested fix: Bail the loop when `remaining === 0`; check `res.ok` before `.text()`.

**A15-M6 — `/api/media/scan` runs full ffprobe + TMDB enrichment synchronously in the request (confirmed)**
- Severity: MEDIUM
- File: `src/app/api/media/scan/route.ts:8-15`, `src/lib/media-server/scanner.ts:146-155`, `src/lib/media-server/enricher.ts:79-114`
- What's wrong: POST `await`s `scanAll()` (an `await probeFile()` per existing row — a synchronous
  ffprobe spawn each, no concurrency limit in `scanAll`) then `enrichAll()` (a TMDB call per un-enriched
  item with a 250ms sleep each). On a large library this is minutes of blocking work in one request.
- Why it matters: Same class as A15-H1 — request hangs, gateway timeout risk, no progress. Note the
  background chokidar watcher (`initWatcher`) already keeps the DB current, so this manual full-scan is
  redundant for new files and is dominated by enrichment.
- Suggested fix: Convert to a background job returning `202`; reuse `scanLimit`/`pLimit` inside
  `scanAll` so probes run concurrently; expose progress via `/api/media/stats`.

**A15-M7 — `scanAll` re-probes nothing useful: it only walks rows already in the DB, never the filesystem**
- Severity: MEDIUM
- File: `src/lib/media-server/scanner.ts:146-155`, `src/lib/media-server/scanner.ts:69-75`
- What's wrong: `scanAll` selects `file_path` from `media_items` and calls `scanFile` on each, but
  `scanFile` early-returns if the row already exists (`existing` check at line 73-74). So a "rescan"
  via `/api/media/scan` does effectively no work for already-known files and cannot pick up files added
  while the watcher was down (those aren't in the DB yet). Only the watcher's initial `ignoreInitial:false`
  pass discovers new files.
- Why it matters: The admin "scan" action does not do what its name implies (discover new media); it
  only triggers enrichment. New files added during a watcher outage are missed until restart.
- Suggested fix: Have `scanAll` walk `MEDIA_ROOTS` from disk (readdir) rather than the DB, so it finds
  files the watcher missed.

**A15-M8 — Subtitle scan/download admin actions have no double-submit / in-flight server guard; only client `disabled` state**
- Severity: MEDIUM
- File: `src/app/admin/subtitles/page.tsx:73-99`, `src/app/api/subtitle/scan/route.ts`, `src/app/api/subtitle/download/route.ts`
- What's wrong: Re-entrancy is prevented only by client `scanning`/`downloading` booleans. Two tabs,
  two admins, or a page reload mid-run can launch overlapping scans/downloads server-side (see A15-H1).
- Why it matters: Wasted work and quota; overlapping writes.
- Suggested fix: Server-side module-level run locks for both scan and download passes.

**A15-M9 — `/api/media/subtitles/[id]/[streamIndex]` indexes downloaded subs by *position*, fragile across additions**
- Severity: MEDIUM
- File: `src/app/api/media/subtitles/[id]/[streamIndex]/route.ts:37-42`
- What's wrong: `streamIndex` is treated as a positional index into the `ORDER BY language` result of
  downloaded subs. Adding a new language reorders the list, so a `<track>` URL minted earlier now
  points to a different language's file.
- Why it matters: Stale player track URLs can silently serve the wrong-language subtitle.
- Suggested fix: Key by the `subtitle_wants.id` or by `language`, not list position.

### LOW

**A15-L1 — OpenSubtitles `pickBestSubtitle` download_count normalization makes the tiebreaker nearly constant**
- Severity: LOW
- File: `src/lib/subtitle/opensubtitles.ts:120-138`
- What's wrong: `Math.min(download_count / 1_000_000, 9)` — almost all subs have download_count far
  below 1,000,000, so the term is a tiny fraction (<<1), making download_count an effectively useless
  tiebreaker between two non-trusted, same-HI candidates. The comment claims a "0–9 tiebreaker."
- Why it matters: Picks are essentially first-by-API-order among similar candidates rather than most
  downloaded. Minor quality impact.
- Suggested fix: Normalize relative to the max in the result set, or divide by ~1000.

**A15-L2 — `getApiKey()` returns `undefined`; `buildHeaders` sends `'Api-Key': ''` when unset**
- Severity: LOW
- File: `src/lib/subtitle/opensubtitles.ts:17-27`
- What's wrong: When the key is missing, `searchSubtitles`/`getDownloadLink` guard and bail early, but
  `buildHeaders` still constructs `'Api-Key': ''`. If any future caller skips the guard, an empty-key
  request would be sent. Harmless today.
- Why it matters: Defensive nit; an empty API key request to OpenSubtitles leaks the User-Agent and
  wastes a round trip.
- Suggested fix: Throw in `buildHeaders` (or `osFetch`) when the key is absent rather than sending `''`.

**A15-L3 — Movie title sanitizer strips non-ASCII, breaking accented/CJK titles for TMDB/OpenSubtitles**
- Severity: LOW
- File: `src/lib/media-server/filename-parser.ts:72`
- What's wrong: `.replace(/[^a-zA-Z0-9\s'-]/g, '')` removes accented letters (é, ñ, ü) and all CJK/
  non-Latin characters from movie titles. `Amélie` → `Amlie`, `君の名は` → ``.
- Why it matters: Non-English movie titles are mangled before enrichment (`searchMovie`) and subtitle
  search `query` fallback, reducing match rates for non-Latin content.
- Suggested fix: Use a Unicode-aware strip (`\p{L}\p{N}` with the `u` flag) instead of ASCII-only.

**A15-L4 — `cleanEpisodeTitle` QUALITY_TAGS regex truncates legitimate titles containing tokens like "4K", "AAC", or a year-like number**
- Severity: LOW
- File: `src/lib/media-server/filename-parser.ts:3-12`
- What's wrong: The `QUALITY_TAGS` alternation includes `\d{3,4}p`, `4K`, `AAC`, etc. and is anchored
  with `.*` to the end, so an episode title legitimately containing one of those tokens gets truncated
  from that point on.
- Why it matters: Rare, cosmetic mis-titling of episodes; does not affect S/E matching.
- Suggested fix: Require a word boundary / surrounding separators and only strip from the first
  *release-tag cluster*, not any occurrence.

**A15-L5 — `pad()` coerces null season/episode to "00" in subtitle titles**
- Severity: LOW
- File: `src/lib/subtitle/scanner.ts:14-16,64`
- What's wrong: For an episode row with null `season_number`/`episode_number` (parser failure), the
  title becomes `... S00E00 - ...`, which is a meaningless OpenSubtitles `query` and a confusing admin
  label.
- Why it matters: Cosmetic + slightly worse fallback search text.
- Suggested fix: Omit the S/E suffix when either is null.

**A15-L6 — Re-scanning a moved/renamed file orphans the old DB row; only `unlink` removes rows**
- Severity: LOW
- File: `src/lib/media-server/scanner.ts:120-123,141-142`
- What's wrong: The watcher removes a row on `unlink` and adds on `add`; an atomic move that fires only
  `add` (or a missed `unlink` during downtime) leaves a stale row pointing at a non-existent path. There
  is no reconciliation/prune step.
- Why it matters: Stale library entries linking to dead `file_path`s (playback 404). Low frequency.
- Suggested fix: A periodic prune that drops rows whose `file_path` no longer exists.

**A15-L7 — Embedded-subtitle route swallows probe errors then re-probes implicitly, double ffprobe on the happy path**
- Severity: LOW
- File: `src/app/api/media/subtitles/embedded/[id]/[streamIndex]/route.ts:43-60`, `src/lib/media-server/transcode.ts:421-446`
- What's wrong: The route calls `probeFile` to validate the stream, then `extractSubtitleToVtt` runs
  ffmpeg over the same file again (ffmpeg re-parses headers). On a cache miss that's a probe + a full
  ffmpeg parse. The probe result is discarded.
- Why it matters: Extra ffprobe spawn per cache-miss request (compounds A15-H2).
- Suggested fix: Cache/pass probe results; skip the validation probe when the `.vtt` is already cached
  (it short-circuits anyway, but the probe runs first regardless).

---

## PART B — GLOBAL OPTIMIZATION / BUILD PASS

Build/type-check: `npm run type-check` → **PASS (exit 0)**. `npm run build` → **PASS (exit 0)**,
Next.js 16.2.7 (Turbopack). Standalone output 73 MB; `.next/static` 3.0 MB. Largest client chunk
799 KB (the lazily-loaded zxcvbn chunk), 500 KB (recharts, isolated to the `/downloads` detail panel).
1 build warning (see G2).

### HIGH

**A15-G1 — ALL 17 `next/image` usages set `unoptimized`, bypassing the configured image pipeline (confirmed)**
- Severity: HIGH (global)
- Files: `next.config.ts:5-26` (configured remotePatterns) vs. `unoptimized` at
  `src/components/media/MovieDetailPanel.tsx:194,210`, `MediaCard.tsx:54`, `EpisodeCard.tsx:68`,
  `CastGrid.tsx:40`, `EpisodeRow.tsx:38`, `TvDetailPanel.tsx:169,185`,
  `src/app/library/[id]/page.tsx:75,92`, `src/app/browse/DiscoverResults.tsx:58`,
  `src/app/browse/[id]/page.tsx:121,140`,
  `src/app/browse/discover/[mediaType]/[tmdbId]/page.tsx:45,111,131,240`
- What's wrong: `next.config.ts` carefully whitelists `image.tmdb.org` and the Jellyfin host in
  `images.remotePatterns`, but every `<Image>` passes `unoptimized`, so Next never resizes, never
  serves AVIF/WebP, and never caches a derivative. Poster/backdrop/cast art is shipped at full source
  resolution. This is the sibling-audit "TMDB images unoptimized" finding, confirmed and global.
- Why it matters: Largest perceivable performance cost in the app — grids of full-size posters over
  mobile/cellular (the stated primary use case). Wastes bandwidth and LCP on every browse/library page.
- Suggested fix: Drop `unoptimized` and let Next optimize via the configured patterns; where the
  in-app `/api/media/image` proxy already exists (it sizes TMDB paths), route posters through it with
  explicit `width`/`sizes`. Pick one path (Next optimizer OR the proxy) and use it everywhere.

**A15-G2 — Turbopack NFT warning: whole project traced into the standalone bundle via `transcode.ts`**
- Severity: HIGH (global)
- Files: `next.config.ts` (trace root) → `src/lib/media-server/transcode.ts` →
  `src/app/api/media/subtitles/embedded/[id]/[streamIndex]/route.ts` (build.log:9-26)
- What's wrong: The build emits "Encountered unexpected file in NFT list … the whole project was traced
  unintentionally," rooted at `transcode.ts` (which uses `path.join`/`fs` against `process.cwd()`-ish
  dynamic paths). This is why the standalone output is 73 MB.
- Why it matters: Bloated container image, slower cold starts, larger deploys. Indicates dynamic
  `fs`/`path` operations are dragging the whole tree into the trace.
- Suggested fix: Statically scope the dynamic path ops in `transcode.ts` (e.g.
  `path.join(process.cwd(), 'data', x)`), or add `/*turbopackIgnore: true*/` to the offending dynamic
  `path.join`/`require`, as the warning instructs.

### MEDIUM

**A15-G3 — React Query global defaults omit `retry` and `refetchOnWindowFocus` tuning**
- Severity: MEDIUM (global)
- File: `src/app/providers.tsx:14-26`
- What's wrong: Only `staleTime` (30s) and `gcTime` (5min) are set. `retry` defaults to 3 (every failed
  query retries 3× with backoff — bad for the many always-failing optional integrations and for fast
  user feedback) and `refetchOnWindowFocus` defaults to true (re-fires every query on tab focus). The
  app already overrides these ad hoc in `DetailPanel.tsx:405-406`.
- Why it matters: Unnecessary refetch storms on focus and slow error surfacing across all client data
  fetching; redundant network on a polling-heavy app.
- Suggested fix: Set sane global defaults: `retry: 1`, `refetchOnWindowFocus: false` (or per-query
  opt-in for the live download/party views).

**A15-G4 — `/api/media/image` re-buffers upstream into an ArrayBuffer (no streaming) and is partly redundant with `unoptimized` direct loads**
- Severity: MEDIUM (global)
- File: `src/app/api/media/image/route.ts:30-46`
- What's wrong: The proxy fetches the upstream image and `await upstream.arrayBuffer()` fully buffers it
  in memory before responding, rather than streaming `upstream.body`. Meanwhile most posters bypass this
  route entirely because `<Image unoptimized>` loads `image.tmdb.org` directly (allowed by CSP
  `img-src`). So the app maintains a caching proxy it largely doesn't use for the heavy paths.
- Why it matters: Memory churn per image when the proxy *is* used; architectural inconsistency (two
  image paths). Tie-in with G1.
- Suggested fix: Stream `upstream.body` through; standardize on the proxy for all TMDB art and add
  `width`-aware sizing, or remove the proxy and use the Next optimizer.

**A15-G5 — Sidebar/Header/MobileNav/AppLayout are client components rendered on every route**
- Severity: MEDIUM (global)
- Files: `src/components/layout/Sidebar.tsx:4`, `Header.tsx:3`, `MobileNav.tsx:3`, `AppLayout.tsx:4`,
  `ConditionalLayout.tsx:4`
- What's wrong: The entire app shell is `'use client'`. `usePathname` is the only client need for the
  active-highlight + watch-page suppression; nav structure and links are static. 95 of 116 components
  are client components.
- Why it matters: Larger client JS for the shell shipped to every page; more hydration. The active-link
  logic could be a small client island inside an otherwise-server shell.
- Suggested fix: Keep only the pathname-dependent active-state and chrome-suppression as tiny client
  islands; render the static nav scaffolding as server components.

**A15-G6 — `getAllSubtitles` / library list queries use `SELECT *` and fixed `LIMIT 200` with no pagination**
- Severity: MEDIUM (global)
- File: `src/lib/subtitle/monitor.ts:18-30`, and the admin page loads all rows then filters client-side
  (`src/app/admin/subtitles/page.tsx:66-71`)
- What's wrong: The subtitle list endpoint returns up to 200 full rows; the client computes status
  counts by filtering the fetched array, so the displayed counts only reflect the (possibly filtered or
  truncated) 200-row window, not the true totals.
- Why it matters: Incorrect dashboard counts once >200 wants exist or when a status filter is applied
  (counts then reflect only that filter). Minor correctness + over-fetch.
- Suggested fix: Compute counts with a `GROUP BY status` query server-side; paginate the list.

**A15-G7 — TMDB enrichment is strictly serial with a 250ms sleep per item**
- Severity: MEDIUM (global)
- File: `src/lib/media-server/enricher.ts:92-111`
- What's wrong: `enrichAll` processes items one at a time with `await setTimeout(250)` each and two
  extra `SELECT tmdb_id` round-trips per item (before/after) purely to compute the `enriched`/`failed`
  counters. For a large unenriched backlog this is very slow and dominates `/api/media/scan`.
- Why it matters: Slow first-run enrichment; the redundant before/after selects double the DB ops.
- Suggested fix: Have `enrichItem` return whether it set a tmdb_id (drop the before/after selects); run
  with a small concurrency limit honoring TMDB's ~50 req/s budget instead of a flat serial 250ms.

### LOW

**A15-G8 — `lucide-react` is imported via named imports (fine in Turbopack, but worth pinning the pattern)**
- Severity: LOW (global)
- Files: e.g. `src/components/layout/Header.tsx:7`, `MobileNav.tsx:7`, many others
- What's wrong: Named imports from `lucide-react` (`import { Search, User } from 'lucide-react'`). Next
  16 + Turbopack tree-shakes these, so this is NOT a bundle bug today; flagged only because lucide is a
  classic barrel-bloat source if the bundler/config changes (e.g. `transpilePackages`/optimizePackageImports
  not configured explicitly).
- Why it matters: No current impact; preventative.
- Suggested fix: Optionally add `experimental.optimizePackageImports: ['lucide-react']` to lock the
  optimization in regardless of bundler defaults.

**A15-G9 — `recharts` (≈500 KB) ships in the `/downloads` detail panel client bundle**
- Severity: LOW (global)
- File: `src/app/downloads/components/DetailPanel.tsx` (only recharts importer)
- What's wrong: recharts is heavy and pulled into the downloads route. It is already route-split (not in
  the shared chunk), so impact is limited to that page, but the panel could lazy-load the chart.
- Why it matters: 500 KB on first open of the downloads detail panel.
- Suggested fix: `next/dynamic` the chart subcomponent with `ssr: false` so it loads only when the
  Overview/graph tab is opened.

**A15-G10 — `tsconfig` target ES2017 forces heavier down-leveling than the Node 24 / modern-browser runtime needs**
- Severity: LOW (global)
- File: `tsconfig.json:3` (`"target": "ES2017"`)
- What's wrong: With Node 24 runtime and modern evergreen browsers (the only consumers — this is a
  self-hosted LAN app behind auth), ES2017 down-levels async/await, optional chaining, etc. that could
  ship natively.
- Why it matters: Slightly larger/slower transpiled output; negligible but free to fix.
- Suggested fix: Raise `target` to `ES2022` (Next sets browser targets independently via SWC/Turbopack,
  but the TS target still affects emitted helpers in some paths).

**A15-G11 — No `images.formats`/`deviceSizes` tuning even before G1 is fixed**
- Severity: LOW (global)
- File: `next.config.ts:5-26`
- What's wrong: `images` config sets only `remotePatterns`. Once `unoptimized` is removed (G1), the
  default device sizes are broad; for a poster-grid app, custom `deviceSizes`/`imageSizes` + `formats:
  ['image/avif','image/webp']` would tighten output.
- Why it matters: Smaller derivatives once optimization is on.
- Suggested fix: Add `formats` and poster-appropriate `imageSizes` after enabling optimization.

---

## Notes / verified-safe (not findings)

- OpenSubtitles API key handling is correct: read only from `process.env.OPENSUBTITLES_API_KEY`
  server-side (`opensubtitles.ts:17`); no `NEXT_PUBLIC_*KEY/SECRET/PASS` anywhere; grep for
  `OPENSUBTITLES` in `*.tsx` is empty.
- Scheduler is leak-safe: `initSubtitleScheduler` guards with a module `started` flag
  (`scheduler.ts:12-16`); chokidar `initWatcher` guards with `if (watcher) return`
  (`scanner.ts:131`); both invoked once from `instrumentation.ts` under `NEXT_RUNTIME==='nodejs'`.
- Authz is correct on the audited mutating endpoints: `/api/subtitle`, `/api/subtitle/[id]`,
  `/api/subtitle/scan`, `/api/subtitle/download`, `/api/media/scan` all call `requireAdmin()`;
  the embedded + downloaded subtitle GET routes call `requireAuth()` (see A15-H2 re: that being too
  permissive for the ffmpeg-spawning embedded route).
- zxcvbn (~800 KB) is already lazily `import()`-ed only after the user types a password
  (`register/page.tsx:82`) — good; it is the 799 KB isolated chunk, not in the shared bundle.
