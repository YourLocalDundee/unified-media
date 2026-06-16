# Audit 06 — Requests Lifecycle (Overseerr-style)

> **Remediation status — 2026-06-15** (see [`../open-issues.md`](../open-issues.md)).
> Fixed: **A6-01** `verifyOrigin` on all 5 mutating requests routes · **A6-02** scope-aware
> `UNIQUE(tmdb_id,type,scope_key)` index + `createItem` fetch-or-create (migration backfills/merges
> existing dupes) · **A6-03** approve rejects non-pending (409) · **A6-08** year guard → 422 + `code` ·
> **A6-10** deterministic item resolution (`ORDER BY id`) · **A6-12** grab-override URL validation ·
> **A6-06/A7-03** interactive picks now queue for admin (no request-time grab). Still open:
> A6-04/A6-05 (cross-user dedup + ownership-aware request button), A6-07 (fold into the fetch-or-create
> cleanup), A6-09/A6-11/A6-13, and the LOW items.

Scope: native request system that replaces Seerr requests. Pages `src/app/requests/*`, API
`src/app/api/requests/**`, components `RequestButton` / `RequestOptions` / `SeriesScopeModal`,
lib `src/lib/requests/{auto-approve,monitor,types}.ts`. Notifications/SMTP skipped per rules.

State machine (as built):
`pending → approved → (grab) → grabbed → imported → available → (48h) → expired`, with
`pending → declined`. Status on `media_requests` is the request truth; `monitored_items.status`
is the automation truth; they are linked only by `(tmdb_id, type)`, never a foreign key.

Headline problems: (1) `monitored_items` has **no uniqueness constraint** and `createItem` is a
plain INSERT, so the "already exists" guards in approve/auto-approve/POST are dead code and every
approve/grab can spawn duplicate monitored rows — progress + grab-results then bind to an arbitrary
one via `LIMIT 1`. (2) **No `verifyOrigin()` / CSRF check on any requests route**, unlike every
auth and party route in the app. (3) Duplicate prevention is **per-user only** (UNIQUE on
`user_id,tmdb_id,media_type`), so N users can each request the same in-flight/owned title and
trigger N parallel grabs; the Request button also never reflects ownership/another user's request.
(4) Approve has no status guard — an already-`available` (or even `declined`) request can be
re-approved, re-grabbed, and reset to `approved`, restarting the 48h slot logic.

## Counts

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 6 |
| LOW | 5 |
| **Total** | **18** |

---

## CRITICAL

### A6-01 — No CSRF/Origin verification on any state-mutating requests route
- Severity: CRITICAL
- Files: `src/app/api/requests/route.ts:37` (POST), `[id]/route.ts:32` (DELETE),
  `[id]/approve/route.ts:106`, `[id]/decline/route.ts:8`, `[id]/grab/route.ts:10`
- What's wrong: None of the mutating handlers call `verifyOrigin()` from `src/lib/csrf.ts`. Every
  other mutating route in the app does (`app/api/auth/*`, `app/api/party/*` all import and call it —
  confirmed by grep). Auth is cookie-based (`unified-session`, `SameSite=lax`), so a cross-site
  `POST`/form submission from another origin rides the user's cookie. `SameSite=lax` blocks
  cross-site POSTs from forms but **not** top-level navigations or certain request shapes, and is the
  app's only defense here — the documented `verifyOrigin` belt is simply missing.
- Why it matters: A malicious page could create requests on a victim's behalf, or — far worse — an
  admin visiting a hostile link could have requests approved/declined/deleted (approve fires real
  torrent grabs and consumes the download client). This is the app's stated CSRF model being
  bypassed for the entire request surface.
- Suggested fix: Add `if (!(await verifyOrigin())) return NextResponse.json({error:'Bad origin'},{status:403})`
  (or the project's existing helper signature) at the top of every POST/DELETE handler in
  `app/api/requests/**`, matching the auth routes.

### A6-02 — `monitored_items` duplicate inserts; "already exists" guards are dead code
- Severity: CRITICAL
- Files: `src/lib/automation/monitor.ts:88` (plain `INSERT INTO monitored_items`, no `ON CONFLICT`),
  consumed at `auto-approve.ts:59-77`, `api/requests/route.ts:166-186`,
  `api/requests/[id]/approve/route.ts:150-169`, `[id]/approve/route.ts:50-69` (`firePreferredGrab`)
- What's wrong: `createItem()` performs an unconditional INSERT and `monitored_items` has no UNIQUE
  index on `(tmdb_id, type)` (migrations only add uniqueness to users/profiles/subtitle_wants, not
  monitored_items). Every call site wraps `createItem` in `try/catch` checking
  `msg.includes('already exists')` — but that string is never thrown, because a duplicate INSERT
  just succeeds and creates a second row. So: approving a request that was already auto-created (e.g.
  quick→interactive that pre-created an item, then admin approve) inserts a duplicate; re-approving
  inserts another; the auto-approve immediate-grab path plus the cron can each create rows.
- Why it matters: `getMonitoredItemIdForRequest` and the various `getAllItems().find(...)` resolve a
  request to a monitored item by `(tmdb_id,type)` with `LIMIT 1` / first-match. With duplicates, the
  grab loop can grab the same title twice, grab-results/progress can read a *different* row than the
  one that was grabbed (showing "no grab attempted" while a download runs, or vice-versa), and
  status transitions (`wanted→grabbed→imported`) get split across rows so an item can stay
  permanently `wanted`/`grabbed` and the request never flips to `available`.
- Suggested fix: Add `CREATE UNIQUE INDEX ... ON monitored_items(tmdb_id, type)` (guard for existing
  dupes first), and make `createItem` `INSERT ... ON CONFLICT(tmdb_id,type) DO NOTHING` returning the
  existing row, or have it look up and return the existing item. Then the dead `try/catch` guards can
  be replaced with a real "fetch-or-create". Resolve request→item by an explicit stored
  `monitored_item_id` rather than a tmdb/type re-lookup.

---

## HIGH

### A6-03 — Approve has no current-status guard (re-approve / re-grab any request)
- Severity: HIGH
- File: `src/app/api/requests/[id]/approve/route.ts:133-196`
- What's wrong: After loading the request, approve only checks `if (!request)`. It does not check the
  current status. An admin (or a CSRF call per A6-01) can POST approve on a request already in
  `approved`, `available`, `declined`, or `expired` state. It will re-`createItem`, set status back to
  `approved` (`updateRequestStatus(id,'approved')` at line 171), and fire another grab.
- Why it matters: Re-approving an `available` quick request resets it to `approved`, which (a) frees
  it from the auto-delete query (`auto-delete.ts` only deletes `status='available'`), so the 48h
  cleanup never fires and the slot leaks, and (b) triggers a duplicate download of content already in
  the library. Re-approving a `declined`/`expired` request silently resurrects it. The UI only shows
  Approve for `pending` rows, but the endpoint is the real boundary.
- Suggested fix: `if (request.status !== 'pending') return 409`. If admins need to re-grab an
  approved item, that is what `[id]/grab` is for (which correctly requires `status==='approved'`).

### A6-04 — Duplicate prevention is per-user only; multiple users grab the same title
- Severity: HIGH
- Files: `src/lib/requests/monitor.ts:45-54` (`getRequestByTmdb` scoped by `user_id`),
  `migrations.ts:316` (`UNIQUE(user_id, tmdb_id, media_type)`), enforced in `api/requests/route.ts:105`
- What's wrong: Uniqueness and the "Already requested" check are scoped to the requesting user. There
  is no check against (a) requests by *other* users for the same title, or (b) an existing
  `monitored_items` row / already-owned `media_items` row. Two users can each create an `approved`
  quick request for the same `tmdb_id`; both create monitored items (A6-02) and both fire grabs.
- Why it matters: Same media downloaded multiple times concurrently; wasted bandwidth/disk; and the
  48h slot/auto-delete logic operates per-request so one user's expiry can delete files another
  user's still-active request depends on (auto-delete keys on `tmdb_id`, not request id —
  `auto-delete.ts:60`). Also a quota concern: per-user slot limits don't bound total system load.
- Suggested fix: Before insert, also check for any non-terminal request for the same `(tmdb_id,
  media_type)` across users and/or an existing monitored/owned item; if present, attach the new user
  to the existing in-flight item (or short-circuit to "already requested/available") instead of
  starting a second pipeline.

### A6-05 — RequestButton/RequestOptions never reflect ownership or other users' requests
- Severity: HIGH
- Files: `src/app/browse/[id]/page.tsx:77` and
  `src/app/browse/discover/[mediaType]/[tmdbId]/page.tsx:79` pass
  `existingStatus = getRequestByTmdb(session.userId, ...)?.status` (per-user only); consumed in
  `RequestButton.tsx:76` / `RequestOptions.tsx:71`
- What's wrong: The button state is derived solely from the *current user's* request row. It does not
  query `media_items` (real ownership) nor other users' requests. The audit brief explicitly requires
  this to query real ownership + request tables. So content already in the library (or already
  being downloaded for someone else) still shows a fresh "+ Request" / "Auto-grab" button.
- Why it matters: Users re-request owned/in-flight content, producing the duplicate-grab path in
  A6-04. Misleading UX: no "Available"/"In Library" affordance for content the server already has.
- Suggested fix: On the detail pages, resolve ownership from `media_items` (by `tmdb_id`+type) and
  in-flight state from any user's request / monitored item, and pass an `available`/`owned` status so
  the component renders a non-actionable badge. (The `browse/[id]` page already has `arrStatus`/`item`
  in scope — owned items can be detected there.)

### A6-06 — Interactive-quick path: torrent added before monitored item / approval is durable
- Severity: HIGH
- File: `src/app/api/requests/route.ts:153-216`
- What's wrong: For quick + interactive, the handler `await client.addTorrent(...)` FIRST (line 159),
  then tries `createItem`, `recordGrab`, `updateItem`, and finally marks the request `approved`. If
  `addTorrent` succeeds but a later step throws (e.g. `createItem` non-"already exists" error,
  registry hiccup), the catch at line 211 leaves the request `pending` and returns `_grabError:true`
  — but the torrent is already downloading with no `grab_history`/`monitored_items` linkage. The
  request looks un-grabbed; progress endpoint finds no `grab_history` row → shows "Searching…"
  forever; re-submitting/approving adds the torrent again.
- Why it matters: Orphaned downloads with no tracking, permanently-stuck "pending" requests that are
  actually downloading, and duplicate adds on retry. Ordering (side-effect before bookkeeping) is the
  root cause.
- Suggested fix: Create the monitored item + record the grab *before or transactionally with* the
  `addTorrent` call, and only return `_grabError` when nothing was added. On partial failure, still
  persist the grab linkage so progress can track it. Consider idempotency by info_hash.

### A6-07 — `firePreferredGrab` on admin-approve records grab with no real info but no add-failure handling, and mislabels the monitored item
- Severity: HIGH
- File: `src/app/api/requests/[id]/approve/route.ts:31-104`
- What's wrong: Two issues. (1) When `createItem` throws (it won't on dup per A6-02, but on any real
  error) the function falls back to `getAllItems().find()`, and if not found `return`s silently —
  approve already set status `approved` (line 171) and the admin sees success, but no grab happened
  and no error surfaced (fire-and-forget, line 44). (2) The fallback `createItem` uses
  `title: picked.releaseTitle` (the raw torrent release name, e.g. `Movie.2009.1080p.BluRay.x264`)
  and `year: undefined` as the monitored item title — corrupting the want-list/library matching that
  keys on title/year.
- Why it matters: Silent grab failures present as successful approvals; progress stays empty. The
  release-title-as-item-title pollutes automation matching and any UI that lists monitored items.
- Suggested fix: Pass the real `request.title`/`request.year` to the fallback `createItem`; surface
  grab failure back to the request (don't mark approved until the add is confirmed, or record a
  failure flag the UI/progress can show). Fold into the A6-02 fetch-or-create.

---

## MEDIUM

### A6-08 — Year guard returns 429 (should be 4xx semantic), and quick-year check is duplicated/diverging
- Severity: MEDIUM
- Files: `src/app/api/requests/route.ts:118-123` (returns 429 for "released this year"),
  also enforced again in `auto-approve.ts:44`
- What's wrong: A content-policy rejection ("48hr only for pre-current-year") returns HTTP 429 (Too
  Many Requests), which is semantically a rate-limit signal. The client (`RequestOptions.tsx:104`)
  treats *all* 429s as "limit reached", so the user sees a slot-limit message for what is actually a
  year-policy rejection. The year rule is also implemented twice (route + auto-approve) with the same
  `>= currentYear` logic; drift risk.
- Why it matters: Wrong/confusing error messaging; two sources of truth for the same business rule.
- Suggested fix: Return 422 (or 400) with a distinct error code for the year rule; have the client
  branch on code. Centralize the year/slot eligibility in one helper used by both POST and
  auto-approve.

### A6-09 — `tryAutoApprove` reads scope from wrong field names (snake vs camel), silently dropping scope
- Severity: MEDIUM
- File: `src/lib/requests/auto-approve.ts:53-56`
- What's wrong: It reads `scope_type`/`scope_seasons`/`scope_episodes`/`monitor_future` off the object
  returned by `getRequestById`. That row comes from `SELECT r.*` so columns ARE snake_case — good —
  but `getRequestById` returns `NativeRequestWithUser` typed with camelCase optionals, and the code
  casts through `Record<string,unknown>` to read snake_case. This works only because the DB columns
  happen to be snake_case; the POST path (`route.ts`) already passed scope into `createRequest`, so by
  the time auto-approve runs the row has the snake_case columns. However for a quick **auto-pick TV**
  request the scope was chosen in `SeriesScopeModal` and *is* persisted, so this path is load-bearing
  and fragile: any future rename of the persisted columns or switch to the typed accessor silently
  drops scope, causing a full-series grab when the user asked for one episode.
- Why it matters: Fragile reliance on raw column names with a typed wrapper that says otherwise; a
  refactor would silently over-grab (whole series instead of selected scope). Worth hardening.
- Suggested fix: Have `getRequestById` expose the scope columns explicitly (typed), and read them by
  name; or read scope via the same parse used in `approve/route.ts` (`SELECT scope_* ...`). Add a
  test asserting episode-scope survives the auto-approve grab.

### A6-10 — Progress/grab-results resolve the monitored item by `(tmdb_id,type)` `LIMIT 1`, no ordering
- Severity: MEDIUM
- Files: `src/app/api/requests/[id]/progress/route.ts:58-70` (grab_history join, `ORDER BY grabbed_at
  DESC LIMIT 1` — ok), `src/lib/automation/grab-results.ts:55-64` (`getMonitoredItemIdForRequest`:
  `SELECT id FROM monitored_items WHERE tmdb_id=? AND type=? LIMIT 1`, no ORDER BY)
- What's wrong: `getMonitoredItemIdForRequest` picks an arbitrary monitored row when duplicates exist
  (A6-02). grab-results are stored per `monitored_item_id`, so the panel may show results for the
  wrong duplicate (or "No grab attempted yet" while another row has them).
- Why it matters: Admin grab-results panel and re-search/override can act on the wrong item; override
  records against an item that isn't the one downloading.
- Suggested fix: After A6-02's uniqueness is in place this is moot; until then add a deterministic
  `ORDER BY created_at DESC` and ideally resolve via a stored `monitored_item_id` on the request.

### A6-11 — Approve always re-creates the monitored item even when one exists, and ignores scope drift
- Severity: MEDIUM
- File: `src/app/api/requests/[id]/approve/route.ts:150-169`
- What's wrong: Approve unconditionally calls `createItem` with the request's scope. If the item was
  already created at request time (interactive paths) with a given scope, approve's second create is
  meant to be swallowed by the dead "already exists" guard (A6-02) — meaning the approve-time scope is
  silently discarded (the first row's scope wins) OR, post-fix with INSERT, a duplicate is made. Net:
  if a user's persisted scope differs from what was first written, behavior is undefined.
- Why it matters: Scope ambiguity between request-time and approve-time; with the A6-02 dup bug it can
  also double-grab.
- Suggested fix: Make this an explicit upsert that updates scope on the existing monitored item, or
  trust the request-time item and skip re-create. Single fetch-or-create helper.

### A6-12 — `grab` override path does not validate magnet/URL and ignores scope/language
- Severity: MEDIUM
- File: `src/app/api/requests/[id]/grab/route.ts:35-45`
- What's wrong: When `body.magnetUrl` is present, it is passed straight to `client.addTorrent({urls:
  body.magnetUrl, category: item.type})` with no validation (not checked for `magnet:`/http scheme,
  no SSRF/format guard) and `info_hash` defaults to `''` when omitted. An empty info_hash breaks the
  progress join (`progress/route.ts` requires `grab.info_hash`) so the override download is untrackable.
- Why it matters: Admin override can submit arbitrary `urls` to the download client (admin-gated, so
  lower risk, but unvalidated), and a blank info_hash makes progress show nothing for a real download.
- Suggested fix: Validate scheme/shape; require or derive info_hash; reject empties. Mirror the
  bookkeeping done in `firePreferredGrab` (recordGrabResults) so the override is reflected in the panel.

### A6-13 — Status `CHECK` widening migration vs. statuses written: `available`/`expired` set by automation
- Severity: MEDIUM
- Files: `migrations.ts:351-422` (widens CHECK to include `expired`), writers
  `availability.ts` (`status='available'`), `auto-delete.ts` (`status='expired'`)
- What's wrong: The terminal states `available`/`expired` are written only by the automation crons,
  never by the request API, and are reachable only if those schedulers run (instrumentation). If the
  availability cron is disabled or the `(tmdb_id,type)` match fails (e.g. item has no tmdb_id, or
  scanner stores a different type), an approved+downloaded request never advances to `available` and a
  quick request never gets `auto_delete_at`, so it both shows "Approved" forever and never frees its
  slot. `isInNativeLibrary` returns false for null tmdb_id (`availability.ts`), a silent stuck state.
- Why it matters: Requests can get permanently stuck at `approved` with the slot consumed; user sees
  no progression and cannot self-serve (delete frees it, but the meter looks "full" misleadingly).
- Suggested fix: Add a reconciliation/timeout that flags long-stuck `approved` items, and a UI hint.
  Ensure the availability match handles tmdb-less/type-mismatch items (log them). Confirm schedulers
  are always started.

---

## LOW

### A6-14 — Non-admin delete is fire-and-forget with no rollback; optimistic row vanishes on server failure
- Severity: LOW
- File: `src/app/requests/RequestsTable.tsx:1078-1085`
- What's wrong: Non-admin delete removes the row from local state and fires `fetch(... DELETE)` with
  `.catch(()=>{})` — no await, no status check, no revert. If the server rejects (e.g. 404/500), the
  UI still shows it gone until refresh.
- Why it matters: Optimistic UI without rollback; user believes a delete succeeded when it may not
  have. (Admin path does check `res.ok`.)
- Suggested fix: Await the response; on non-2xx, re-insert the row and show an error toast.

### A6-15 — POST success path reads `data.status` but interactive-quick returns full request; success badge logic brittle
- Severity: LOW
- Files: `src/components/media/RequestOptions.tsx:116-119` and `RequestButton.tsx:108`
- What's wrong: `RequestOptions.submitAutoGrab` sets `currentStatus = data.status ?? 'pending'`, which
  is correct for the auto-pick path (returns the request row incl. `status`). But `RequestButton`
  (the simple one) always sets `'pending'` regardless of the returned status, so an auto-approved
  quick movie requested via that button shows "Requested" then a stale pending badge instead of
  "Approved"/"Available". `RequestButton` also hardcodes longterm (no requestType in body), so it can
  only ever produce pending — acceptable, but the success copy ("Requested!") then a pending badge is
  slightly misleading for the quick flows it's reused in.
- Why it matters: Minor status mislabeling depending on which component renders.
- Suggested fix: Use the returned row's `status` in `RequestButton` too, or document it as longterm-only.

### A6-16 — `_grabError` flag on POST response is never surfaced to the user
- Severity: LOW
- Files: `src/app/api/requests/route.ts:215` returns `{..., _grabError:true}` with 201; clients
  (`RequestOptions.tsx:116`, `RequestButton.tsx`) ignore the flag
- What's wrong: When an interactive-quick grab fails, the API returns 201 with `_grabError:true` and
  the request left pending, but neither client reads `_grabError`. The user sees a normal
  "Requested/Pending" with no indication the immediate grab failed.
- Why it matters: Silent partial failure; user thinks the quick grab is in progress.
- Suggested fix: Read `_grabError` and show a "grab failed, queued for retry/admin" message.

### A6-17 — SeriesScopeModal: season "select all" checkbox can't toggle before episodes load; episodes-scope monitorFuture forced false
- Severity: LOW
- File: `src/components/media/SeriesScopeModal.tsx:442-447`, `298`
- What's wrong: The per-season aggregate checkbox in episodes mode only toggles
  `toggleAllEpisodesInSeason` when `episodeCache.has(season)` (line 444) — clicking it before
  expanding does nothing (no feedback). Separately, `episodes` scope hardcodes `monitorFuture:false`
  (line 298), and the footer hides the monitor-future control for episodes — intentional, but means a
  user can't monitor-future an episode-scoped request even if desired. Minor UX gaps, scope still
  flows correctly to the request body.
- Why it matters: Mild UX confusion; not a correctness bug in the grab scope itself.
- Suggested fix: Auto-load episodes on aggregate-checkbox click, or disable the control with a hint
  until expanded.

### A6-18 — Progress + grab-results polling: no backoff, polls while terminal, admin grab-results panel re-fetches via render-phase side effect
- Severity: LOW
- Files: `src/app/requests/RequestsTable.tsx:235-255` (DownloadProgress 5s interval),
  `:346-348` (GrabResultsPanel calls `load()` during render when `data===undefined`)
- What's wrong: `DownloadProgress` polls `/progress` every 5s with a fixed interval and keeps polling
  even after the torrent shows Complete/Imported (no terminal stop, no backoff). It only mounts for
  `!adminMode && approved` rows, so it stops when the request leaves `approved` (re-render unmounts)
  — but a long-seeding "Complete" torrent is polled indefinitely while the row stays approved. Cleanup
  itself is correct (`cancelled` flag + `clearInterval` on unmount). `GrabResultsPanel` triggers
  `load()` directly in the render body (line 347) guarded by `data===undefined && !loading`, an
  anti-pattern that can double-fire under StrictMode/concurrent render.
- Why it matters: Unnecessary network churn on completed items; render-phase fetch is fragile.
- Suggested fix: Stop the interval once `isComplete`/`imported`; add modest backoff. Move the
  grab-results initial load into `useEffect`.

---

## State-machine summary (where it can stick / double-process)

- **Stuck at `approved`**: availability cron not running, or `(tmdb_id,type)` mismatch / null tmdb_id
  → never `available`, quick slot never freed (A6-13).
- **Double-process**: re-approve (A6-03), cross-user duplicate requests (A6-04/A6-05), duplicate
  monitored_items (A6-02), interactive-quick partial failure + retry (A6-06) all cause the same title
  to be grabbed/downloaded more than once.
- **Slot leak**: re-approving an `available` quick request resets it to `approved`, removing it from
  the auto-delete query (A6-03).
- **Untrackable downloads**: interactive-quick partial failure (A6-06), override with blank info_hash
  (A6-12), preferred-grab silent fallback (A6-07) → torrent runs with no/incorrect grab linkage,
  progress shows "Searching…" forever.
- **Authz**: approve/decline/grab/grab-results are correctly `requireAdmin()` server-side; GET/DELETE
  `[id]` correctly 404 on non-owner non-admin (good, no IDOR there). The gap is CSRF (A6-01) and the
  missing status guard on approve (A6-03), not role enforcement.
