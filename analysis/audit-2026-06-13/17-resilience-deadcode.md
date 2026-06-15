# Audit 17 — Global Resilience / Error-Handling + Consolidated Dead-Code & No-Op Inventory

Cross-cutting READ-ONLY pass on top of the 15 vertical audits (01–15). App root:
`/home/minijoe/dev/unified-frontend/app` (source in `src/`). Stack: Next.js 16.2.7 App Router,
React 19, TypeScript, @tanstack/react-query, zustand. Notifications/SMTP skipped per scope.

## Summary

The app has a **zero-error-boundary** posture: there is **no `error.tsx`, `global-error.tsx`,
`loading.tsx`, or `not-found.tsx` anywhere in `src/`**, and **no React `ErrorBoundary` /
`componentDidCatch`** class exists. When a Server Component or a server `lib` call throws and the
code did not wrap it locally, the request falls through to Next's built-in error page (dev overlay /
generic 500) — there is no app-styled recovery UI and no per-segment isolation. The mitigating factor
is that the highest-traffic pages defend *locally*: the home dashboard wraps each of its four sections
in its own Suspense boundary **and** a `try/catch` returning an inline error card (`page.tsx:117-393`),
the `/browse` and `/search` server pages use `.catch(() => null)` around every TMDB call, and the five
dynamic detail routes call `notFound()`. AuthContext is correctly fault-tolerant — an `/api/auth/me`
failure sets `user:null, loading:false` in a `finally` (`AuthContext.tsx:49-65`), so the app never
hangs on a spinner or hard-loops on a network blip.

Two real process/resilience gaps: (1) the **automation scheduler's three hot cron jobs**
(grab / availability / import) have **no `try/catch`** (`scheduler.ts:33-66`) while the subtitle
scheduler wraps each tick — an error in `grabItem`/`checkAvailability`/`runImportCheck` becomes an
unhandled rejection on a recurring timer; and (2) there is **no `process.on('unhandledRejection' /
'uncaughtException')`** handler anywhere, so any escaped async error can tear the worker down.
React Query global defaults still omit `retry`/`refetchOnWindowFocus` (already filed as A15-G3).
Client `await fetch` without an `res.ok` check is widespread (sibling audits cover it per-surface);
this pass confirms 5 client files have **no `.ok` check at all** and characterizes it as systemic.

The **dead-code inventory is the larger deliverable: ~31 items**. Two big orphaned component chains
are confirmed dead — the `MediaDetailPanel → {MovieDetailPanel, TvDetailPanel} → {CastGrid,
SeasonAccordion → EpisodeRow}` discover-detail chain (nothing imports `MediaDetailPanel`) and the
`SeriesSection → EpisodeCarousel → {EpisodeCard, EpisodeToolbar}` chain (nothing imports
`SeriesSection`), plus the standalone `SeasonSelector`. The entire `app/downloads/components/*` split
(TorrentRow/DetailPanel/FilterSidebar/AddTorrentModal) is orphaned — `downloads/page.tsx` says so in
its own header and renders an inline `TorrentRow` instead. `party/JoinByCodeModal` is unused. On the
no-op side, the settings findings from Audit 08 are all re-verified (whole Display page sans theme,
9/11 Playback prefs, Torrent→Interface tab, Advanced Jellyfin override, store `browsePageSize`,
sidebar prefs, shortcuts S/N). Newly confirmed unused HTTP routes: `/api/tmdb/trending`, `/api/search`
(JSON), `/api/media/filters`, `/api/media/match-torrent`. And the `app-backup-2026-05-26-1127/`
directory is a stale full-app copy outside `src/`.

### Counts

| Category | Count |
|---|---|
| Section A — resilience/error-handling findings | 8 |
| Section B — orphaned components (incl. chains) | 15 |
| Section B — no-op settings / dead buttons | 7 |
| Section B — unused routes / exports / dirs | 5 |
| Section B — dead-code subtotal | **~27 items** (across ~28 files + 1 dir) |

**Headline component finding:** of the 18 files in `src/components/media/`, **13 are dead**
(B1–B11a) — the two superseded detail-panel chains plus `SeasonSelector` and the shadowed
`RequestButton`. Only 5 are live: `MediaCard`, `RequestOptions`, `SeriesScopeModal`,
`TorrentPickModal`, `VideoPlayer`.

Error-boundary coverage: **error.tsx 0 · global-error.tsx 0 · loading.tsx 0 · not-found.tsx 0**
(all per-route handling is ad-hoc `try/catch` / `.catch()` / `notFound()`).

---

## SECTION A — GLOBAL RESILIENCE / ERROR HANDLING

### A17-1 — No error boundaries anywhere (`error.tsx` / `global-error.tsx` / `not-found.tsx` / `loading.tsx` all absent)
- Severity: HIGH
- Evidence: `find src -name 'error.tsx' -o -name 'global-error.tsx' -o -name 'loading.tsx' -o -name 'not-found.tsx'` → **empty**. `grep -rn "ErrorBoundary|componentDidCatch|getDerivedStateFromError" src` → **none**.
- What happens: When a Server Component, layout, or server `lib` call throws *outside* a local
  `try/catch`, App Router walks up looking for the nearest `error.tsx`; finding none at any segment
  or the root, it renders Next's built-in error page (generic 500 / dev overlay) with no app chrome,
  no theme, and no "try again" affordance. A throw in the **root layout or `Providers`** would be a
  full white-screen (only `global-error.tsx` can catch that, and it does not exist). There is also no
  `loading.tsx`, so route-segment streaming has no skeleton fallback except where a page hand-rolls
  its own `<Suspense>`.
- Mitigation present: the *busiest* server pages defend locally (see A17-2), so a single failing
  optional integration does not blank the page in those specific spots. The gap is everything else —
  admin pages, settings sub-pages, library/[id], etc. — where an unexpected DB/throw has no styled
  recovery.
- Suggested action: add a root `src/app/error.tsx` (client component, `reset()` button) and
  `src/app/global-error.tsx`; optionally a root `not-found.tsx` and segment `loading.tsx` for the
  data-heavy routes.

### A17-2 — Resilience that IS present (verified good — not a defect, documented for completeness)
- Home dashboard: each of the 4 sections is wrapped in its own `<Suspense>` **and** a `try/catch`
  that returns an inline error/empty card — `ContinueWatchingSection` (`page.tsx:117-175`),
  `LatestAddedSection` (`:235-300`), `PendingRequestsSection` (`:302-383`), `ActiveDownloadsSection`
  (`:385-393`). One failing source does not block the others. This is the correct pattern; it is just
  not generalized via `error.tsx`.
- `/browse` server page: every TMDB call uses `.catch(() => null)` then renders an empty state
  (`browse/page.tsx:234,246`).
- `/search` server page: `searchTMDB(...).catch(() => null)` (`search/page.tsx:46`); renders
  server-side, no client fetch.
- Dynamic detail routes call `notFound()` on missing items: `browse/[id]`,
  `browse/discover/[mediaType]/[tmdbId]`, `library/[id]`, `play/[id]`, `watch/[id]`. `play/[id]` also
  has the documented series-container safety net (`redirect('/browse/${id}')`).

### A17-3 — AuthContext is fault-tolerant (verified good)
- File: `src/context/AuthContext.tsx:49-65`
- `refresh()` wraps the `/api/auth/me` fetch in `try { … if(res.ok) setUser(data) else setUser(null) } catch { setUser(null) } finally { setLoading(false) }`. A non-ok response or a thrown network
  error sets `user:null` and **always** clears `loading`. Result: a failing `/api/auth/me` shows the
  app as logged-out (redirect path), never an infinite spinner and never an unhandled rejection.
  No defect.

### A17-4 — Automation scheduler cron ticks have no try/catch (unhandled rejection on a recurring timer)
- Severity: HIGH
- File: `src/lib/automation/scheduler.ts:33-66` (grab loop `*/15`, availability `*/30`, import `*/2`,
  auto-delete `0 * * * *`)
- What's wrong: Three of the four `cron.schedule` callbacks `await` work (`grabItem`,
  `checkAvailability`, `runImportCheck`) **with no `try/catch`**. Compare the subtitle scheduler
  (`src/lib/subtitle/scheduler.ts:22-43`) which wraps **both** its ticks in `try/catch`. If
  `grabItem` (network to indexers), `checkAvailability` (DB + qBit), or `runImportCheck` (qBit +
  `setLocation` + scan) rejects, the rejection escapes the async cron callback.
- Why it matters: With no `process.on('unhandledRejection')` (A17-5), an indexer outage or a qBit
  hiccup during a scheduled tick produces an unhandled promise rejection in the long-lived server
  process — at minimum noisy/again-and-again, at worst (Node default on some configs) process-fatal.
  This runs unattended every 2/15/30 minutes.
- Suggested action: wrap each cron body in `try/catch` with a `console.error` (mirror the subtitle
  scheduler), and/or add a top-level rejection handler.

### A17-5 — No process-level `unhandledRejection` / `uncaughtException` handler
- Severity: MEDIUM
- Evidence: `grep -rn "unhandledRejection|uncaughtException|process.on(" src` → **none**.
- What's wrong: `instrumentation.ts` registers schedulers, watcher, indexer discovery, and the party
  WS server, but installs no global safety net. Only `initIndexerDiscovery()` (`:30-32`) and
  `initPartyServer()` (`:34-39`) have `.catch`/`try`; `initScheduler`, `initSubtitleScheduler`,
  `initWatcher` are called bare.
- Why it matters: Next standalone runs as a single `node server.js`. An escaped async error from any
  background job (A17-4), the chokidar watcher, or a route handler that forgot to catch can crash the
  worker with no graceful logging. A process-level handler converts these into logged-and-survived.
- Suggested action: add `process.on('unhandledRejection', …)` and `process.on('uncaughtException', …)`
  in `instrumentation.ts` (log + keep running, or log + controlled exit), guarded by
  `NEXT_RUNTIME==='nodejs'`.

### A17-6 — Client `await fetch` without `res.ok` checks is systemic (sample / characterization)
- Severity: MEDIUM (cross-cutting; sibling audits enumerate per-surface)
- Evidence: 102 `await fetch` occurrences across 41 client `.tsx` files. Heuristic scan for files that
  contain `await fetch` but **no `.ok` anywhere**: `app/forgot/page.tsx`, `app/admin/activity/page.tsx`,
  `app/admin/settings/page.tsx`, `app/downloads/page.tsx`, `app/downloads/components/DetailPanel.tsx`.
  Many other files *do* check `res.ok` for the primary call but skip it on secondary mutation calls
  (pattern noted across audits 06/07/09).
- What's wrong: A non-2xx response (e.g. 401 after session expiry, 500 from an upstream proxy) is
  often `.json()`-parsed directly or treated as success. On a JSON error body this throws inside the
  handler (caught by a generic `catch` that shows a misleading "network error"); on an empty body it
  silently no-ops. This is the same class the per-surface audits flagged; consolidated here as
  *widespread, not isolated*.
- Suggested action: standardize a `fetchJson()` helper that throws a typed error on `!res.ok` and is
  used by all client mutations; do not re-list every call site.

### A17-7 — React Query global defaults omit `retry` / `refetchOnWindowFocus` (dup of A15-G3, re-confirmed)
- Severity: MEDIUM
- File: `src/app/providers.tsx:18-26` — only `staleTime: 30_000` and `gcTime: 5*60_000` are set.
- Impact: default `retry:3` (slow error surfacing; 3× backoff on always-failing optional integrations)
  and `refetchOnWindowFocus:true` (refetch storm on tab focus across a polling-heavy app). The
  qBittorrent downloads view uses a hand-rolled polling hook (`lib/qbittorrent/hooks.ts`) with its own
  `error`/`retry` rather than React Query, so it is unaffected — but every React-Query consumer inherits
  the untuned defaults.
- Suggested action: set `retry:1`, `refetchOnWindowFocus:false` globally (per-query opt-in for live
  views). Already filed in Audit 15; repeated here because it is the app-wide resilience default.

### A17-8 — Suspense / loading coverage is partial and hand-rolled
- Severity: LOW
- Evidence: `Suspense` appears in 7 files only (`page.tsx`, `library/page.tsx`, `browse/page.tsx`,
  `login`, `register`, `reset-password`, `components/layout/Sidebar.tsx`). No `loading.tsx` exists, so
  segments without a hand-rolled boundary stream with no fallback.
- Note: `Suspense` catches *pending promises*, not *thrown errors* — so the home page's per-section
  Suspense boundaries do **not** substitute for A17-1. A section that throws synchronously (outside its
  own try/catch) would still propagate to the (absent) error boundary.
- Suggested action: add `loading.tsx` to data-heavy segments; treat Suspense and error.tsx as
  complementary, not interchangeable.

---

## SECTION B — DEAD-CODE & NO-OP INVENTORY

Legend — **kind**: orphan = component/module with zero importers; chain-orphan = only reachable
through an orphan; no-op = persisted/rendered but never consumed; dead-route = HTTP route with no
caller; stale-dir = leftover copy. **already-reported-by**: prior audit file, or NEW.

| # | Item (file) | Kind | Evidence (grep / trace) | Already-reported-by | Suggested action |
|---|---|---|---|---|---|
| B1 | `src/components/media/MediaDetailPanel.tsx` | orphan (root of chain) | `grep -rn MediaDetailPanel src` → only self-references; **0 external importers** | 02 (browse) flagged chain | delete (+ chain B2–B3 it pulls in) |
| B2 | `src/components/media/MovieDetailPanel.tsx` | chain-orphan | only importer is `MediaDetailPanel.tsx:3` (itself orphan B1) | 02 / 15 (cited it for `unoptimized`) | delete |
| B3 | `src/components/media/TvDetailPanel.tsx` | chain-orphan | only importer is `MediaDetailPanel.tsx:4` (orphan B1) | 02 / 15 | delete |
| B4 | `src/components/media/SeasonAccordion.tsx` | chain-orphan | only importer `TvDetailPanel.tsx` (chain-orphan B3) | 02 (implied) / NEW (explicit) | delete with chain |
| B5 | `src/components/media/EpisodeRow.tsx` | chain-orphan | importers: `SeasonAccordion.tsx` (B4) + `api/media/seasons/[seasonId]/episodes/route.ts` (type import only) — UI dead | NEW | delete; route only needs the type |
| B6 | `src/components/media/CastGrid.tsx` | chain-orphan | only importer `MovieDetailPanel.tsx` (chain-orphan B2) | 15 (listed for `unoptimized`) | delete with chain |
| B6a | `src/components/media/ExternalLinks.tsx` | chain-orphan | only importers `MovieDetailPanel.tsx:6` + `TvDetailPanel.tsx:6` (both chain-orphans B2/B3) | NEW | delete with chain |
| B7 | `src/components/media/SeriesSection.tsx` | orphan (root of chain) | `grep -rn SeriesSection src` → only self-references; **0 external importers** | 02 named chain | delete (+ B8–B10) |
| B8 | `src/components/media/EpisodeCarousel.tsx` | chain-orphan | only importer `SeriesSection.tsx:4` (orphan B7) | 02 | delete |
| B9 | `src/components/media/EpisodeCard.tsx` | chain-orphan | only importer `EpisodeCarousel.tsx` (chain-orphan B8) | 02 / 15 (`unoptimized`) | delete |
| B10 | `src/components/media/EpisodeToolbar.tsx` | chain-orphan | only importer `EpisodeCarousel.tsx:6` (chain-orphan B8) | 02 | delete |
| B11 | `src/components/media/SeasonSelector.tsx` | orphan | `grep -rn SeasonSelector src` → only self-references; **0 importers** | 02 | delete |
| B11a | `src/components/media/RequestButton.tsx` | orphan (NEW) | `grep -rn "components/media/RequestButton" src` → **0 importers**. The live discover page imports a **local sibling** `app/browse/discover/[mediaType]/[tmdbId]/RequestButton.tsx`, not this one. Prior reports' "1 importer" count was a false match on the sibling | NEW | delete (shared copy superseded by route-local copy) |
| B12 | `src/components/party/JoinByCodeModal.tsx` | orphan | `grep -rn JoinByCodeModal src` → **0 importers** (CLAUDE.md §16 lists it but no code renders it; entry is the `?party=` URL + `StartPartyButton`) | 05 (party) | delete or wire a "Join with code" entry point |
| B13 | `src/app/downloads/components/TorrentRow.tsx` | orphan | live `downloads/page.tsx` renders an **inline** `TorrentRow` (`page.tsx:445,910`); page header (`:1-10`) says the split components "ship alongside" but are unused. Only intra-folder ref: `DetailPanel.tsx:20` imports `fmtDate` from it | 07 / 08 (A8-H3) | delete folder (B13–B16) or adopt it & drop inline |
| B14 | `src/app/downloads/components/DetailPanel.tsx` | chain-orphan | nothing outside the folder imports it; it imports B13/B15 | 07 | delete |
| B15 | `src/app/downloads/components/FilterSidebar.tsx` | chain-orphan | **0 importers** outside the dead folder | 07 / 08 | delete |
| B16 | `src/app/downloads/components/AddTorrentModal.tsx` | chain-orphan | **0 importers** outside the dead folder | 07 | delete |
| B17 | Display settings page — all controls except theme | no-op | `useDisplayPrefs` / `unified-display-prefs` read only by the page that writes them; home page hardcodes limits (`page.tsx`, `getResumeItems(userId,10)`, `getRecentlyAdded(12)`) | 08 (A8-H1) | wire into home/library, or remove sections |
| B18 | Playback settings — 9 of 11 prefs | no-op | `VideoPlayer` reads only `audioLang` (`:416`) + `subtitleLang` (`:423`); `quality/hwAccel/subtitleSize/subtitleBg/subtitleColor/autoPlayNext/autoPlayDelay/skipIntro/resumeMode` have no reader | 08 (A8-H2) | wire per-pref or remove |
| B19 | Torrent → Interface tab (10 controls) | no-op | `unified-torrent-prefs` read only inside `TorrentSettingsClient`; live `downloads/page.tsx` ignores it (inline row, `window.confirm`) | 08 (A8-H3) | thread prefs into live page, or hide tab |
| B20 | Advanced → Jellyfin URL override | no-op | `unified-jellyfin-url-override` referenced only by its own write + `clearAllPreferences`; no stream builder reads it | 08 (A8-M2) | wire into client stream src, or remove |
| B21 | `store/index.ts` `browsePageSize` / `setBrowsePageSize` | no-op (dead state) | `grep` outside `store/index.ts` → none; `/browse` & `/library` never read/set it | 08 (A8-M3) | remove slice or wire page-size selector |
| B22 | Display → Sidebar "Collapsed by Default" / "Show Labels" | no-op | written to `unified-display-prefs`; Sidebar derives collapse from zustand `sidebarOpen` (`Sidebar.tsx:54`), never reads the prefs | 08 (A8-M1) | seed zustand from pref on mount |
| B23 | Shortcuts page rows **S** (subtitles) & **N** (next episode) | dead button / wrong doc | `VideoPlayer` keydown switch (`:619-705`) has no `case 's'`/`'n'`; conversely K/J/L/`,`/`.`/digits/I are bound but undocumented | 08 (A8-H4) | bind S & N (handlers exist) or fix the table |
| B24 | `src/app/api/tmdb/trending/route.ts` | dead-route | `grep -rn "tmdb/trending" src` (excl. route) → none; `/browse` calls `getTrendingContent()` server-side directly (`browse/page.tsx:246`) | NEW | delete route |
| B25 | `src/app/api/search/route.ts` | dead-route | own doc-comment says "main /search page uses searchTMDB server-side, not this route"; `grep` for `/api/search` in `.tsx` → none | NEW | delete or document intended client use |
| B26 | `src/app/api/media/filters/route.ts` | dead-route | `getAvailableFilters` is called **directly server-side** by `library/page.tsx` & `browse/page.tsx`; the HTTP wrapper has no client/fetch caller | NEW | delete route (lib fn stays) |
| B27 | `src/app/api/media/match-torrent/route.ts` | dead-route | `grep -rn "match-torrent" src` (excl. route) → none | NEW | delete, or wire the downloads→library match feature it implements |
| B28 | `app-backup-2026-05-26-1127/` (repo root, outside `app/src`) | stale-dir | full dated copy of the app from 2026-05-26; not referenced by build/tsconfig | NEW | delete (or move out of repo) after confirming no manual reference |

### Notes on near-misses (verified NOT dead — do not delete)

- `lib/automation/auto-delete.ts` — **wired**, dynamically imported by the hourly cron
  (`scheduler.ts:61`). Looks orphaned to a naive path grep.
- `lib/party/in-memory-store.ts` — **wired**, instantiated by `state-store.ts:74-75`
  (`new InMemoryPartyStateStore()`). The documented horizontal-scale seam, intentionally the only v1
  backing.
- `lib/indexer/flaresolverr.ts`, `lib/safe-redirect.ts` — both imported (indexer discovery/config;
  `login/page.tsx`). Path-grep false positives.
- `components/media/EpisodeRow.tsx` type — the episodes route imports it for a **type only**; the
  React component is still dead UI (B5), but do not remove the type export blindly.
- **LIVE (kept):** `MediaCard.tsx` (5 importers — home/library/browse), `RequestOptions.tsx`
  (3 importers — `browse/[id]`, `DiscoverResults`, route-local `RequestButton`), `SeriesScopeModal.tsx`
  + `TorrentPickModal.tsx` (both via `RequestOptions`), `VideoPlayer.tsx` (`play`/`watch`), and the
  **route-local** `app/browse/discover/[mediaType]/[tmdbId]/RequestButton.tsx`. These are the only 5
  live files in `components/media/` plus the one route-local sibling.
- **Shadow caveat:** `components/media/RequestButton.tsx` (B11a) and the route-local
  `.../[tmdbId]/RequestButton.tsx` are two different files with the same basename. Only the route-local
  one is rendered. The shared one is dead.

### Why the two component chains are genuinely dead (trace)

The live discover detail page is `app/browse/discover/[mediaType]/[tmdbId]/page.tsx`; it imports
`RequestButton` and renders cast/seasons inline (its own JSX), **not** `MediaDetailPanel`. The live
owned-media detail pages (`browse/[id]`, `library/[id]`) import only `MediaCard`, `Button`, and
`RequestOptions`, and render the season/episode accordion inline. So both the
`MediaDetailPanel → Movie/TvDetailPanel → CastGrid/SeasonAccordion/EpisodeRow` chain and the
`SeriesSection → EpisodeCarousel → EpisodeCard/EpisodeToolbar` chain are vestigial earlier
implementations superseded by inline page rendering — confirmed by the chains' **only** importers being
other members of the same chain, with no page/route entry point.
