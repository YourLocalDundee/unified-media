# Audit 02 — Browse / Discover / Search

Scope: discovery surfaces — `src/app/browse/**`, `src/app/search/**`,
`src/app/api/search`, `src/app/api/tmdb/**`, and the shared media components
(`MediaCard`, `MediaDetailPanel`, `MovieDetailPanel`, `TvDetailPanel`, `CastGrid`,
`ExternalLinks`, `SeasonSelector`, `SeriesSection`, plus their direct children).
Lenses: logic flow, buttons/interactions, optimizations. Notifications/SMTP skipped.

## Summary

The discovery surfaces are mostly server-rendered, auth-gated, and route correctly
between `/browse/*` (discoverable) and `/library/*`/`/play/*` (owned) — the project
routing rule holds everywhere I traced. Two correctness bugs stand out: TMDB "All"
search and trending/genre pagination is broken on the default tab (`searchTMDB('all')`
hard-codes page 1 yet the UI still renders working-looking Next/Prev links and a
multi-page count), and the standalone `/search` page never cross-references the local
library nor links its result cards anywhere — every card is a bare "Request" button,
contradicting the documented "link to /browse/[id] if owned" behaviour. A large shared
component subtree (`MediaDetailPanel`, `Movie/TvDetailPanel`, `SeasonAccordion`,
`SeriesSection`, `SeasonSelector`) is fully orphaned — imported by nothing the app
renders — so a real data-mapping bug inside it (the season API omits the still/overview/
runtime/`id` fields `EpisodeRow`/`SeasonAccordion` expect) is dead-code-only today but
will surface the moment those panels are wired back in. The rest is optimization polish:
every TMDB `<Image>` is `unoptimized`, the search keystroke flow does a full server
round-trip per 300ms instead of caching, and there is no React Query `staleTime` on the
client TMDB fetches.

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 3 |
| MEDIUM | 6 |
| LOW | 6 |
| **Total** | **15** |

---

## HIGH

### A2-001 — TMDB "All" search and trending/genre pagination is broken (page param ignored)
- **Severity:** HIGH
- **File:** `src/lib/media-server/tmdb.ts:529-552` (the `type === 'all'` branch of `searchTMDB`); consumed at `src/app/search/page.tsx:46` and `src/app/browse/page.tsx:234`
- **What's wrong:** The `'all'` branch of `searchTMDB` fetches both `/search/movie` and `/search/tv` **at page 1 only** (`fetchSearchPage(..., 1)` hard-coded, line 531-532) and returns `page: 1` with `totalPages: Math.max(moviePages, tvPages)`. The incoming `page` argument is silently discarded. Both `/search` (default tab `all`, `page.tsx:40-41`) and `/browse` discover-search render Next/Prev links and "Page X of N" using that inflated `totalPages` (`search/page.tsx:119-141`, `browse/page.tsx:312-324`). Clicking Next navigates to `?page=2`, the server re-runs `searchTMDB(query,'all',2)`, and the function returns page-1 results again — the grid never advances. The user sees pagination controls that look functional but loop on page 1.
- **Why it matters:** Common, visible broken interaction. Any "All" search with >20 results (most searches) has dead pagination; users cannot reach results past the first page. Trending/genre browse also defaults to a combined feed where the same ceiling applies for multi-type categories.
- **Suggested fix:** Thread `page` into both `fetchSearchPage` calls in the `'all'` branch and return the real `page`. Because movie/TV totals differ, prefer issuing both requests at the requested `page` and clamp `totalPages` to `min(moviePages, tvPages)` (or paginate the two lists independently). At minimum, when `'all'` cannot truly paginate, suppress the Next/Prev UI so users are not given dead controls.

### A2-002 — `/search` results never cross-reference the library and never link anywhere
- **Severity:** HIGH
- **File:** `src/app/search/SearchResults.tsx:66-159` (cards) and `src/app/search/page.tsx:45-51` (no library lookup); contrast with `src/app/browse/DiscoverResults.tsx:38-124`
- **What's wrong:** `SearchResults` renders each TMDB hit as a poster with a single "Request" button. The poster and title are **not links** — there is no `<a href>` and no `onClick` navigation, so a user cannot open a detail page from `/search` at all. The page also never calls `getItemsByTmdbIds`, so an item the user already owns still shows "Request" instead of an "In Library / Watch" affordance. `CLAUDE.md` §5 (`/search`) explicitly specifies "Discover results link to `/browse/[id]` if already in library, or show Request button if not" and "Library results link to `/browse/[id]`" — neither behaviour exists. The sibling `DiscoverResults` (used by `/browse`) does both correctly (`libraryId` check → Watch link; otherwise `RequestOptions`), so `/search` is a regressed/older surface.
- **Why it matters:** Core discovery dead-end. From `/search` the user can request but cannot inspect or watch, and may request something already in the library. Behaviour contradicts the documented spec and diverges from the equivalent `/browse` surface.
- **Suggested fix:** Mirror `DiscoverResults`: in `search/page.tsx` build `getItemsByTmdbIds(results.map(r=>r.tmdbId))`, pass `libraryId`/request status into `SearchResults`, wrap the poster+title in an `<a href={/browse/discover/${mediaType}/${tmdbId}}>` (discoverable) or render the "In Library — Watch" link to `/browse/${libraryId}` for owned items. Ideally replace the bespoke `SearchResults` card with the shared `DiscoverResults` component to kill the divergence.

### A2-003 — `/search` Request button submits a Long-term request with no mode indication or year guard feedback
- **Severity:** HIGH
- **File:** `src/app/search/SearchResults.tsx:23-56` (the `handleRequest` POST); server logic `src/app/api/requests/route.ts:88-123`
- **What's wrong:** The "Request" button POSTs to `/api/requests` with **no `requestType` and no `requestMethod`** (lines 30-38). Server-side this normalises to `retentionType = 'longterm'` (route.ts:88-90) and `methodType = 'auto-pick'` (route.ts:93-96), i.e. it silently creates a Long-term, admin-approval request. The button label is just "Request" → "Requested" with no hint of which mode the user got, no Quick/Long-term choice, and no language/scope. Worse, for TV the server creates the request with `scopeType` undefined (whole-series default) and never prompts for scope. This is inconsistent with every other request entry point (`RequestOptions` on `/browse` offers the two-mode UI and TV scope modal). The 409 "Already requested" path is treated as success (line 41) which is fine, but a 429 year-guard rejection (route.ts:118-123 can only fire for `quick`, so not here) and any 400/500 surface only as a tiny red string.
- **Why it matters:** Two equivalent discovery surfaces (`/search` vs `/browse`) create structurally different requests for the same action, and the `/search` user has no control over retention/scope and no visibility into what was submitted. For TV this can auto-create a full-series monitored item the user did not intend.
- **Suggested fix:** Use the shared `RequestOptions` component on the search cards (as `DiscoverResults` does) so retention mode, TV scope, and feedback are consistent; or at minimum label the button "Request (Long-term)" and surface the resulting status/type badge.

---

## MEDIUM

### A2-004 — Orphaned shared component subtree (`MediaDetailPanel`, `Movie/TvDetailPanel`, `SeriesSection`, `SeasonSelector`) — dead code carrying a latent data-mapping bug
- **Severity:** MEDIUM
- **File:** `src/components/media/MediaDetailPanel.tsx`, `MovieDetailPanel.tsx`, `TvDetailPanel.tsx`, `SeriesSection.tsx`, `SeasonSelector.tsx`, `SeasonAccordion.tsx`, `EpisodeRow.tsx`, `CastGrid.tsx`
- **What's wrong:** Static import-graph check: `MediaDetailPanel` is imported by **nothing** in the app; `SeriesSection` and `SeasonSelector` are imported by nothing; `Movie/TvDetailPanel` are imported only by `MediaDetailPanel`; `SeasonAccordion`/`CastGrid`/`ExternalLinks`/`EpisodeRow` are only reachable through that dead chain (except `ExternalLinks`, also dead-only via the panels). The live discover detail page (`browse/discover/[mediaType]/[tmdbId]/page.tsx`) renders cast and seasons with its own inline JSX (`page.tsx:216-259`) and does not use any of these. So this is a parallel, unused detail-panel implementation. It still type-checks and ships in the bundle.
- **Why it matters:** Dead weight in the client bundle and a maintenance trap: the audit brief lists these as in-scope shared components, but they are not actually rendered, so reviewers and future devs may believe they back the detail UI. The latent bug in A2-005 lives entirely inside this dead tree.
- **Suggested fix:** Either delete the unused subtree, or wire `MediaDetailPanel` into the surface it was built for (it reads like a `/requests` expandable row) and fix A2-005 first. Confirm `EpisodeCarousel`/`SeriesSection` are not intended for a library detail page before removing.

### A2-005 — Season API omits `id`, `stillPath`, `overview`, `runtime`, `voteAverage` that `SeasonAccordion`/`EpisodeRow` consume
- **Severity:** MEDIUM (latent — only reachable via the dead components in A2-004)
- **File:** `src/app/api/tmdb/tv/[tmdbId]/season/[seasonNumber]/route.ts:35-43` vs consumers `src/components/media/SeasonAccordion.tsx:7-14,76-79` and `EpisodeRow.tsx:5-14,32-73`
- **What's wrong:** The season route maps each episode to only `{ episodeNumber, name, airDate }` (route.ts:37-41). `SeasonAccordion` types the response as full `Episode[]` and renders `<EpisodeRow key={ep.id}>` — `ep.id` is `undefined`, so all rows share key `undefined` (React key collision/warning), and `stillPath`/`overview`/`runtime`/`voteAverage` are all `undefined`, so every episode shows "No image", no synopsis, and no runtime. The route's *other* live consumers (`TorrentPickModal.tsx:225`, `SeriesScopeModal.tsx:179`) only need `episodeNumber`/`name`, so the route is correct for them — the mismatch is specifically the rich-render path.
- **Why it matters:** If the dead detail panels are ever re-enabled, the per-season episode list renders broken (no stills, no descriptions, duplicate keys). It is invisible today only because the consumer is unmounted.
- **Suggested fix:** Add `id: ep.id`, `stillPath: ep.still_path ?? null`, `overview: ep.overview ?? null`, `runtime: ep.runtime ?? null`, `voteAverage: ep.vote_average ?? null` to the route's episode map (TMDB returns all of these on `/tv/{id}/season/{n}`). Cheap, and makes the route correct for all consumers.

### A2-006 — All TMDB images use `next/image` with `unoptimized` (no resizing, format negotiation, or caching)
- **Severity:** MEDIUM
- **File:** `DiscoverResults.tsx:52-58`, `browse/discover/[mediaType]/[tmdbId]/page.tsx:104-112,131,240`, `browse/[id]/page.tsx:114-122,134-141`, `MediaCard.tsx:48-56`, `MovieDetailPanel.tsx:189-196,206-213`, `TvDetailPanel.tsx:164-171,181-188`, `CastGrid.tsx:36-43`, `EpisodeRow.tsx:34-41`; `next.config.ts:6-26` (remotePatterns present but unused)
- **What's wrong:** Every TMDB `<Image>` passes `unoptimized`, so Next serves the raw upstream file with no width-appropriate resizing, no AVIF/WebP, and no Next image cache. The code already requests fixed TMDB CDN sizes per context (`w185`/`w300`/`w342`/`w780`/`w1280`), which partially mitigates, but e.g. `browse/[id]` loads a `w1280` backdrop and a `w342` poster `unoptimized` with `priority`. Notably `next.config.ts` *does* whitelist `image.tmdb.org` under `remotePatterns` (lines 11-25), so the optimizer is configured but deliberately bypassed everywhere. `SearchResults.tsx:85-91` is the one place that omits `unoptimized` — an inconsistency, and on the same `image.tmdb.org` host, so it goes through the optimizer while the rest do not.
- **Why it matters:** Larger payloads and more bytes over the wire on grid-heavy pages (discover/search render 18-100 posters). On a phone-as-remote use case this is the dominant cost. The inconsistency also means two cards in the codebase fetch the same poster two different ways.
- **Suggested fix:** Decide one policy. Either drop `unoptimized` and let Next resize/cache TMDB images (config is ready), choosing TMDB `w500`/`original` as the source so Next can downscale; or keep `unoptimized` intentionally and document why, and make `SearchResults` match. Given the fixed `w185` sizes already chosen, dropping `unoptimized` on the small cards yields little, but the `w1280`/`w780` backdrops clearly benefit.

### A2-007 — Search keystrokes trigger a full server re-render per 300ms with no result caching
- **Severity:** MEDIUM
- **File:** `src/app/search/SearchInput.tsx:39-47` (debounced `router.push`) → `src/app/search/page.tsx:45-46` (`searchTMDB` server-side); `/api/search/route.ts` is `force-dynamic`
- **What's wrong:** The search box debounces 300ms then `router.push`es a new URL, re-running the server component and a fresh `searchTMDB` call each time. There is no client-side result memo and no React Query layer, so typing "interstellar" issues a server round-trip + TMDB fetch for each debounced prefix the user pauses on, and navigating back to a prior query refetches. The underlying TMDB list fetch does set `next: { revalidate: 300 }` (`tmdb.ts:184` / `fetchSearchPage`), which caches at the data layer, so repeat identical queries within 5 min are cheap — but the per-keystroke navigation churn (RSC payloads, re-render, transition) is not cached and the `/api/search` JSON route is `force-dynamic` (no caching) for any client that uses it.
- **Why it matters:** Extra server work and RSC traffic on every search session; on a slow link the 300ms debounce + navigation feels laggy. This is the documented architecture (server-rendered search), so it is a deliberate trade-off, but it forgoes the React Query caching the stack already ships.
- **Suggested fix:** Acceptable as-is for a LAN app, but consider a client-side React Query `useQuery(['tmdb-search', q, type, page])` with `staleTime` against `/api/search` for the live-typing case, falling back to the server render for the initial/bookmarked load. At minimum keep `revalidate` on the data fetch (already present) and avoid pushing a navigation for queries shorter than 2 chars.

### A2-008 — No minimum query length: single-character keystrokes fire TMDB searches
- **Severity:** MEDIUM
- **File:** `src/app/search/SearchInput.tsx:29-47`; `src/app/search/page.tsx:38` (`query = q?.trim() || undefined`); `/api/search/route.ts:17-18`
- **What's wrong:** `handleChange` navigates for any non-empty trimmed value after 300ms, including 1-2 character inputs. `searchTMDB` is then called with `query: "a"`, returning thousands of low-value results and burning a TMDB request. There is no `length >= 2` guard anywhere on the search path (the `/api/search` route only guards empty). `browse/page.tsx` `FilterBar` is a GET form so it is submit-gated, but the `/search` live-typing path is not.
- **Why it matters:** Wasted TMDB calls and noisy result sets on every first keystroke of every search. Minor, but trivially avoidable.
- **Suggested fix:** In `SearchInput.navigate`, skip the push when `trimmed.length > 0 && trimmed.length < 2` (still allow clearing to empty to reset). Optionally mirror the guard server-side.

### A2-009 — `browse/[id]` blocks render on Radarr/Sonarr lookup with no timeout
- **Severity:** MEDIUM
- **File:** `src/app/browse/[id]/page.tsx:23-40,84` (`await getArrStatus(item)` in the server render path)
- **What's wrong:** The browse acquisition detail page `await`s `getArrStatus`, which calls `radarrFetch`/`sonarrFetch` (network to `*arr` services) inside the page render before returning any HTML. The call is `try/catch`-guarded so a failure degrades to no badge, but there is no timeout — if Radarr/Sonarr is slow or hung, the whole detail page TTFB stalls. It is also outside any `Suspense` boundary (the page returns one tree), so nothing renders until the `*arr` round-trip resolves or the socket times out at the default fetch timeout.
- **Why it matters:** The monitoring badge is a non-essential adornment, yet it gates the entire detail page's first byte on a third-party service. A flaky *arr container makes browse detail pages feel broken.
- **Suggested fix:** Wrap the `*arr` badge in its own `<Suspense>` async sub-component so the rest of the page streams immediately, and/or add an `AbortSignal.timeout(2000)` to `getArrStatus`'s fetches so it degrades fast.

---

## LOW

### A2-010 — "Back to Discover" link drops the user's category, genre, page, and search context
- **Severity:** LOW
- **File:** `src/app/browse/discover/[mediaType]/[tmdbId]/page.tsx:120`
- **What's wrong:** The back link is hard-coded `href="/browse?type=discover"`. A user who drilled in from "Top Rated TV → Drama → page 3" or from a search returns to the default Trending page-1, losing all filter/scroll context. The card links that brought them here (`DiscoverResults.tsx:42`) carry no return state either.
- **Why it matters:** Mild navigation friction on the discovery flow; users re-navigate filters after every detail view.
- **Suggested fix:** Either use `router.back()` in a small client back-button, or thread the originating `cat`/`genre`/`page`/`q` through the detail URL as state and reconstruct the link.

### A2-011 — `/browse` library "all" and year-filtered views silently collapse to a single page
- **Severity:** LOW
- **File:** `src/app/browse/page.tsx:94-116` (the `else` "all" branch and `totalPages` calc)
- **What's wrong:** For `type=all`, the page pulls `floor(limit/2)` movies + `floor(limit/2)` series, merges, re-sorts in memory, and forces `totalPages = 1` (line 116). With `count=25` that surfaces only ~12 movies + ~12 series even if the library has thousands, and the pagination control is suppressed (`!query && !year && totalPages > 1`, line 145). The behaviour is documented in code comments, but to a user the "✦ Browse"→library "All" tab just looks like a tiny truncated library with no way to see more. Same single-page collapse applies to any year-filtered view (`totalCount = items.length`, lines 89/93/111).
- **Why it matters:** Library "All" browsing is effectively capped at `count` items with no pagination and no indication more exist. Edge surface (the default tab is Discover, and Movies/TV tabs paginate correctly), so low.
- **Suggested fix:** Implement a real merged-and-paged query (UNION across types ordered by the sort key with SQL `LIMIT/OFFSET`), or show a "showing first N — switch to Movies/TV Shows for full pagination" note so the truncation is explicit.

### A2-012 — Library search in `/browse` is unanchored `LIKE %q%` with no FTS, ordering, or pagination
- **Severity:** LOW
- **File:** `src/lib/media-server/library.ts:49-55` (`searchItems`); called from `browse/page.tsx:82`
- **What's wrong:** `searchItems` runs `title LIKE %q% OR sort_title LIKE %q% LIMIT ?` with no `ORDER BY` (arbitrary SQLite rowid order), no relevance ranking, and no pagination (`totalCount = items.length` capped at `limit`, browse/page.tsx:82-84). A common-substring query (e.g. "the") returns an arbitrary `limit`-sized slice. The leading wildcard also defeats any index. Special LIKE metacharacters in the query (`%`, `_`) are not escaped, so a user typing `50%` matches unexpectedly.
- **Why it matters:** Low-quality library search results and a minor correctness quirk with `%`/`_` in queries. Functional for small libraries.
- **Suggested fix:** Add `ORDER BY` (e.g. exact-prefix first, then `sort_title`), escape LIKE metacharacters (or use an FTS5 virtual table if the library is large), and surface a real count.

### A2-013 — `/api/tmdb/trending` and `/api/search` JSON routes are unused dead endpoints
- **Severity:** LOW
- **File:** `src/app/api/tmdb/trending/route.ts`, `src/app/api/search/route.ts`
- **What's wrong:** Both routes proxy `getTrendingContent`/`searchTMDB` for client callers, but the live UI fetches these server-side instead: `/browse` uses `getTrendingContent`/`searchTMDB` directly in server components, and `/search` uses `searchTMDB` server-side. Grep shows no client `fetch('/api/tmdb/trending')` or `fetch('/api/search')` in the app. The route files even document "The main /search page uses searchTMDB server-side, not this route" (`api/search/route.ts:5`). They are correctly auth-gated, so harmless, but unused.
- **Why it matters:** Dead surface area to maintain; minor confusion about the canonical data path.
- **Suggested fix:** Remove if no external/client consumer is planned, or note them as intentional public JSON endpoints.

### A2-014 — CSP `img-src` omits `www.themoviedb.org` though `next.config` whitelists it for images
- **Severity:** LOW
- **File:** `next.config.ts:20-24` (remotePattern for `www.themoviedb.org`) vs `next.config.ts` CSP `img-src 'self' data: https://image.tmdb.org blob:`
- **What's wrong:** `remotePatterns` allows `https://www.themoviedb.org/t/p/**` as an image source, but the CSP `img-src` directive only lists `image.tmdb.org`. If any code ever renders a `www.themoviedb.org` image (the config implies intent), the browser blocks it via CSP even though Next would serve it. Today all image URLs in scope use `image.tmdb.org`, so nothing breaks — it is a latent config inconsistency.
- **Why it matters:** No current breakage; a trap if someone uses the whitelisted `www.themoviedb.org` host expecting it to work.
- **Suggested fix:** Drop the unused `www.themoviedb.org` remotePattern, or add it to CSP `img-src` to match intent.

### A2-015 — Discover card poster and title fire two navigations / overlapping anchors
- **Severity:** LOW
- **File:** `src/app/browse/DiscoverResults.tsx:50-100` (poster `<a>` and title `<a>` both → `detailUrl`); Watch link `:105-111` uses `onClick={e => e.stopPropagation()}` though it is not nested in a parent anchor
- **What's wrong:** Each card has two separate anchors to the same `detailUrl` (the poster block and the title) — harmless duplication, but the inner "Watch" link (`:107`) calls `e.stopPropagation()` to escape a parent click handler that does not exist (the card `<div>` has no `onClick`; only the sibling anchors do). The `stopPropagation` is dead defensive code, suggesting the card was refactored from a single-anchor wrapper and the guard was left behind. No functional bug, but the two-anchor pattern means hover/focus states and prefetch fire twice per card.
- **Why it matters:** Cosmetic/perf-trivial; double prefetch per card on a large grid and a misleading leftover handler.
- **Suggested fix:** Wrap the card in one anchor and overlay the CTA, or drop the now-meaningless `stopPropagation`.

---

## Notes / verified-clean

- **Routing rule (owned vs discoverable) holds:** `DiscoverResults` routes discoverable items to `/browse/discover/${mediaType}/${tmdbId}` and owned items to `/browse/${libraryId}` (`:42,106`); the discover detail `RequestButton` routes owned items to `/browse/${libraryId}` (`RequestButton.tsx:27`). Per `CLAUDE.md` "Library vs Browse routing", an owned item reached **from the Browse surface** linking to `/browse/[id]` is intentional, so this is compliant, not a violation. No nav hrefs are built with query strings *for the sidebar* (the browse internal filter `<a>` tags use query strings, which is expected for in-page filters, not nav).
- **Auth:** every page (`browse`, `browse/[id]`, `browse/discover/...`, `search`) and every API route (`/api/search`, `/api/tmdb/*`) calls `requireAuth()` before doing work. No authz gaps found in scope. `RescanButton` is admin-gated client-side and the `/api/media/scan` route exists.
- **Secret handling:** `TMDB_ACCESS_TOKEN` is only read server-side (`tmdb.ts`, the proxy routes); never reaches the client. TMDB proxy routes inject the Bearer header server-side as designed.
- **Search race safety:** the per-keystroke flow is server-rendered via `router.push`, so React/Next reconciles to the latest navigation — there is no client out-of-order `setState` race. The client `MovieDetailPanel`/`TvDetailPanel`/`SeasonAccordion` fetches all use a `cancelled`/effect-cleanup guard against stale responses (`MovieDetailPanel.tsx:121-143`).
- **Detail-panel button gating (where rendered):** the discover detail page shows "In Library — Watch Now" only when `libraryId` is set, else `RequestOptions`; `RequestOptions` hides the request UI and shows a status badge when an active request exists (`RequestOptions.tsx:140-152`). `browse/[id]` shows "Watch Now" only when a playable target resolves and hides it for series with no scanned episodes (`browse/[id]/page.tsx:100-107,185`). External links filter out empty URLs (`ExternalLinks.tsx:13`).
- **Caching at the TMDB data layer is present:** detail fetches use `revalidate: 86400`, trending/genre `3600`, search `300` — reasonable. The gap is only on the client-fetch/React-Query side (A2-007).
