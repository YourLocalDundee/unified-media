# Open Issues — reconciled register

Single source of truth for what is still broken or missing, reconciled against the live code on
**2026-06-16** (the docs were stale in several places). Supersedes the scattered status in
`CLAUDE.md` "Known Issues", `audit-2026-06-13/`, `FEATURE_STATUS.md`, and `implementation-status.md`
for the question "what is still open."

Sources scanned: `CLAUDE.md`, `analysis/audit-2026-06-13/00..21`, `FEATURE_STATUS.md`,
`implementation-status.md`, `PARTY_PLAY_AUDIT.md`, `CHANGELOG.md`, `docs/{claude-md-audit,stack-audit}.md`.

Severity tags mirror the audit (S = security, D = data/engine, F = functional, A##-## = audit finding id).

---

## Closed (verify when convenient, then delete from this list)

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
- **S1 (partial)** auth gates added to the qbit proxy, torznab search, and the 4 ungated Jellyfin
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
  automation/*, jellyfin sessions/*, media playback/progress/scan, quality-profiles/*, subtitle/*).
  Only `seerr/webhook` is intentionally excluded (external caller).
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
  - `hwAccel` (server-side transcoding decision — leave as-is); `skipIntro` (no intro detection — leave as-is).
- ~~**`S`/`N` shortcuts**~~ — **CLOSED 2026-06-20**: `S` cycles subtitle tracks (off→0→1→…→off) and `N` skips to next episode. Both bound in VideoPlayer keydown handler via `nextEpisodeRef` (keeps closure current). Shortcuts page expanded with all real bindings (K/J/L/,/./0-9/I/Shift+arrows).

## OPEN — Medium / Low remainder

- **A7-10** two parallel qBit SID caches — left separate by design (different lifetimes/credential
  sourcing); the `clearSession`-on-failed-retry fix (A7-11) was applied to both. Unify only if revisited.

**CLOSED 2026-06-20 (medium/low triage):**
- **A21-02** CSS injection via custom theme colors — `buildCustomThemeCSS` now sanitizes all six color fields through `sanitizeColor(val, fallback)` (rejects anything not matching `#[0-9a-fA-F]{3,8}`).
- **A21-08** Unguarded `JSON.parse` in grabber — all 5 call sites in `grabber.ts` now wrapped in try/catch with `Array.isArray` guard; malformed DB columns fail safely instead of crashing the cron.
- **A15-M4/M5** Subtitle file write — added `r.ok` check on the download link fetch, basic SRT validation (content must begin with a digit), and atomic write (write to `.pid.tmp` then rename).
- **A7-15** TorrentPickModal season/episode re-search — `runSearch` now uses an `AbortController` ref; each call aborts the previous in-flight search so rapid dropdown changes don't produce stale overwrites.
- **A8-M2** Dead Jellyfin URL override — section marked disabled + "not yet wired" label; controls non-functional to prevent user confusion.
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

- **Download clients** — Transmission + Deluge are still unimplemented (now fail loudly at selection,
  A7-02 done). Implementing them is a feature, not a defect.
- **Subtitle search** — DONE (v0.9.11). Server-side auto-download plus on-demand player search with live
  `<track>` injection (IMDB id resolved server-side); served by stable `subtitle_wants.id`. See CLAUDE.md §10b.
- **Theme marketplace** — custom themes work; export/import/share-string not.
- **Keyboard shortcut reference** — static table at `/settings/shortcuts`; auto-generation from a
  registry not.
- **Admin audit-log CSV export** — not done (watch-activity export exists).
- **Independence build is past MVP** — decision **gate-chain + rejection reasons**, **real custom
  formats** (language/group/size/flags), and **blocklist** shipped v0.10.0 (CLAUDE.md §17). Still
  grabbable from the mining docs but NOT built: upgrade-until-cutoff/proper-repack, auto-retry on failed
  grab, indexer health/backoff, notifications, import lists.

## Feature backlog (CLAUDE.md §13 + feature-mining)

Not defects. **SHIPPED v0.10.0** from the mining list: decision gate-chain + rejection reasons (Tier-1 #1),
real custom formats (Tier-1 #2), Party Play shared queue with auto-advance (Tier-1 #3). Remaining top
candidates: voice chat, Discord/ntfy notifications, upgrade-until-cutoff, blocklist auto-retry, indexer
health/backoff. See `feature-mining-summary.md`.

---

## Doc drift

*(All three doc-drift items closed 2026-06-19 — see session notes above.)*
