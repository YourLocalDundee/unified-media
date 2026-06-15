# Audit 03 — Library & Native Media Catalog (owned-items surface)

Scope: `/library`, `/library/[id]`, `/history`; the `api/media/{items,items/[id],items/[id]/similar,series/[id]/next-episode,seasons/[seasonId]/episodes,stats,filters,image}` routes; the `media/*` catalog components; and `lib/media-server/{library,index,tmdb,enricher}.ts`.
Date: 2026-06-13 · Auditor lens: logic flow / buttons & interactions / optimizations.

## Summary

The owned-items surface is mostly wired correctly — routing obeys the Library-vs-Browse rule (series → `/library/[id]`, movies → `/play/[id]`), the play/watch safety nets exist, and the image proxy is SSRF-hardened. But three structural defects break whole features rather than edges:

1. **Watch History page is permanently empty for native playback.** `/history` reads `watch_events`, but *nothing in the codebase ever writes to `watch_events`* — the native player records progress into `media_watch_state` only. (A3-01, CRITICAL.)
2. **The season→episode carousel is dead.** The `seasons/[seasonId]/episodes` route filters on `type = 'season'`, but the scanner never creates `season` rows (only movie/series/episode). The endpoint always returns `[]`, and the entire `EpisodeCarousel → EpisodeCard → EpisodeToolbar` chain that depends on it is also orphaned (never mounted). (A3-02, A3-03.)
3. **Continue-Watching order is undefined.** `getResumeItems` orders in-progress rows by `last_played DESC`, but `last_played` is always `NULL` for in-progress rows, so order is arbitrary. The series resume picker and the `next-episode` endpoint also have correctness gaps. (A3-04, A3-05, A3-06.)

Plus the genre filter that is computed but discarded, several `localeCompare`/lowercase sort inconsistencies, two N+1 enrichment loops, and a missing composite index for the per-season episode join.

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 5 |
| MEDIUM | 7 |
| LOW | 5 |
| **Total** | **18** |

---

## CRITICAL

### A3-01 — Watch History page is always empty (no writer for `watch_events`)
**Severity:** CRITICAL
**File:** `src/app/history/page.tsx:48` (reader) · `src/app/api/auth/history/route.ts:37` (query) · `src/app/api/media/progress/route.ts:23` (where the native player actually writes)
**What's wrong:** The `/history` page fetches `/api/auth/history`, which queries `watch_events`. A whole-tree grep for `INSERT … watch_events` / `REPLACE … watch_events` returns **zero writers** — the only statements touching the table are `DELETE FROM watch_events` (`api/admin/users/[id]/route.ts:32`) and the schema `CREATE`. The native player's progress beacon (`/api/media/progress` → `upsertWatchState`) writes only to `media_watch_state`. `VideoPlayer.tsx` posts nothing to any history/event endpoint.
**Why it matters:** Every native play/finish leaves `watch_events` untouched, so the user-facing Watch History page renders the empty state ("No watch history yet") forever, and the per-page "watched this page" / `data.total` counters are always 0. The same dead table feeds the admin "Watches" tab and activity stats, so those are blank too. This is a fully built feature with no data source.
**Suggested fix:** Have the native progress path also record a `watch_events` row. Either (a) write/upsert a `watch_events` row inside `/api/media/progress` (mapping `position_ticks`/`runtime_ticks` → `watched_sec`/`duration_sec`/`progress_pct`, `played` → `completed`, joining `media_items` for `item_title`/`series_title`/`season_num`/`episode_num`), or (b) repoint `/api/auth/history` to derive history from `media_watch_state` JOIN `media_items`. Option (a) keeps admin tooling working with one write site.

---

## HIGH

### A3-02 — `seasons/[seasonId]/episodes` always returns `[]` (scanner never creates `season` rows)
**Severity:** HIGH
**File:** `src/app/api/media/seasons/[seasonId]/episodes/route.ts:30-39` · scanner: `src/lib/media-server/scanner.ts:87-113`
**What's wrong:** The route first looks up `media_items WHERE id = ? AND type = 'season'` and early-returns `[]` if not found (line 37-39). The scanner only ever inserts rows of type `series` (line 98) and `movie`/`episode` (line 103); it creates **no** `season` row. (Confirmed: `grep -o "'season'" scanner.ts` → 0 hits.) So `season` is missing → every call short-circuits to `[]`.
**Why it matters:** Any UI that drives the native episode carousel from a season ID gets an empty list. Combined with A3-03 the whole season→episode browse path on the native surface is non-functional.
**Suggested fix:** Either have the scanner `INSERT OR IGNORE` a `season` stub (id `season:<series>:<n>`, `series_id`, `season_number`) alongside the series stub, or change the endpoint to accept a `seriesId` + `seasonNumber` (it already re-derives both from the season row only to re-query episodes by them) and drop the `type='season'` precondition.

### A3-03 — Native episode carousel chain is orphaned (rendered nowhere)
**Severity:** HIGH
**File:** `src/components/media/SeriesSection.tsx` · `EpisodeCarousel.tsx` · `EpisodeCard.tsx` · `EpisodeToolbar.tsx`
**What's wrong:** A `grep` for `<SeriesSection` / `<EpisodeCarousel` / `<EpisodeCard` across `src` finds **no mount site** — they only reference each other. The native library detail page (`library/[id]/page.tsx:134-163`) renders its **own inline** season/episode list via `getEpisodesForSeries`, bypassing these components entirely. So this component family (incl. its sort/filter toolbar, up-next ring, scroll arrows) is dead code that also depends on the broken endpoint in A3-02.
**Why it matters:** Dead-code maintenance burden, and it masks A3-02: the carousel "works" in isolation but is never exercised, so the broken endpoint went unnoticed. Either the inline list or the component chain is redundant.
**Suggested fix:** Decide on one. If the carousel is the intended UX, mount `SeriesSection` in `library/[id]` (and fix A3-02); otherwise delete the four components.

### A3-04 — Continue-Watching ("Resume") ordering is undefined
**Severity:** HIGH
**File:** `src/lib/media-server/library.ts:139-154` (`getResumeItems`) vs `:127-136` (`upsertWatchState` in-progress branch)
**What's wrong:** `getResumeItems` filters `played = 0 AND position_ticks > 0` then `ORDER BY last_played DESC`. But the in-progress upsert branch inserts `last_played = NULL` and its `ON CONFLICT` update never sets `last_played` — only the `played=true` branch sets it. So **every** row in the resume set has `last_played = NULL`; the `ORDER BY` is a no-op and SQLite returns rows in arbitrary (rowid) order.
**Why it matters:** The home "Continue Watching" row (and `/api/media/resume`) does not surface the most-recently-watched item first; order is effectively random and jumps around as rows are rewritten. Core UX of a media server.
**Suggested fix:** Order by `updated_at DESC` (which *is* maintained on every progress write) instead of `last_played`, or set `last_played = excluded.last_played` in the in-progress `ON CONFLICT` branch too.

### A3-05 — `next-episode` returns the next *sequential* episode, not the next *unwatched*
**Severity:** HIGH
**File:** `src/app/api/media/series/[id]/next-episode/route.ts:22-38`
**What's wrong:** The query selects the next episode strictly greater than `(season, episode)` ordered ascending — it does **not** join `media_watch_state` or consider `played`/`position_ticks`. "Next episode" therefore means "the immediately following episode," even if the user already watched it (e.g. watched out of order, or rewatched an earlier ep). It also has no `LIMIT`-to-unwatched semantics.
**Why it matters:** The doc'd intent (CLAUDE.md / scope) is "next *unwatched* episode across season boundaries." Autoplay-next and any continue-series affordance can replay an already-seen episode or skip the actual next-to-watch. Season-boundary crossing itself is correct (the `season_number > ?` arm handles it), but the watched filter is missing.
**Suggested fix:** `LEFT JOIN media_watch_state mws ON mws.media_id = mi.id AND mws.user_id = ?` and add `AND COALESCE(mws.played,0) = 0` (optionally treat in-progress as the target), keeping the existing `(season,episode)` ordering. Requires threading `userId` into the route (currently `_req` is unused).

### A3-06 — `getSeriesResumeEpisode` can resolve a stale or wrong "Watch Now" target
**Severity:** HIGH
**File:** `src/lib/media-server/library.ts:156-172`; consumed by `src/app/library/[id]/page.tsx:57-59`
**What's wrong:** It returns the most-recently-`updated_at` episode with `played = 0 AND position_ticks > 0`. Two issues: (1) it only ever returns a *partially watched* episode — if the user finished S1E1 cleanly (`played=1`, position reset), there is no in-progress row, so it returns `undefined` and the page falls back to `episodes[0]` (S1E1 again) instead of advancing to S1E2; (2) ordering by `updated_at` (a generic touch timestamp) rather than the position semantics can point at an episode the user merely scrubbed.
**Why it matters:** On the Library detail page, "Watch Now" for a series the user is mid-way through can send them back to the first episode after they complete an episode, instead of to the next one. The correct "resume vs. next" decision needs the next-unwatched logic (A3-05), which this helper does not use.
**Suggested fix:** Compose with the fixed A3-05 query: prefer an in-progress episode; if none, return the first episode with `COALESCE(played,0)=0` by `(season_number, episode_number)`; only fall back to `episodes[0]` when the whole series is watched.

---

## MEDIUM

### A3-07 — `getAvailableFilters` computes genres then discards them; Library has no genre filter
**Severity:** MEDIUM
**File:** `src/lib/media-server/library.ts:262-290`
**What's wrong:** The function builds `genres` from the JSON column (lines 262-277) and types its return as `{ genres: string[]; years: number[] }`, but the return literal hard-codes `genres: []` (line 288), throwing the computed array away. The Library page (`library/page.tsx:251`) only renders the `years` select, so the genre filter is silently absent.
**Why it matters:** Genre is the single most useful library filter and the data is already enriched (`media_items.genres`). The wasted `SELECT DISTINCT genres` scan runs on every page load for nothing.
**Suggested fix:** Return the computed `genres`; add a genre `<select>` to the Library form and a `genre` arm to `getItemsByType` (filter via JSON `LIKE`/`json_each`). If genre filtering is intentionally deferred, drop the dead genre scan so the call is cheap.

### A3-08 — Library "All" tab: pagination disabled and counts split incorrectly
**Severity:** MEDIUM
**File:** `src/app/library/page.tsx:60-78`
**What's wrong:** In the `all` branch it fetches `half = floor(count/2)` movies and `half` series from `offset 0`, merges, and re-sorts in JS; then forces `totalPages = 1` (line 78). So the All tab shows at most ~`count` items, has **no pagination** (the rest of the library is unreachable from All), and an odd `count` drops one slot (`floor`). The merge also re-sorts only the fetched half-page, not the true global order.
**Why it matters:** Users on the default All tab silently cannot browse beyond the first page; the grid is a non-representative sample, not "all."
**Suggested fix:** For All, query both types with a shared `ORDER BY … LIMIT count OFFSET offset` (UNION ALL subquery, or a `type IN ('movie','series')` query) so server-side sort + offset are correct, and compute `totalPages` from `movies+series`.

### A3-09 — Sort inconsistency: SQL `sort_title` (binary) vs JS lowercase `localeCompare`
**Severity:** MEDIUM
**File:** `src/lib/media-server/library.ts:21-28` (SQL `ORDER BY sort_title ASC`) vs `src/app/library/page.tsx:64-73` (JS merge sort)
**What's wrong:** Movies/Shows tabs sort in SQLite by `sort_title` using default binary collation (uppercase sorts before lowercase, no locale rules). The All tab sorts in JS with `.toLowerCase()` + `localeCompare`. The two surfaces order the same titles differently, and `sort_title` can be `NULL` (scanner sets it, but enrichment/legacy rows may not) — `NULL` sorts first in SQLite, producing blank-key items at the top.
**Why it matters:** Inconsistent, surprising ordering across tabs; `NULL`/case artifacts at list head.
**Suggested fix:** Use `ORDER BY sort_title COLLATE NOCASE` (or `lower(coalesce(sort_title,title))`) in `SORT_CLAUSE`, and `COALESCE(sort_title, title)` everywhere so the JS and SQL paths agree.

### A3-10 — `getSimilarItems` is an uncached per-request full-ish scan with JS genre filtering (N+1-ish)
**Severity:** MEDIUM
**File:** `src/lib/media-server/library.ts:174-236`; route `api/media/items/[id]/similar/route.ts`
**What's wrong:** Each call pulls `limit*4` candidates (`type=? AND genres IS NOT NULL ORDER BY year DESC`), `JSON.parse`s every row's genres in JS to intersect with the subject, and may then run a second padding query (`limit*2`). There is no caching and no `revalidate`; the similar route is `force-dynamic`. The Library detail page calls it on every render (server component, line 45).
**Why it matters:** For a large library this re-scans and re-parses JSON on every detail view and every similar-API hit. Genre matching in JS defeats the `idx_media_type` index for the predicate.
**Suggested fix:** Cache results (per-item, short TTL — `unstable_cache`/in-memory keyed by id), and/or precompute a normalized `genre` join table so matching is a SQL `JOIN`/`GROUP BY` with a count, avoiding JS parsing and the pad query.

### A3-11 — Year filter breaks pagination and totals
**Severity:** MEDIUM
**File:** `src/app/library/page.tsx:55,59,75,78`
**What's wrong:** When a `year` is set, `totalCount` is set to `items.length` (the current page slice) and `totalPages` is forced to 1. But `getItemsByType` still applies `LIMIT/OFFSET` with the year predicate, so a year with more than `count` items shows only the first page, reports the wrong total ("N items" = page size), and offers no way to page further.
**Why it matters:** Filtering by a prolific year hides items and misreports the count.
**Suggested fix:** Add a `getCountByType(type, year)` (single `COUNT(*)` with the same predicate) and compute `totalPages` from it; don't special-case year to one page.

### A3-12 — `enrichAll` runs N+1 verification queries and is fully sequential
**Severity:** MEDIUM
**File:** `src/lib/media-server/enricher.ts:79-113`
**What's wrong:** For each unenriched item it runs a `SELECT tmdb_id` *before* and *after* `enrichItem` (two extra point queries per item) purely to compute the enriched/failed counters, then sleeps 250ms — strictly sequential. The before/after value is already knowable from `enrichItem`'s own write.
**Why it matters:** On a large initial scan this triples the query count and serializes the whole enrichment pass; the pre/post selects are pure overhead.
**Suggested fix:** Have `enrichItem` return a boolean (matched/not) and tally from that; drop the two verification selects. The TMDB rate-limit sleep can stay, but batch where the API allows.

### A3-13 — `searchItems` uses unanchored `LIKE %q%` with no index and no type scope
**Severity:** MEDIUM
**File:** `src/lib/media-server/library.ts:49-55`; used by `api/media/items/route.ts:16-18`
**What's wrong:** `WHERE title LIKE ? OR sort_title LIKE ?` with leading `%` cannot use any index → full table scan, and it returns **all** types including `episode` and `season`-less stubs, so a search can surface raw episode rows (which then render with movie/series assumptions in callers). The user-supplied `query` is interpolated into the LIKE without escaping `%`/`_`.
**Why it matters:** Slow on large libraries; episode rows leak into a "movies/series" search context; `%` in a query matches everything.
**Suggested fix:** Restrict `type IN ('movie','series')`, escape LIKE wildcards (`ESCAPE '\\'`), and consider an FTS5 virtual table for title search.

---

## LOW

### A3-14 — `parseInt` validations accept malformed numeric params silently
**Severity:** LOW
**File:** `src/app/api/media/items/[id]/similar/route.ts:13` · `api/media/items/route.ts:13-14` · `library/page.tsx:234`
**What's wrong:** `parseInt(... ?? '10', 10)` with no `Number.isFinite` guard: `?limit=abc` → `NaN`, passed to `getSimilarItems`/`getItemsByType` as `LIMIT NaN`. `items/route.ts` uses `Number(...)` for `offset` with no clamp, so a negative `offset` reaches `OFFSET -5`.
**Why it matters:** Minor — better-sqlite3 will usually throw on `NaN`/negative LIMIT, surfacing a 500 instead of a clean 400.
**Suggested fix:** Clamp: `Math.max(0, Number.isFinite(n) ? n : default)`; reject negative offset.

### A3-15 — History "watched this page" label is misleading; total time is per-page only
**Severity:** LOW
**File:** `src/app/history/page.tsx:55,64`
**What's wrong:** `totalWatchTime` sums only the current page's events but is presented next to the all-time `data.total` count. (Code comments acknowledge this.) Independent of A3-01, even with data this conflates a page sum with a global total in one sentence.
**Why it matters:** User reads "342 items · 3h watched" as lifetime stats when the time is just this page.
**Suggested fix:** Compute total watch time server-side (one `SUM(watched_sec)` over the filtered set) and return it alongside `total`.

### A3-16 — `stats` route is admin-only while the rest of the catalog API is user-level
**Severity:** LOW
**File:** `src/app/api/media/stats/route.ts:8` (`requireAdmin`)
**What's wrong:** `GET /api/media/stats` calls `requireAdmin()`, whereas `items`, `filters`, `resume`, `similar`, etc. use `requireAuth()`. If any non-admin UI surface (e.g. a library header count) calls `/api/media/stats`, it 403s for normal users. The library page itself uses `getTotalCount()` directly server-side, so this is latent, not active.
**Why it matters:** Inconsistent authz tier; a future client fetch of stats would silently fail for non-admins.
**Suggested fix:** If the counts aren't sensitive, downgrade to `requireAuth()`; otherwise document why stats is privileged.

### A3-17 — Missing composite index for the per-season episode join
**Severity:** LOW
**File:** `src/app/api/media/seasons/[seasonId]/episodes/route.ts:41-58`; schema `migrations.ts:457-460`
**What's wrong:** The episode query filters `series_id = ? AND season_number = ? AND type = 'episode'` and `ORDER BY episode_number`. Indices exist on `series_id` and `type` individually but not a composite `(series_id, season_number, episode_number)`, so the per-season fetch filters on one index then sorts in memory.
**Why it matters:** For long-running series the season fetch does extra work; minor at typical sizes. (Also moot until A3-02 is fixed.)
**Suggested fix:** `CREATE INDEX idx_media_series_season_ep ON media_items(series_id, season_number, episode_number)`. The same index also accelerates `getEpisodesForSeries` (library detail) and the `next-episode` query.

### A3-18 — `MediaCard` default `href` points at `/browse/[id]` — a Library-routing footgun
**Severity:** LOW
**File:** `src/components/media/MediaCard.tsx:80`
**What's wrong:** When no `href` is passed, `MediaCard` links to `/browse/${id}`. The Library grid and "More Like This" always pass an explicit Library/`/play` href (so they're correct today), but the default silently routes owned content into the acquisition surface — exactly the violation the routing rule (CLAUDE.md §7) warns against. Any future Library-context use that forgets `href` lands the user in Browse.
**Why it matters:** Latent routing-rule violation; one missing prop drops a user into request controls for content they own.
**Suggested fix:** Remove the `/browse` default (require `href`, or default to `/library/${id}`), so the safe destination is the fallback for an owned-items component.

---

## Notes / verified-correct (not findings)

- Routing rule **upheld** on this surface: Library grid links series→`/library/[id]`, movies→`/play/[id]` (`library/page.tsx:100`); "More Like This" mirrors it (`:177`); `/play/[id]` redirects series containers to `/browse/[id]` as the documented safety net (`play/[id]/page.tsx:44`).
- `api/media/image` is SSRF-hardened (path must start `/`, size allowlisted) and cached 24h — good (`image/route.ts:5,15-19,40`).
- `next-episode` **does** cross season boundaries correctly (`season_number > ?` arm); only the watched-filter is missing (A3-05).
- SeasonAccordion's URL `/api/tmdb/tv/${tmdbId}/season/${n}` correctly matches the `[tmdbId]/season/[seasonNumber]` route by position — not a bug.
- `formatDuration` expects ticks; Library detail passes `runtime_ticks` and `position_ticks` (both ticks) — units are consistent (`library/[id]/page.tsx:32,127`).
