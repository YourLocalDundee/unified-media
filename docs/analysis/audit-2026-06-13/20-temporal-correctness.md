# A20 — Temporal Correctness Audit

App: unified-frontend (Next.js 16, TypeScript, better-sqlite3, node-cron). Read-only cross-cutting pass on time / date / expiry / cron / timezone / timestamp-format correctness. SMTP/notifications skipped per scope.

## Summary

The codebase made one excellent global decision that eliminates the classic SQLite bug class: **every timestamp column in the schema is declared `INTEGER`** (`src/lib/db/migrations.ts`), and essentially everything writes `Date.now()` (epoch **milliseconds**) and reads/compares against `Date.now()`. There is **no** `CURRENT_TIMESTAMP` / `datetime('now')` text column anywhere, so the "UTC text written, parsed as local/NaN in JS" trap never occurs. Session rolling-TTL / 24h-rotation / 90-day-absolute math in `dal.ts` is unit-consistent and correct. External-API epochs that ARE in seconds (qBittorrent `added_on`/`eta`, YTS/EZTV `*_unix`) are correctly multiplied by 1000 at the boundary. Party-play cross-machine time sync uses a proper clock-offset (EMA) model and tick extrapolation — sound.

The real defects are in **request expiry / auto-delete** and **playback recency state**:

1. **Admin-approved *quick* requests never auto-delete** — the set side keys on `request_type='quick'`, the delete side requires `auto_approved=1`; admin approval sets neither. The 48h slot leaks forever (HIGH).
2. **`last_played` is NULL for every in-progress row**, yet two Continue-Watching code paths order by it — resume ordering and per-series "latest episode" selection are effectively random (HIGH).
3. **`watch_events` is never written** (only ever DELETEd) — every watch-history / watch-stats surface that reads `started_at` / `ended_at` / `watched_sec` is permanently empty (HIGH).

Cron expressions match their comments (field order/ranges correct). The 3 AM subtitle jobs run in container TZ, which is unset (UTC) in the documented compose — cadence is fine, wall-clock-of-day drifts to UTC (MEDIUM).

## Counts by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 3 |
| Medium | 3 |
| Low | 4 |
| Info | 3 |

---

## HIGH

### A20-01 — Admin-approved "quick" requests never auto-delete (48h slot leak)
- Severity: High
- Files: `src/app/api/requests/[id]/approve/route.ts:171`; `src/lib/automation/availability.ts:121-126`; `src/lib/automation/auto-delete.ts:35-39`
- What's wrong: The hourly auto-delete job selects `WHERE auto_approved = 1 AND status = 'available' AND auto_delete_at IS NOT NULL AND auto_delete_at <= now`. The admin approve route marks the row `approved` via `updateRequestStatus(id, 'approved')` and **never sets `auto_approved = 1`** (unlike the self-serve quick paths in `auto-approve.ts:81` and `requests/route.ts:206`). When the item later imports, `availability.ts` sets `auto_delete_at` gated only on `request_type = 'quick'` (it does NOT look at `auto_approved`). Result: an admin-approved *quick* request ends up with a valid `auto_delete_at` but `auto_approved = 0`, so the delete query's `auto_approved = 1` filter permanently skips it.
- Why it matters: The 48h quick slot is never freed for that title. Files stay on disk indefinitely, and the per-user quick-slot limit (`LIMITS = { movie: 1, tv: 2 }`, counted by `getActiveAutoApprovedCount` over `status IN ('approved','available')` with `request_type='quick'`) silently fills, blocking the user from making new quick requests. The lifecycle is keyed on two different columns on the set side (`request_type`) vs the delete side (`auto_approved`), which only agree for the self-serve path.
- Suggested fix: Pick one column as the single source of truth for "auto-managed quick content." Simplest: change the auto-delete query to `WHERE request_type = 'quick' AND status = 'available' AND auto_delete_at <= now` (matches the set side in `availability.ts`). Alternatively set `auto_approved = 1` in the admin approve route when `request.request_type === 'quick'`.

### A20-02 — Continue-Watching ordered (and de-duplicated) by always-NULL `last_played`
- Severity: High
- Files: `src/lib/media-server/library.ts:139-154` and `:105-137`; `src/app/api/jellyfin/continue-watching/route.ts:43-122`; writer evidence `src/components/media/VideoPlayer.tsx:342,363`
- What's wrong: `last_played` is written **only** in the `played=1` branch of `upsertWatchState` (`library.ts:118-126`); the not-played branch sets/keeps `last_played = NULL` (`:129-136`). During normal playback the player posts progress with `played: false` (`VideoPlayer.tsx:342`); `last_played` is set only when an item *completes* (`played: remaining < 0.05`, `:363`) — at which point `played=1` and the row is excluded from resume lists. Therefore **every row that a resume query can return has `last_played = NULL`**. Both resume surfaces sort on it anyway:
  - `getResumeItems` → `ORDER BY media_watch_state.last_played DESC` (`library.ts:150`): all-NULL sort key ⇒ arbitrary order.
  - `continue-watching/route.ts:59` `ORDER BY mws.last_played DESC`; per-series dedup at `:72` keeps "most recent" via `(row.last_played ?? 0) > (existing.last_played ?? 0)` — all `?? 0`, so it always keeps the first row seen, not the newest episode; final sort `:121` `b.lastPlayed.localeCompare(a.lastPlayed)` compares `''` vs `''` (both NULL → `''` at `:102,:116`) ⇒ no ordering.
- Why it matters: The home-page Continue-Watching row has no real recency order, and for a partially-watched series it can surface the wrong (not most-recent) episode. The sibling query `getSeriesResumeEpisode` (`library.ts:156-172`) correctly uses `ORDER BY media_watch_state.updated_at DESC`, which proves the intended column — `updated_at` IS bumped on every progress write.
- Suggested fix: Order both resume paths by `media_watch_state.updated_at DESC` (and dedup on `updated_at`), matching `getSeriesResumeEpisode`. Or set `last_played = now` on every progress upsert, not just on completion.

### A20-03 — `watch_events` table is never populated; all watch-history temporal fields stay empty
- Severity: High
- Files: schema `src/lib/db/migrations.ts:65-80`; readers `src/app/api/auth/history/route.ts`, `src/app/history/page.tsx`, `src/app/api/admin/users/[id]/monitoring/route.ts`, `src/app/api/admin/monitoring/route.ts`, `src/app/api/admin/stats/route.ts`, `src/app/api/admin/activity/route.ts`; only writer is a DELETE at `src/app/api/admin/users/[id]/route.ts:32`
- What's wrong: A full-tree grep finds **no INSERT or UPDATE** against `watch_events` anywhere — the sole `.run()` is `DELETE FROM watch_events WHERE user_id = ?` (account deletion). The player records progress exclusively into `media_watch_state` via `/api/media/progress`. So `started_at`, `ended_at`, `watched_sec`, `duration_sec`, `progress_pct`, `completed` are never written.
- Why it matters: The user `/history` page, the admin "Watches" tab, "last watched title + timestamp," total-watch-count, and watch-time stats all read `watch_events` and will always be empty/zero. Several columns here are temporal (`started_at` NOT NULL, `ended_at`, `position_ticks` added later) and are dead — any future "resume / last-watched-at" logic built on them silently returns nothing. This is the macro-scale version of the "never-updated timestamp" class flagged for this audit.
- Suggested fix: Write a `watch_events` row on playback start (set `started_at`) and on stop/complete (set `ended_at`, `watched_sec`, `progress_pct`, `completed`) — most naturally from the existing `/api/media/progress` handler or the player's `reportStart`/`reportProgress`. Alternatively, repoint the history/stats readers at `media_watch_state` and drop `watch_events`. Note `media_watch_state` lacks a "started_at" and stores only the latest position, so a true history needs the events table populated.

---

## MEDIUM

### A20-04 — Cron jobs run in container TZ, which the documented deploy leaves unset (UTC)
- Severity: Medium
- Files: `src/lib/subtitle/scheduler.ts` (`0 3 * * *` scan, `30 3 * * *` download); `src/lib/automation/scheduler.ts` (`*/15`, `*/30`, `*/2`, `0 * * * *`); compose snippet in `CLAUDE.md` §"Adding to docker-compose" sets no `TZ`
- What's wrong: node-cron evaluates expressions in the Node process's local timezone. The documented `unified-frontend` compose service defines `NODE_ENV` and service URLs but no `TZ`, so the container defaults to UTC. The subtitle jobs whose comments say "Daily at 3 AM" actually fire at 03:00 **UTC**. (The interval-style jobs `*/15`, `*/30`, `*/2`, and top-of-hour `0 * * * *` are TZ-insensitive for cadence — only their phase shifts.)
- Why it matters: Field order and ranges are all correct; this is purely a wall-clock-of-day mismatch. For a LAN media box, 3 AM UTC vs 3 AM local is usually harmless (still off-peak), but it contradicts the stated intent and can land in the user's evening depending on offset.
- Suggested fix: If local-time scheduling matters, set `TZ=America/Chicago` (or pass a timezone option to `cron.schedule(..., { timezone })`). Otherwise document that cron times are UTC.

### A20-05 — `fmtEta` "infinity" threshold (8 640 000 s) is an inconsistent, undocumented magic number
- Severity: Medium
- Files: `src/app/downloads/components/TorrentRow.tsx:47`
- What's wrong: `if (seconds < 0 || seconds >= 8640000) return '∞'`. qBittorrent reports `eta = 8640000` (exactly 100 days, its sentinel for "unknown/infinite") — the check matches, which is correct — but the literal is undocumented and uses `>=`, while the same file's `fmtDate` and the party layer use `86400`/`86_400` (1 day) elsewhere, inviting confusion. There's a latent off-by-context risk if anyone "fixes" this to 86400 thinking it's a day.
- Why it matters: Not a live bug (qBit's sentinel is 8 640 000 and is matched), but the unexplained constant is a maintenance trap in temporal code. Worth a comment.
- Suggested fix: Extract `const QBT_ETA_INFINITY = 8_640_000 // qBittorrent's "unknown ETA" sentinel (100 days)` and reference it, mirroring the documented `MAX_POSITION_TICKS` constant in `lib/party/constants.ts:71`.

### A20-06 — `formatDate` overload ambiguity: shared helper takes a string, three local copies take epoch ms
- Severity: Medium
- Files: `src/lib/utils.ts:26-32` (`formatDate(dateStr: string)`); callers wrapping ms→ISO at `src/app/page.tsx:330`, `src/app/admin/page.tsx:119,139`; divergent local definitions `src/app/requests/RequestsTable.tsx:45` (`formatDate(ms: number)`), `src/app/admin/monitoring/page.tsx:18`, `src/app/admin/users/page.tsx:15`
- What's wrong: There are four functions named `formatDate` with two incompatible contracts. The shared `lib/utils.ts` one does `new Date(dateStr)` expecting an ISO/parsable **string**; callers correctly pre-convert epoch-ms with `new Date(req.created_at).toISOString()` before calling it. Three page-local copies instead take **epoch ms** directly. All current call sites pass the right type, so nothing is broken today, but a future caller passing a raw epoch-ms integer to the `lib/utils.ts` version (`new Date(1718000000000)` works, but `new Date("1718000000000")` would mis-parse) — or passing a string to the ms versions — would render `Invalid Date`.
- Why it matters: This is the precise shape of "stored one way, formatted another" the audit targets; it hasn't bitten yet but the name collision makes it likely. The shared helper's `dateStr: string` type silently accepts a number at the JS layer.
- Suggested fix: Rename for clarity (`formatDateFromMs(ms: number)` vs `formatIsoDate(s: string)`), or make the shared helper accept `number | string` and branch. Add `if (isNaN(d.getTime())) return '—'` guards to the ms-based copies in `RequestsTable`, `admin/monitoring`, `admin/users` (only the TMDB `MovieDetailPanel`/`TvDetailPanel` copies currently guard NaN).

---

## LOW

### A20-07 — Expired sessions pruned only at process startup; table grows between restarts
- Severity: Low
- Files: `src/lib/db/index.ts:35-45` (`cleanExpiredSessions` called once inside `getDb()` init)
- What's wrong: `cleanExpiredSessions` (`DELETE FROM sessions WHERE expires_at < now`) runs exactly once, lazily on first `getDb()`. There is no periodic sweep. On a long-running container, expired/rotated session rows accumulate until the next restart.
- Why it matters: Not a correctness bug — `getSession` filters `s.expires_at > ?` so stale rows can never authenticate, and 24h rotation deletes the old id on rotation. Pure unbounded-growth/footprint concern on a box that rarely restarts.
- Suggested fix: Either add `cleanExpiredSessions` to the hourly cron in `scheduler.ts`, or accept it (low volume). Document the choice.

### A20-08 — `getSeriesResumeEpisode` ignores season/episode tiebreak when timestamps tie
- Severity: Low
- Files: `src/lib/media-server/library.ts:156-172`
- What's wrong: Orders candidate in-progress episodes by `updated_at DESC LIMIT 1`. If two episodes of the same series were last touched in the same millisecond (e.g. a bulk import that seeded watch state, or rapid skip), the tiebreak is undefined — SQLite returns an arbitrary row, which may not be the latest by S/E.
- Why it matters: Edge case; normal sequential watching produces distinct ms timestamps. Only matters for synthetic/bulk writes.
- Suggested fix: Add a deterministic secondary sort: `ORDER BY media_watch_state.updated_at DESC, media_items.season_number DESC, media_items.episode_number DESC`.

### A20-09 — Frame-step hardcodes 24 fps for all content
- Severity: Low
- Files: `src/components/player/MediaFrameAdvance.tsx:11,50,58,62`; mirrored in `src/components/media/VideoPlayer.tsx:679-690` (`1/24`)
- What's wrong: `FRAME_DURATION = 1/24` and `frameNumber = floor(currentTime * 24)` assume 24 fps. 25 fps (PAL), 30/29.97, and 60 fps content will step by the wrong amount and display an inaccurate frame counter. The code comments acknowledge this and note the browser exposes no frame-rate API.
- Why it matters: Cosmetic precision tool; off by ~4% (25fps) up to 2.5× (60fps) per step. The probe layer (`probeFile`) likely has the real fps but it isn't threaded into the player.
- Suggested fix: Pass probed `r_frame_rate`/`avg_frame_rate` from `PlaybackData` into the frame-advance component and compute `1/fps`; fall back to 24 only when unknown.

### A20-10 — `formatDate(new Date(req.created_at).toISOString())` will throw/"Invalid Date" if `created_at` is ever null on home page
- Severity: Low
- Files: `src/app/page.tsx:330`
- What's wrong: `req.created_at ? formatDate(new Date(req.created_at).toISOString()) : '—'` guards null `created_at`, but `new Date(x).toISOString()` **throws** RangeError if `x` is `NaN`/out-of-range (e.g. a corrupted row), and the surrounding code is a server component map with no per-item try/catch. The truthiness guard catches `0`/null/undefined but not a malformed non-zero value.
- Why it matters: `created_at` is `INTEGER NOT NULL` and always `Date.now()` on insert, so realistically safe; only a corrupted DB value would trigger it. Listed for completeness since `.toISOString()` on an invalid date is a hard throw, not a soft "Invalid Date" string.
- Suggested fix: Format the ms directly with a NaN-guarded helper instead of round-tripping through `.toISOString()`, e.g. reuse a single ms-based `formatDate` with `isNaN` guard.

---

## INFO / Verified-correct (no action)

### A20-11 — Session TTL / rotation / absolute-max math is correct and unit-consistent
- Files: `src/lib/dal.ts:33-35,58-121,139-151`
- All three windows (`SESSION_TTL_MS` 30d rolling, `ROTATION_INTERVAL_MS` 24h, `ABSOLUTE_TTL_MS` 90d) are ms; `expires_at`/`created_at`/`last_seen` are written as `Date.now()` ms and compared against `Date.now()`. Cookie `maxAge` correctly divides by 1000 (cookie maxAge is seconds). Rotation resets `created_at` and the absolute-TTL check (`now - created_at > ABSOLUTE_TTL_MS`) compensates. Cookie-mutation try/catch wrappers present at every site per the Next.js 16 constraint. Token expiries (`password_resets`, `pending_registrations`) all store `now + Nms` and check `Date.now() > expires_at` — consistent.

### A20-12 — External-API second-vs-millisecond boundaries are handled correctly
- Files: `src/app/downloads/components/TorrentRow.tsx:58` (`timestamp * 1000` for qBit `added_on`/`completion_on`); `src/lib/indexer/adapters/yts.ts:66` and `eztv.ts:45` (`new Date(*_unix * 1000)`); login-attempt window `src/app/api/auth/login/route.ts:78` (`Date.now() - 5*60*1000`, both ms)
- Every place that consumes a known unix-**seconds** external value multiplies by 1000 at the boundary before constructing a `Date`. No seconds/millis mixing detected in internal columns.

### A20-13 — Party-play cross-machine time sync model is sound
- Files: `src/lib/party/position.ts:22-27` (`extrapolatePosition`), `src/lib/party/constants.ts:29,71` (EMA alpha, `MAX_POSITION_TICKS = 86_400 * TICKS_PER_SECOND`), `src/hooks/usePartySync.ts:183-235`
- Position is uniformly 100ns ticks; ms→ticks via `TICKS_PER_MS`. Clock skew between client and server is reconciled via an EMA-smoothed offset (`offsetRef`) applied as `Date.now() + offset`, and transitions re-extrapolate at actual fire time. The 24h `MAX_POSITION_TICKS` ceiling is an input-validation guard (matches the audit's "24h position cap"), not a runtime bug. No DST/manual-month arithmetic anywhere — all deltas are pure ms subtraction, which is DST-safe.

---

## Methodology notes
- Grepped: `CURRENT_TIMESTAMP`, `datetime(`, `strftime`, `unixepoch`, `Date.now`, `new Date(`, `getTime`, `/ 1000`, `* 1000`, `expires`, `_at`, `setInterval`, `setTimeout`, `cron`, `last_played`, `watch_events`.
- Confirmed via schema (`migrations.ts`) that ALL timestamp columns are `INTEGER` (no text datetime columns), then traced each writer/reader pair for the auth, request, watch-state, subtitle, automation, indexer, and party subsystems.
- DST/month-boundary risk: none found — no code does manual calendar arithmetic (only `setDate(getDate()-1)` in `history/page.tsx:25` for a "yesterday" label, which is DST-safe via the Date object).
