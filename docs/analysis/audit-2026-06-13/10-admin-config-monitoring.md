# A10 — Admin Config & Monitoring Audit (2026-06-13)

Scope: admin config UIs (`/admin/server`, `monitoring`, `settings`, `media-server`, `subtitles`,
`requests`, `automation`, `automation/bridge`, `indexers`, `quality-profiles`) and their direct
endpoints (`/api/admin/settings`, `monitoring`, `server-status`, `/api/health`,
`/api/automation/bridge`, `/api/quality-profiles[/[id]]` + the per-page endpoints those pages call).
READ-ONLY. SMTP/email + notifications excluded. Deep engine internals out of scope (other agents).

## Summary

RBAC is solid: every admin page is wrapped by `AdminLayout` → `requireAdmin()`, every page server
component re-guards, and **every** in-scope API route calls `requireAdmin()` server-side (verified
route-by-route). No unguarded admin route was found. The big-ticket problems are elsewhere:

1. **Secret echo** — the indexer GET routes `SELECT *` and return `api_key` in plaintext to the
   browser, and the edit form binds it into client state. (A10-01, HIGH)
2. **No CSRF / Origin check on any state-mutating admin or config endpoint** — the app ships a
   `verifyOrigin()` helper documented as protecting "state-mutating routes," but zero admin/config
   routes call it (settings PUT, indexer/quality-profile/automation/subtitle mutations). (A10-02, HIGH)
3. **Settings save has no real feedback and no validation** — `/admin/settings` Save never checks
   `res.ok` (always shows "Saved."), and the settings PUT persists arbitrary unvalidated string
   key/values with no bounds. (A10-03 / A10-04)
4. **Server Status qBittorrent check is wrong** — reads `QBT_URL` (the app uses `UMT_URL`
   everywhere) and probes an auth-required endpoint with no SID cookie, so UMT shows Offline even
   when healthy. (A10-05, HIGH)
5. **Heavy long-running work inside request handlers** — `/api/media/scan` runs full sequential
   ffprobe + TMDB enrichment (250ms/item) in the request; `/api/media/stats` and several pages also
   refetch. (A10-08)
6. **Quality-profile delete has no orphan handling / no guard on default profile.** (A10-09)

Plus several MEDIUM/LOW feedback + polling-efficiency issues below.

## Counts

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 4 |
| MEDIUM | 8 |
| LOW | 4 |
| **Total** | **16** |

---

## CRITICAL

_None._ (Authz is enforced everywhere in scope; no unauthenticated mutation path was found.)

---

## HIGH

### A10-01 — Indexer `api_key` echoed to the client in plaintext
**Severity:** HIGH
**Files:**
`src/lib/indexer/config.ts:7-23` (`getAllIndexers`/`getIndexerById` do `SELECT *`),
`src/app/api/indexer/route.ts:7-11` (GET returns it),
`src/app/api/indexer/[id]/route.ts:7-25` (GET returns it),
`src/app/admin/indexers/page.tsx:223` (`openEditModal` binds `indexer.api_key` into form state).

**What's wrong:** `GET /api/indexer` and `GET /api/indexer/[id]` return the full row including
`api_key`. The indexers list page loads them all on mount and stores them in client React state, and
the edit modal pre-fills the API key field with the stored secret. The Torznab/Newznab API key is a
credential for an upstream indexer and is exposed in the JSON response and the DOM.

**Why it matters:** The architecture intent (CLAUDE.md) is that service API keys "never leave the
server." Any admin-session XSS, browser extension, or shared-screen situation leaks the indexer key.
The `pending_credentials`/activate flow also round-trips creds through the client.

**Suggested fix:** Strip `api_key` (and any credential fields) from the GET DTOs — return a boolean
`has_api_key` instead. On edit, send the key only if the admin re-enters it (treat blank = unchanged).
Mirror the masking already done for password-type fields in the pending-credentials form.

---

### A10-02 — No CSRF / Origin verification on any state-mutating admin or config route
**Severity:** HIGH
**Files (all mutating routes in scope — none call `verifyOrigin`):**
`src/app/api/admin/settings/route.ts:16` (PUT),
`src/app/api/indexer/route.ts:13` (POST), `…/indexer/[id]/route.ts:27,60` (PATCH/DELETE),
`…/indexer/[id]/test/route.ts:8` (POST), `…/indexer/[id]/activate/route.ts:8` (POST),
`src/app/api/quality-profiles/route.ts:17` (POST), `…/quality-profiles/[id]/route.ts:20,81` (PATCH/DELETE),
`src/app/api/automation/items/route.ts:22` (POST), `…/items/[id]/route.ts` (DELETE),
`…/items/[id]/grab/route.ts:18` (POST), `…/automation/sync/route.ts:18` (POST),
`src/app/api/subtitle/[id]/route.ts:8,30` (PATCH/DELETE), `…/subtitle/scan/route.ts:7`,
`…/subtitle/download/route.ts:7`, `src/app/api/media/scan/route.ts:8`.
Helper exists and is unused here: `src/lib/csrf.ts` (`verifyOrigin`).

**What's wrong:** A grep for `verifyOrigin` across `app/api/admin`, `indexer`, `automation`,
`subtitle`, `media`, `quality-profiles` returns **zero** hits. All of these mutate server state
(settings, indexers incl. live network tests, quality profiles, monitored items, grabs, subtitle
files, full library scans) using only the session cookie for authz. The cookie is `SameSite=lax`,
which blocks cross-site POST form submits but **not** top-level navigations and not all request
shapes; the project's own convention is to defend in depth with `verifyOrigin` on mutations.

**Why it matters:** Inconsistent with the documented security model ("`verifyOrigin()` — checks
Origin header on state-mutating routes"). An admin who visits a malicious page could be made to
trigger destructive admin actions (delete indexer/profile, force grabs, trigger expensive scans).

**Suggested fix:** Add `if (!verifyOrigin(req)) return 403` to every mutating handler (the pattern
already used by the auth/profile routes). Note `verifyOrigin` returns `true` when Origin is absent,
so server-to-server callers are unaffected.

---

### A10-05 — Server Status qBittorrent/UMT health check uses wrong env var and unauthenticated probe
**Severity:** HIGH
**File:** `src/app/api/admin/server-status/route.ts:16-33,52`

**What's wrong:** Two defects in the UMT health check:
1. **Env var mismatch:** it reads `process.env.QBT_URL`, but the whole app standardises on `UMT_URL`
   (`src/lib/download-client/config.ts:18`, CLAUDE.md `.env.local` block). `QBT_URL` is never
   documented or set, so it always falls back to the hardcoded `http://qbittorrent:8080`. In dev
   (`UMT_URL=http://192.168.0.50:8080`) the probe hits the wrong host and reports Offline.
2. **Unauthenticated probe:** `checkService` does a bare `fetch('…/api/v2/app/version')` with no SID
   cookie. qBittorrent's Web API requires a session cookie; the rest of the app goes through
   `qbitFetch`/`session.ts` for exactly this reason. Without "bypass auth for localhost/subnet"
   enabled, `/app/version` returns 403 → `qbit.ok=false`. [unverified: exact 403 depends on the
   server's bypass-auth setting, but the call path is definitely missing auth.]

**Why it matters:** The Server Status page's "Online/Offline" indicator for the primary download
client is unreliable — it can show a healthy qBittorrent as Offline (or, if bypass-auth is on,
appear to work only by accident). Admins lose trust in the dashboard.

**Suggested fix:** Use `getDownloadClientConfig()` / `UMT_URL` for the base URL, and reuse the
existing authenticated `qbitFetch`/session layer (or POST `/auth/login` then send the SID) to query
version. Treat a 403 distinctly from unreachable.

---

### A10-08 — `/api/media/scan` runs the full ffprobe + TMDB enrichment synchronously in the request
**Severity:** HIGH
**Files:** `src/app/api/media/scan/route.ts:8-15`,
`src/lib/media-server/scanner.ts:146-155` (`scanAll` → `scanFile` → `probeFile`),
`src/lib/media-server/enricher.ts:79-112` (`enrichAll`),
`src/lib/media-server/probe.ts:24` (spawns `ffprobe` via `execFile` per file).
Page button: `src/app/admin/media-server/page.tsx:55-73` (`runScan` awaits the whole thing).

**What's wrong:** `POST /api/media/scan` calls `scanAll()` (loops every `media_items` row with a
`file_path`, awaiting an `ffprobe` child process per file) then `enrichAll()` (loops every
un-enriched item, each doing a TMDB `fetch` followed by a hard `await sleep(250ms)`), and only then
returns. For a real library this is minutes-to-tens-of-minutes of work held open on one HTTP request.
The work is I/O-bound (won't peg the event loop), but the request will exceed typical
proxy/Caddy/BunkerWeb timeouts and the UI button spins with no progress and no cancellation.

**Why it matters:** Practical failure mode: the proxy times out the connection, the admin sees
"Network error while triggering scan" even though the scan is still running server-side; or the scan
is silently truncated. No incremental feedback, no idempotent re-run signal.

**Suggested fix:** Make scan/enrich a background job (the project already starts schedulers from
`src/instrumentation.ts`): kick the job, return `202 { started: true }`, and have the page poll
`/api/media/stats` (or a job-status endpoint) for progress. At minimum add an `AbortSignal`/timeout
and stream partial counts. The same pattern applies to `/api/subtitle/scan` and `/subtitle/download`
(engine logic out of scope, but the button/endpoint shape is identical).

---

## MEDIUM

### A10-03 — `/admin/settings` Save never checks the response; "Saved." is always shown
**Severity:** MEDIUM
**File:** `src/app/admin/settings/page.tsx:24-35`

**What's wrong:** `save()` does `await fetch(... PUT ...)` but never inspects `res.ok` or catches a
network error. It unconditionally sets `saved = true` and shows the green "Saved." text. A 500, a
redirect to `/login` (session expired → `requireAdmin` redirects), or a network failure all still
render success.

**Why it matters:** The single persisted admin setting (`auto_approve`, which actually gates request
auto-approval) can silently fail to save while the admin believes it took effect.

**Suggested fix:** Branch on `res.ok`; show an error state on failure (the subtitles and media-server
pages already do this correctly and can be copied).

---

### A10-04 — Settings PUT persists arbitrary, unvalidated string key/values
**Severity:** MEDIUM
**Files:** `src/app/api/admin/settings/route.ts:16-27`, `src/lib/settings/index.ts:11-13`

**What's wrong:** The PUT handler iterates `Object.entries(body)` and writes any `string`→`string`
pair via `setSetting` (`INSERT OR REPLACE`). There is no key allowlist, no value validation, and no
size bound. An admin (or a CSRF per A10-02) can write unbounded arbitrary rows into `app_settings`.
There is also no typing/range check on values that are later read as booleans/numbers elsewhere.

**Why it matters:** Settings are a shared global store read across the app; junk or oversized keys
pollute it and there is no schema guard. Combined with A10-02 it is a write-anything primitive.

**Suggested fix:** Keep an explicit allowlist of known setting keys with per-key
validators/coercion; reject unknown keys (or ignore them but never persist). Bound value length.

---

### A10-06 — `/admin/monitoring` ignores fetch failure (blank table, no error)
**Severity:** MEDIUM
**File:** `src/app/admin/monitoring/page.tsx:39-45`

**What's wrong:** The mount effect does `fetch('/api/admin/monitoring').then(r => r.json())…` with no
`res.ok` check and no `.catch`. On a 5xx or an HTML redirect body the `.json()` parse throws an
unhandled rejection and the page is stuck showing an empty user table with the loader cleared (the
`.finally` still sets `loading=false`), giving no indication anything failed.

**Why it matters:** Monitoring is a diagnostic surface; a silent empty state is misleading during an
actual incident.

**Suggested fix:** Check `res.ok`, set an error banner on failure (and guard `.json()`).

---

### A10-07 — Subtitle Skip/Delete actions have no `res.ok` check or feedback
**Severity:** MEDIUM
**File:** `src/app/admin/subtitles/page.tsx:101-114`

**What's wrong:** `skipItem()` and `deleteItem()` fire `PATCH`/`DELETE` then immediately
`fetchItems()` with no inspection of the response. A failed mutation (404 stale id, 500) produces no
error; the row simply reappears after refetch, which reads as a confusing no-op. (The Scan/Download
buttons on this page *are* handled correctly — this is specifically the row actions.)

**Why it matters:** Inconsistent feedback; an admin can't tell a failed delete from a UI glitch.

**Suggested fix:** Check `res.ok`; surface the existing `error` banner on failure.

---

### A10-09 — Quality-profile DELETE: no orphan handling, no default-profile guard
**Severity:** MEDIUM
**Files:** `src/app/api/quality-profiles/[id]/route.ts:81-92`,
`src/lib/db/migrations.ts:167` (`monitored_items.quality_profile_id INTEGER NOT NULL DEFAULT 1`, no FK),
`src/lib/automation/grabber.ts:200-206` (fallback).

**What's wrong:** `DELETE /api/quality-profiles/[id]` removes `quality_profile_formats` rows and the
profile row, but does **not** look at `monitored_items` that reference it via `quality_profile_id`.
There is no foreign key, so those rows are left pointing at a now-nonexistent profile id. There is
also no guard preventing deletion of profile id 1 (the schema default that every new item falls back
to: `monitor.ts:107 quality_profile_id ?? 1`) or of the last remaining profile. The page lets you
delete the currently-selected profile with no warning about referencing items.

**Why it matters:** Deleting the default (id 1) means every future `createItem` writes a
`quality_profile_id` that resolves to nothing. It "works" only because the grabber degrades to an
"Any" profile (`getProfileById(...) ?? {id:0,name:'Any'}`), silently downgrading quality rules
without any admin-visible signal.

**Suggested fix:** On delete, reassign referencing `monitored_items` to a default profile (or block
deletion if any reference it, returning a 409 with the count). Forbid deleting profile id 1 / the
last profile. Optionally add a real FK with `ON DELETE SET DEFAULT`.

---

### A10-10 — Server-status / monitoring run unindexed correlated subqueries and `SELECT *` table scans on every poll
**Severity:** MEDIUM
**Files:** `src/app/api/admin/monitoring/route.ts:17-32` (6 correlated subqueries per user row),
`src/app/api/admin/server-status/route.ts:58-61` (`COUNT(*)` over users/sessions/watch_events/audit_log).

**What's wrong:** `/api/admin/monitoring` builds, per user, six correlated subqueries against
`watch_events`, `sessions`, and `audit_log` (incl. `ORDER BY … LIMIT 1`). `/api/admin/server-status`
runs four full `COUNT(*)` scans and is polled every 15s by `/admin/server` (A10-11). On a server with
a large `audit_log`/`watch_events` and no covering indexes on `(user_id, …)` these are repeated table
scans. [unverified: index coverage — depends on `migrations.ts` index definitions, which I did not
exhaustively enumerate.]

**Why it matters:** Cost grows with history × users × poll frequency. The server-status counts in
particular re-scan `audit_log`/`watch_events` every 15 seconds per open admin tab.

**Suggested fix:** Ensure indexes on `watch_events(user_id, started_at)`, `sessions(user_id,
last_seen)`, `audit_log(user_id, created_at)`. For counts, consider `COUNT(*)` is fine on indexed
tables; otherwise cache server-status counts for a few seconds. Lengthen the server-status poll
interval (see A10-11).

---

## LOW

### A10-11 — Server Status polls every 15s with no visibility gating; stacks per open tab
**Severity:** LOW
**File:** `src/app/admin/server/page.tsx:34-40`

**What's wrong:** `setInterval(refresh, 15_000)` fires regardless of whether the tab is visible/
focused. Cleanup on unmount is correct, but a backgrounded admin tab keeps polling `server-status`
(which does the DB counts + a 3s network probe) forever. Each open admin tab is an independent poller.

**Why it matters:** Wasted DB scans + qBT probes for a page nobody is looking at; multiplied across
tabs/admins. Minor but pure overhead.

**Suggested fix:** Pause polling when `document.hidden` (visibilitychange), or back off the interval
(30–60s) for a status page. Consider sharing via React Query with a single cache key.

### A10-12 — Quality-profiles list/create + initial load swallow errors (no failure UI)
**Severity:** LOW
**File:** `src/app/admin/quality-profiles/page.tsx:380-403`

**What's wrong:** `load()` does `await fetch(...); await res.json()` with no `res.ok`/catch — a
failure leaves the page stuck on "Loading quality profiles…" forever. `createProfile()` only acts on
`res.ok` but shows nothing on failure. The per-profile `save()`/`handleNewFormat()`/`handleDelete()`
do check `res.ok` and set a message (good), so this is just the page-level load/create paths.

**Why it matters:** A transient 5xx on load bricks the page with no retry affordance.

**Suggested fix:** Add `res.ok` checks + an error/retry state to `load()` and `createProfile()`.

### A10-13 — Automation "Grab Now" trusts `res.json()` without `res.ok`; can mislabel errors as a result
**Severity:** LOW
**File:** `src/app/admin/automation/page.tsx:145-162`

**What's wrong:** `handleGrab` reads `data.result` from the response without checking `res.ok`. The
grab endpoint returns `{error}` with 4xx/5xx (e.g. 404 "Item not found", or a thrown 500). In those
cases `data.result` is `undefined`, so `grabButtonLabel` falls through to "Error" — which happens to
be acceptable, but a 404/500 body is treated as a normal result rather than surfacing the actual
message. (Delete/Create on this page handle errors correctly.)

**Why it matters:** Minor — the failure is visually indicated but the real reason is hidden.

**Suggested fix:** Branch on `res.ok`; on failure read `data.error` into the per-item state / global
error banner.

### A10-14 — `/admin/media-server` is mislabeled "Phase 5 in active development" and exposes only env-var docs, not editable config
**Severity:** LOW
**File:** `src/app/admin/media-server/page.tsx:18-34,164-176`

**What's wrong:** The page presents `MEDIA_ROOTS` / `TMDB_ACCESS_TOKEN` / `TRANSCODE_CACHE` as
read-only documentation cards (they're env vars, not editable settings) and carries an "About Phase 5
… in active development" note, despite CLAUDE.md marking the media server as shipped (v0.9.5). It is
not a config form — there is nothing to save — which is fine, but it reads as unfinished and gives no
indication whether the required vars are actually *set* (it can't, since they're server-side).

**Why it matters:** Cosmetic/UX: an admin can't tell from this page whether configuration is valid;
the stale "in development" copy undermines confidence. Not a functional defect.

**Suggested fix:** Replace the static cards with a server-side check (reuse `/api/admin/server-status`
or add a config-health endpoint) reporting whether each required var is present and each path is
readable. Drop the "Phase 5 in development" note.

---

## Cross-cutting notes (verified, not findings)

- **RBAC PASS:** `AdminLayout` (`src/app/admin/layout.tsx:30`) calls `requireAdmin()`; every page
  server component that has one re-guards; and every in-scope API route handler calls
  `requireAdmin()` before doing work (settings, monitoring, server-status, bridge, quality-profiles
  GET/POST/PATCH/DELETE, indexer all routes, automation items/grab/sync/profiles/queue, subtitle
  scan/download/[id], media scan/stats). `/admin/requests/page.tsx` guards then redirects to
  `/requests`. No unguarded admin route found.
- **`/api/health`** (`src/app/api/health/route.ts`) is intentionally public (liveness probe), returns
  no sensitive data, 200/503 only — correct and appropriately unauthenticated.
- **Good feedback examples** (copy these patterns): media-server Scan (`scanError`/`scanResult`),
  subtitles Scan/Download banners, indexers Test/Add/Edit/Delete (all check `res.ok`), automation
  Add Item + Delete, bridge Sync (`syncResult`), per-profile Save/Delete.
- **Bridge page** (`/admin/automation/bridge`) Sync + Refresh are correctly wired with feedback and
  refresh the table; `force-dynamic` set on the endpoint. No issues.
- **Admin Requests client** (`AdminRequestsClient.tsx`) approve/decline/delete all check `res.ok`
  before mutating local state — the request *engine* endpoints (`/api/requests/...`) are out of scope
  (covered by the requests agent); client wiring here is sound.
