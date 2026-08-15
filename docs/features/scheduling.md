# Scheduling and Background Work

This is the single reference for every scheduled, recurring, deferred, or background process in the
app: the three `node-cron` schedulers (automation, media-server enrichment, subtitles), the party-play
WebSocket server's two `setInterval` timers, the filesystem watcher, indexer health/backoff and
per-indexer rate limiting, and the places that look like scheduled cleanup but are actually lazy
(sessions, `pending_registrations`). It also states plainly what is missing that a reader might expect
to exist.

## Boot sequence

`app/src/instrumentation.ts:5` is the Next.js server-startup hook (`register()`), guarded on
`NEXT_RUNTIME === 'nodejs'` so it never runs in the Edge runtime. On every worker boot, in this order:

1. Install `process.on('unhandledRejection', …)` (log, keep serving) and `process.on('uncaughtException',
   …)` (log, `process.exit(1)` so `restart: unless-stopped` recreates a clean container) —
   `app/src/instrumentation.ts:18`.
2. Route outbound HTTP through gluetun's proxy if `HTTPS_PROXY` is set.
3. Fail fast if `ADMIN_USERNAME`/`ADMIN_PASSWORD` are missing.
4. `initScheduler()` — the automation scheduler (eight cron jobs, `app/src/lib/automation/scheduler.ts`).
5. `initSubtitleScheduler()` — the subtitle scheduler (three cron jobs, `app/src/lib/subtitle/scheduler.ts`).
6. `initWatcher()` — the chokidar media-file watcher (`app/src/lib/media-server/scanner.ts:129`).
7. `initMediaEnrichScheduler()` — the TMDB enrichment scheduler (one cron job,
   `app/src/lib/media-server/scheduler.ts`).
8. `initIndexerDiscovery()` — **not recurring**, a one-time-per-boot catalog reseed (see below).
9. `initPartyServer()` — the dedicated WebSocket server on port 3002, which owns its own two
   `setInterval` timers (`app/src/lib/party/server.ts`).

Every `init*` function is guarded by a module-level `let started = false` flag, so calling it twice in
the same process (Next.js dev-mode hot-reload can re-execute `instrumentation.ts`) is a no-op. This
guard is per-module-instance, not cross-process — it does not prevent two separate worker processes
from each registering their own copy of every job (not relevant to this deployment's single-process
Docker container, but worth knowing if that ever changes).

## The automation scheduler — `app/src/lib/automation/scheduler.ts`

`initScheduler()` (`app/src/lib/automation/scheduler.ts:99`) registers eight `node-cron` jobs, all
routed through a local wrapper called `safeCron`.

### `safeCron` — what it does and does not do

```
function safeCron(expression, label, body) {
  cron.schedule(expression, async () => {
    try { await body() }
    catch (err) { console.error(`[automation] ${label} tick failed:`, err) }
  })
}
```
(`app/src/lib/automation/scheduler.ts:89`)

`safeCron` is **not** crash protection. The installed `node-cron` is `4.2.1` (`app/package.json`
pins `^4.2.1`; the resolved version in `app/node_modules/node-cron/package.json` is `4.2.1`). Starting
with node-cron 4.x, every scheduled task already runs inside the library's own try/catch
(`node_modules/node-cron/dist/cjs/scheduler/runner.js`) and a rejection is routed to node-cron's
internal `onError`, which logs `[NODE-CRON][ERROR]` with a stack trace but **no job identity** — a
throwing tick cannot escape as a process-level `unhandledRejection` on this version. This was verified
twice: by reading the installed `runner.js` source, and by a runtime test (schedule an always-rejecting
task every second, both wrapped and unwrapped) recorded in
`docs/incomplete/open-issues.md` (2026-08-13 entry, "Wiring-audit re-raise of A17-4"): `escaped=0,
caught=2`.

What `safeCron` actually buys is **attribution**. Without it, all eight jobs would share one
indistinguishable `[NODE-CRON][ERROR]` shape in the log; `safeCron`'s `label` argument names which of
the eight failed. It also keeps the error-handling behavior owned by the app instead of inherited from
a node-cron default that could change on a future version bump.

This was different on node-cron 3.x (the version in place when the original 2026-06-13 audit finding
A17-4 was filed) — 3.x did not catch async task errors, so a throwing tick genuinely could crash the
process. That finding was accurate when written and was silently resolved by the later dependency
upgrade to 4.x, not by any code change. See "Gotchas" below for the practical implication.

### Job catalogue

All eight jobs run in the same process as the Next.js route handlers. None of them acquire an
explicit lock against concurrent runs; overlap protection (where it exists) is a narrower, job-specific
mechanism noted in the "Overlap guard" column.

| Job | Cadence | Cron expr | File | What it does | Overlap guard | Failure behavior |
| --- | ------- | --------- | ---- | ------------- | -------------- | ----------------- |
| `grab` | Every 5 min | `*/5 * * * *` | `scheduler.ts:105` → `grabber.ts` `grabItem` | Searches all enabled indexers for every `wanted` monitored item, sequentially (not concurrent), scores candidates, sends the best to the download client. | Per-item atomic claim: `grabItem` UPDATEs the row `wanted`→`grabbing` and only proceeds if it won that race (`grabber.ts:757` D3 claim); a second caller (e.g. an admin "Grab Now") sees `changes===0` and backs off. | One item's error is caught inside `grabItem` itself (`grabber.ts:795`) and logged; the loop continues to the next item. `safeCron` is a second-layer catch around the whole tick. |
| `availability` | Every 30 min | `*/30 * * * *` | `scheduler.ts:118` → `availability.ts` `checkAvailability` | Polls UMT for grabbed torrents that finished seeding (stamps `download_completed_at`), then checks whether each `grabbed` item now has a matching row in `media_items`; if so, flips it to `imported`, sets `media_requests` to `available`, and computes `auto_delete_at` = completion + 48h for quick requests. Fires availability notifications after the DB writes. | None explicit — idempotent (`download_completed_at` is set once, `WHERE download_completed_at IS NULL`; the `imported` transition is a plain status write). | UMT-unreachable is caught and the tick returns early (`availability.ts:56`); per-notification failures are swallowed by the notify layer. |
| `import` | Every 2 min | `*/2 * * * *` | `scheduler.ts:128` → `importer.ts` `runImportCheck` + `upgrade.ts` `completeUpgrades` | Moves completed grabbed torrents into the library via UMT `setLocation`, triggers an immediate directory scan (bypassing the watcher), then finishes any in-flight upgrade replacement whose new file has landed. Also has two fallback paths for a torrent no longer visible in UMT: match-by-tmdb-id against the library, then a token-overlap filename match against the downloads/complete directory (hardlink, falling back to copy). | None explicit. | Whole-tick UMT-unreachable is caught and returns early, retried next tick (`importer.ts:170-174`). The `setLocation` move and the downloads/complete fallback scan are each wrapped in their own try/catch so one item's move failure is logged and the loop continues to the next item (`importer.ts:236`, `:304`). `completeUpgrades` is per-row try/catch, one bad row does not stop the rest. |
| `upgrade-scan` | Every 6 h, top of hour | `0 */6 * * *` | `scheduler.ts:140` → `upgrade.ts` `scanForUpgrades` | Movies only. For each imported movie whose profile allows upgrades and is below cutoff (or eligible for a PROPER/REPACK swap within a 30-day window), searches for a strictly-better release and grabs it, recording a `pending_upgrades` row. Capped at 25 items per run (`DEFAULT_SCAN_LIMIT`), rotated via `last_upgrade_scan_at ASC NULLS FIRST` so every item eventually gets scanned. | `pending_upgrades WHERE status='pending'` is checked per item — an item with an upgrade already in flight is skipped, so two upgrade grabs never stack (`upgrade.ts:157`). | Per-item try/catch (`upgrade.ts:234`); one item's search/grab error is logged and the loop continues. |
| `import-lists` | Every 6 h, `:20` past | `20 */6 * * *` | `scheduler.ts:149` → `import-lists.ts` `syncAllImportLists` | Pulls each enabled Trakt list or RSS feed, resolves titles to TMDB ids, and auto-adds new items as long-term (never quick, never auto-deleted) monitored items. A per-list ledger (`import_list_items`, `UNIQUE(list_id, tmdb_id, media_type)`) means an item is added at most once per list even after it's later removed from the library. Capped at 100 items per list per sync. Offset 20 minutes past the hour specifically so it doesn't contend with `upgrade-scan` on the same tick. | Ledger `INSERT OR IGNORE` makes a re-add a no-op. | Per-list try/catch (`import-lists.ts:248`); a list's fetch error is recorded on that list's row (`last_error`) and the sync continues to the next list. |
| `collections` | Daily, 03:40 | `40 3 * * *` | `scheduler.ts:158` → `collections.ts` `syncAllCollections` | For each enabled monitored TMDB collection, re-fetches the collection and auto-adds any film not yet in the per-collection ledger (`collection_items`) as a long-term monitored item — picks up sequels added to the franchise after the collection was first monitored. | Ledger `INSERT OR IGNORE`, same pattern as import-lists. | Per-collection try/catch (`collections.ts:148`); one collection's error is logged, the rest still sync. |
| `reaper` | Every 10 min | `*/10 * * * *` | `scheduler.ts:171` → `reaper.ts` `reapStalledTorrents` | See "The reaper" below. | None explicit — re-derives its candidate list from live UMT + DB state every tick, so a double-run just reaps the same (already-blocklisted, already-removed) hash a second time as a no-op. | Per-torrent try/catch (`reaper.ts:211`); one torrent's delete/reset error is logged, the rest still process. Whole-tick UMT-unreachable returns 0 early (`reaper.ts:100`). |
| `auto-delete` | Hourly, top of hour | `0 * * * *` | `scheduler.ts:181` → `auto-delete.ts` `runAutoDelete` + `pruneAuthTables` | Two things on one tick: (1) deletes files/DB rows for quick requests whose 48h `auto_delete_at` has passed (with an ownership guard so files another still-active request depends on are never removed — see `auto-delete.ts:62`); (2) `pruneAuthTables` prunes four tables: `login_attempts` older than 24h, `audit_log` older than 90 days, `sessions` more than 7 days past their own `expires_at`, and `pending_registrations` more than 24h past theirs; then (3) `pruneGuestUsers` deletes party-guest
    accounts that are safely finished with — see "Guest users" below. | None explicit; deletion order (files → DB rows → status) means a crash mid-run safely re-attempts next hour at the cost of re-trying already-gone file deletes. | Per-request try/catch in `runAutoDelete` (`auto-delete.ts:142`); the auth-table prune wraps its own body in try/catch (`scheduler.ts:47`). |

Cadence summary in plain English: two jobs run every couple of minutes (`import` at 2, `grab` at 5),
two more run every 10–30 minutes (`reaper`, `availability`), two run twice a day (`upgrade-scan` and
`import-lists`, offset 20 minutes apart so they don't collide), one runs once a day at 03:40
(`collections`), and one runs once an hour on the hour (`auto-delete`).

### Concurrency and overlap

Nothing in `scheduler.ts` prevents two ticks of the *same* job from running concurrently if one tick
takes longer than the job's own interval (e.g. a `grab` tick that takes longer than 5 minutes because
an indexer is slow). `node-cron` does not serialize overlapping runs for you. In practice each job that
could double-act on the same row guards it at the row level instead: `grab`'s D3 atomic claim
(`wanted`→`grabbing`), the upgrade scan's `pending_upgrades` in-flight check, and the import-lists/
collections ledgers. The jobs without a row-level guard (`availability`, `import`, `auto-delete`,
`reaper`) are naturally idempotent — re-running the same logic on the same state either does nothing
new or repeats a harmless no-op (e.g. reaping an already-removed torrent).

## The subtitle scheduler — `app/src/lib/subtitle/scheduler.ts`

`initSubtitleScheduler()` registers three jobs, deliberately staggered 30 minutes apart so each one's
output is ready before the next runs:

| Job | Cadence | Cron expr | What it does |
| --- | ------- | --------- | ------------ |
| Skipped re-check | Weekly, Sunday 02:30 | `30 2 * * 0` | `resetSkippedToWanted()` (`monitor.ts:154`) flips every `subtitle_wants` row in status `skipped` back to `wanted`. "Skipped" means "no match at the time we searched," not "never will be" — OpenSubtitles' catalog grows over time, so this gives skipped items a periodic second chance. |
| Library scan | Daily, 03:00 | `0 3 * * *` | `scanLibrary()` (`app/src/lib/subtitle/scanner.ts:37`) walks the library for items missing subtitles in the configured target languages, creates new `wanted` rows, refreshes `absolute_episode_number` for every series (needed by the numbering-scheme fallback), and calls `pruneOrphanedWants()` (`monitor.ts:137`) to delete `subtitle_wants` rows left behind by media files that were renamed/reorganized (a rescan gives a moved file a fresh `media_items` id, orphaning the old want row). |
| Download pass | Daily, 03:30 | `30 3 * * *` | `downloadPendingSubtitles()` (`app/src/lib/subtitle/downloader.ts:207`) processes every `wanted` row one at a time, with a fixed 1-second pause between downloads (`downloader.ts:250`) to stay under OpenSubtitles' burst rate limit. Checks the live remaining-quota count up front and stops early (`quotaExhausted: true`) rather than discovering the ceiling mid-run — items left `wanted` when the quota runs out are picked up automatically the next day. |

The 30-minute stagger (02:30 → 03:00 → 03:30) exists so the re-check resets stale skips before the scan
runs, and the scan populates new `wanted` rows before the download pass runs — each job's output is a
precondition for the next.

Failure behavior for all three: each job's cron body wraps itself in its own local try/catch and logs
to `console.error` (`app/src/lib/subtitle/scheduler.ts:24`, `:34`, `:45`) — this file does not use the
automation scheduler's `safeCron` wrapper, but the effect (a labeled log line, no crash) is the same,
and for the same underlying reason: node-cron 4.x's own internal catch would prevent a crash either way.

## The media-server enrichment scheduler — `app/src/lib/media-server/scheduler.ts`

One job: daily at 04:00 (`0 4 * * *`), after the filesystem watcher scan has had all day to settle the
DB. `enrichAll()` backfills TMDB metadata (poster, overview, `tmdb_id`) for any `media_items` row that
entered the library via direct filesystem scan rather than the app's own Request → Grab → Import flow
(pre-existing files, or content grabbed by an external tool never had this metadata populated
automatically). `enrichEpisodeStills()` runs after it for per-episode still images. Both stages log
counts and errors; a whole-tick error is caught and logged (`media-server/scheduler.ts:25`).

## The party-play server's own timers — `app/src/lib/party/server.ts`

The dedicated WebSocket server (port 3002, started by `initPartyServer()` from `instrumentation.ts`)
runs two `setInterval` loops of its own, independent of node-cron:

| Timer | Interval | Function | What it does |
| ----- | -------- | -------- | ------------ |
| `pingInterval` | `WS_PING_INTERVAL_MS` = 20,000 ms | `pingSweep` (`party/server.ts:1486`) | For every open socket: if it missed too many pongs (`WS_PONG_MISS_LIMIT`=2), terminates it; re-validates the session against SQLite at most every `SESSION_RECHECK_INTERVAL_MS` (60,000 ms) and closes the socket if the session no longer resolves (expired/suspended); otherwise arms the next round and sends a ws-protocol ping. |
| `periodicInterval` | `PERIODIC_TICK_MS` = 2,500 ms | `periodicTick` (`party/server.ts:1435`) | Per active party: releases a readiness-gate-held play after `READINESS_GATE_MAX_WAIT_MS`; ends a party that has had zero connected members for `EMPTY_PARTY_IDLE_END_MS`; broadcasts a keepalive `state` message if `KEEPALIVE_STATE_BROADCAST_MS` has elapsed since the last one; throttled-checkpoints party position/paused state to SQLite if `CHECKPOINT_THROTTLE_MS` has elapsed. |

Neither timer is cleared on graceful shutdown — there is no `SIGTERM` handler that calls
`clearInterval` on `rt.pingInterval`/`rt.periodicInterval`. In this deployment that is inconsequential
(the process exits and Docker recreates the container), but it means there is no orderly close of live
party sockets before restart; the client-side reconnect logic (`usePartySync.ts`) is what recovers.

Full detail on party play generally, including the rest of the timing constants below, is in
`docs/features/party-play.md`.

### Party-play timing constants (`app/src/lib/party/constants.ts`)

| Constant | Value | Purpose |
| -------- | ----- | ------- |
| `HEARTBEAT_INTERVAL_MS` | 5,000 ms | Client → server heartbeat carrying current playback position. |
| `WS_PING_INTERVAL_MS` | 20,000 ms | Server → client ws-protocol ping (drives `pingSweep`, above). |
| `WS_PONG_MISS_LIMIT` | 2 | Consecutive missed pongs before a socket is terminated. |
| `KEEPALIVE_STATE_BROADCAST_MS` | 10,000 ms | Periodic full-state resync broadcast even when no commands fired. |
| `PLAY_LEAD_MS` | 1,000 ms | `effectiveAt` lead time for a play transition (pre-buffer headroom). |
| `CONTROL_LEAD_MS` | 300 ms | `effectiveAt` lead time for a pause/seek transition. |
| `COMMAND_DEBOUNCE_MS` | 300 ms | Drops a duplicate same-action command that wouldn't change state. |
| `CLOCK_OFFSET_EMA_ALPHA` | 0.4 | Smoothing factor for the client's estimated server-clock offset. |
| `SEEK_DEADBAND_S` | 0.25 s | Below this drift, do nothing. |
| `RATE_NUDGE_LOW_S` | 0.25 s | At/above this and below the hard-reseek threshold, client rate-nudges. |
| `DRIFT_HARD_RESEEK_S` | 1.5 s | At/above this, server sends a targeted `reseek`. |
| `RATE_NUDGE_CLAMP` | 0.1 | `video.playbackRate` stays within `[0.90, 1.10]` during a nudge. |
| `POST_JOIN_SETTLE_MS` | 8,000 ms | After join/reconnect, only rate-nudge (no hard reseek) for this long. |
| `MEDIAN_OUTLIER_RESEEK_S` | 1.5 s | A client this far from the room's median position gets a reseek. |
| `READINESS_GATE_MAX_WAIT_MS` | 20,000 ms | A held play releases once all connected members are ready, or after this. |
| `COUNTDOWN_DURATION_MS` | 5,000 ms | Host-triggered synchronized start countdown. |
| `DISCONNECT_GRACE_MS` | 30,000 ms | A dropped member sits in `'grace'` this long before eviction. |
| `EMPTY_PARTY_IDLE_END_MS` | 60,000 ms | A party with zero connected members ends after this idle window. |
| `CHECKPOINT_THROTTLE_MS` | 12,000 ms | Throttle for position/paused checkpoints written to SQLite. |
| `CHAT_RING_BUFFER_SIZE` | 50 | In-memory chat backlog kept per party for late joiners. |
| `CREATE_RATE_LIMIT` | 10/hour/user | Party-create rate limit. |
| `JOIN_RATE_LIMIT` | 30/hour/user | Party-join rate limit. |
| `RATE_LIMIT_WINDOW_MS` | 3,600,000 ms | Window the two rate limits above use. |
| `SESSION_RECHECK_INTERVAL_MS` | 60,000 ms | Minimum gap between re-validating a live socket's session (folded into `pingSweep`). |
| `WS_RATE_WINDOW_MS` | 10,000 ms | Rolling window for the per-socket message-type token buckets below. |
| `WS_CHAT_MAX_PER_WINDOW` | 15 | Chat messages allowed per socket per window. |
| `WS_REACTION_MAX_PER_WINDOW` | 30 | Reactions allowed per socket per window. |
| `WS_CONTROL_MAX_PER_WINDOW` | 30 | Control messages allowed per socket per window. |
| `WS_MSG_MAX_PER_WINDOW` | 200 | Overall per-socket message ceiling across all types, per window. |
| `WS_MAX_MESSAGE_BYTES` | 16,384 | Oversized WS frames rejected at the protocol layer. |
| `MAX_SOCKETS_PER_USER` | 5 | Resource cap. |
| `MAX_MEMBERS_PER_PARTY` | 50 | Resource cap. |
| `MAX_TOTAL_PARTIES` | 200 | Resource cap. |
| `MAX_QUEUE_LENGTH` | 200 | Upper bound on shared-queue items per party. |
| `MAX_POSITION_TICKS` | 86,400 × `TICKS_PER_SECOND` (24h) | Coarse input-validation ceiling on any reported/commanded position — not media-duration validation (see the code comment at `constants.ts:74`). |
| `MAX_CHAT_LENGTH` | 2,000 | Shared server+client chat-length ceiling. |
| `PARTY_WS_PORT` | 3002 | Dedicated WebSocket server's internal port. |

## The grabber, in depth — `app/src/lib/automation/grabber.ts`

`grabItem()` is the function the `grab` cron job calls for every `wanted` item, and is also called
directly (with `force: true`) by the admin "Grab Now" route
(`app/src/app/api/automation/items/[id]/grab/route.ts`) and by the interactive grab-confirmation flow's
commit step (`grabSpecificRelease`, shared code — see `docs/features/grab-confirmation.md`).

**The cron path is deliberately not given the confirmation modal.** `docs/features/grab-confirmation.md`
states: "The 5-minute background cron (`scheduler.ts`) ... [is] **untouched** — confirmation only
applies where there's a live user session to show a modal to." This is confirmed by reading the code:
the cron's `safeCron('*/5 * * * *', 'grab', …)` body (`scheduler.ts:105`) calls `grabItem(item, {
language: item.language })` directly with no confirmation step, exactly the same function the pre-
confirmation-flow code always called. The confirmation UI (`<GrabConfirmModal>`) only intercepts
*user-initiated* grab actions (Auto-grab, Grab pack, admin Grab Now, requests-page re-search) by routing
them through `searchAndScoreItem` → show the user the pick → `grabSpecificRelease` on confirm. The cron
has no user session to show anything to, so it always auto-picks and commits in one step, same as
before the confirmation flow existed.

**Cadence lives in `scheduler.ts`, nowhere else.** Two header comments elsewhere used to claim a
15-minute grab cron (`grabber.ts:11` and `app/src/app/api/automation/items/[id]/grab/route.ts:4`);
both were corrected to 5 minutes on 2026-08-15. This was the third instance of the same drift —
`docs/incomplete/open-issues.md`'s 2026-08-13 A17-4 entry records the scheduler's own header claiming
"three background cron jobs, every 15 min" when there were eight at 5 minutes. If a cadence needs
changing, change `scheduler.ts` and this doc, and do not restate the number in a module comment.

## The reaper — `app/src/lib/automation/reaper.ts`

Runs every 10 minutes (`scheduler.ts:171`). Handles two independent failure classes so a grabbed torrent
never strands a `monitored_item` in `'grabbed'` forever:

1. **Metadata stall** — a torrent stuck in `metaDL`/`forcedMetaDL` with 0 seeds and 0 leechers for
   longer than `reaper_metadata_minutes` (an `app_settings` key, default 60 — `reaper.ts:44`). Reaped
   even if no `monitored_item` is linked to it (preserves a general pile-up cleanup even for
   orphaned/manual torrents).
2. **Download stall** — a torrent linked to a still-`'grabbed'` item that is in `stalledDL`, `error`, or
   `missingFiles`, older than `reaper_stall_minutes` (default 120 — `reaper.ts:46`), measured from the
   *later* of the grab timestamp and UMT's own `added_on`. A torrent actively `downloading`/`forcedDL`,
   however slowly, never reaches this branch, and a completed/seeding torrent is in an "UP" state and
   is left to the importer instead.

For every reaped torrent, in order: **blocklist** the info hash (`addToBlocklist`, idempotent, local —
so the decision-engine's hard gates exclude it from the next search even if the UMT delete that follows
fails), then **remove** the torrent from the download client (`deleteTorrents([hash], false)` —
torrent-only, `deleteFiles=false`, so partial data is abandoned rather than actively wiped). If the
torrent was linked to a `monitored_item`, count that item's total `grab_history` rows (one per distinct
release ever tried): at or above `reaper_max_grab_attempts` (default 3 — `reaper.ts:48`) the item is
parked at terminal `'failed'` status with no further auto-search; below that ceiling it's **reset to
`'wanted'`** so the next `grab` tick re-searches and picks the next-best candidate (the blocklist entry
guarantees it won't re-pick the same dead hash).

All three thresholds (`reaper_metadata_minutes`, `reaper_stall_minutes`, `reaper_max_grab_attempts`) are
read from `app_settings` on every run, so they're editable without a redeploy.

## Indexer health/backoff and rate limiting — `app/src/lib/indexer/config.ts`

Two independent mechanisms, both purely in-process (no scheduled job of their own — they act as a
filter each time a job that searches indexers runs):

**Health/backoff.** A torznab indexer that fails `HEALTH_FAILURE_THRESHOLD` (3) searches in a row
enters exponential backoff: `disabled_until = now + min(HEALTH_BASE_BACKOFF_MS * 2^(failures -
threshold), HEALTH_MAX_BACKOFF_MS)`, i.e. 10 minutes at the 3rd failure, doubling each additional
failure, capped at 6 hours (`config.ts:35-37`, `:92-97`). Any success immediately clears
`consecutive_failures` and `disabled_until` (`config.ts:81-85`). `getSearchableIndexers()`
(`config.ts:68`) is the query every search fan-out uses — it excludes both admin-disabled (`enabled=0`)
and currently-backed-off (`disabled_until > now`) rows. Backoff is layered on top of the admin
`enabled` flag, not a replacement for it — the two are independent.

**Per-indexer rate limiting.** `tryConsumeIndexerToken(id, perMin)` (`config.ts:46`) is an in-memory
token bucket, one per indexer id, refilled continuously at `rate_limit_per_min` tokens/minute (burst
capacity = one minute's worth). `perMin <= 0` means unlimited. A throttled search just skips that
indexer for the current tick — it is **not** recorded as a health failure, so hitting your own
configured rate limit never triggers backoff. Being in-memory and per-process, the bucket resets on
every restart.

**Daily query/grab caps.** Separate from both of the above: `rate_limit_queries_per_day` and
`rate_limit_grabs_per_day` are per-indexer daily ceilings, checked by `checkQueryLimit`/`checkGrabLimit`
(`config.ts:123`, `:138`) and reset once per UTC calendar day by `checkAndResetDailyStats` (`config.ts:116`,
compares a stored `daily_stats_date` column against `getTodayUtc()` on each check — this is a lazy
reset triggered by the next query/grab attempt after midnight UTC, not a scheduled midnight job).
`checkGrabLimit` is what `searchAndScoreItem` filters candidates through before auto-pick
(`grabber.ts:672-675`), so an indexer that has hit its daily grab cap is excluded from that run's
auto-pick pool even though its search results are still shown in the interactive UI.

**Indexer catalog seeding is boot-time, not recurring.** `initIndexerDiscovery()`
(`app/src/lib/indexer/discovery.ts`) runs once per process boot (called from `instrumentation.ts:54`,
not on any interval). It `INSERT OR IGNORE`s the built-in catalog (public indexers enabled, auth-required
ones disabled) keyed by the unique `indexers.name` index, so it only ever adds catalog entries genuinely
missing by name — it never touches `enabled`/rate-limit/health columns on a row that already exists,
including one an admin has hand-edited or disabled.

## Import lists and collections sync

Both are covered in the job catalogue above (`import-lists` every 6h at `:20`, `collections` daily at
03:40). Both share the same auto-delete-safety pattern: every item they add goes through `createItem()`
as a long-term monitored item (`status='wanted'`), never a `'quick'` request, so the 48-hour auto-delete
sweep never reclaims it. Both use a per-source ledger table (`import_list_items`,
`collection_items`) keyed `UNIQUE(source, tmdb_id, ...)` so an item already processed by a given list/
collection is never re-added even after being removed from the library by hand.

## The media-server scanner — watcher and scheduled scan, both

`app/src/lib/media-server/scanner.ts` is **both** a persistent filesystem watcher and (separately) an
on-demand full walk — it is not one or the other:

- **`initWatcher()`** (`scanner.ts:129`, called once from `instrumentation.ts:48`) starts a `chokidar`
  watcher (`awaitWriteFinish` with a 2s stability threshold) over every path in `MEDIA_ROOTS`. It fires
  continuously for the life of the process: `add` events run `scanFile` (through a
  concurrency-4 limiter, `pLimit(4)`), `unlink` events call `removeFromDb`. This is the mechanism that
  normally puts new files into the DB — no scheduled job is needed for the common case.
- **`scanAll()`** (`scanner.ts:171`) is a full recursive directory walk that scans every media file not
  already in the DB. It is **not** wired to any cron — it is only invoked on demand (e.g. an admin
  "Rescan" action), to catch files added while the watcher/process was down. It exists specifically
  because the watcher can miss changes that happen while the container isn't running.
- The daily 04:00 TMDB enrichment job (above) is a third, separate mechanism layered on top of both —
  it doesn't scan the filesystem at all, it backfills metadata for rows the watcher/`scanAll()` already
  created.

`importer.ts`'s `import` cron job also calls into the scanner directly (`scanPath`, a local recursive
walk, `importer.ts:99`) after a `setLocation` move, to force an immediate scan of the newly-placed file
rather than waiting for the watcher's own event.

## Session expiry and rotation — lazy, not swept

`app/src/lib/dal.ts` implements three session-lifecycle rules, and **none of them run as a background
job** — all three are enforced only when a session is actually used on a request:

- **30-day rolling TTL** (`SESSION_TTL_MS`, `dal.ts:38`) — every valid request extends `expires_at` by
  30 days from `last_seen` (via rotation, below, or a direct bump). A session nobody uses for 30 days
  simply fails its own `expires_at > ?` check the next time anyone tries it (`dal.ts:80`) — there is no
  job that proactively deletes it beforehand.
- **24-hour rotation** (`ROTATION_INTERVAL_MS`, `dal.ts:39`) — once 24h has passed since a session's
  `created_at`, the *next request that uses it* replaces the session ID (`UPDATE sessions SET id = ?,
  ...`, `dal.ts:115`) and resets `created_at`. This is not a scheduled rotation; a session that is
  never used again simply never rotates (its `expires_at` still governs whether it's still valid).
- **90-day absolute maximum** (`ABSOLUTE_TTL_MS`, `dal.ts:40`) — checked against the *original*
  `created_at`... except rotation resets `created_at` on every rotation, so in practice the absolute
  ceiling is enforced from the most recent rotation, not the session's true origin. This is called out
  in the code's own comment (`dal.ts:90`, "Absolute TTL enforced here because rotation resets
  created_at"). Enforced the same lazy way as the other two — at request time, in `getSession()`.

Lazy enforcement is what decides whether a session is *valid*. Deleting the row is separate, and is
handled by the hourly `auto-delete` cron's `pruneAuthTables()` step (`scheduler.ts:41`), which drops
`sessions` rows more than 7 days past their own `expires_at`. The 7-day tail is deliberate: an expired
row is already unusable, so the delay costs nothing and keeps a recently-ended session visible while
someone is investigating. Added 2026-08-15 — before that, expired rows were never deleted at all.

## `pending_registrations` — lazy expiry, hourly prune

The `pending_registrations` table (`app/src/lib/db/migrations.ts:126`) holds two-step-registration
state with a 10-minute `expires_at` (set at insert time by the registration route, not shown in the
migration itself). Verified by reading every reader of the table
(`app/src/app/api/auth/check-username/route.ts`, `resend-verification/route.ts`, `register/route.ts`,
`verify-email/route.ts`): the only expiry check is a plain `if (Date.now() > pending.expires_at)` guard
inside `verify-email/route.ts` (line 68), run when a user submits their verification code. Nothing
consults `expires_at` anywhere else, so an abandoned registration is inert from the 10-minute mark
onward regardless of whether the row still exists.

Since 2026-08-15 the hourly `pruneAuthTables()` step deletes rows more than 24h past `expires_at`
(`scheduler.ts:41`). Before that they accumulated forever. The 24h grace is longer than it needs to be
for correctness and exists only so a support question about a failed signup can still be answered the
next morning.

## Guest users — pruned since 2026-08-15

A party guest gets a throwaway `users` row (`is_guest=1`) plus an 8-hour session
(`app/src/app/api/party/guest-session/route.ts`). The session was pruned from the first pass; the
user row it belonged to was not, so every guest who ever joined a party stayed forever.
`pruneGuestUsers()` now runs on the same hourly tick, immediately after `pruneAuthTables()` so a
guest whose session row is dropped on that tick becomes eligible in the same pass rather than an
hour later.

`foreign_keys=ON` is set per connection (`lib/db/index.ts:32`) and `users(id)` has exactly two
declared FK referrers, `watch_parties.host_user_id` and `watch_party_members.user_id`, so a bare
delete would either fail or strand history. A guest is deleted only when all four hold:

| Condition | Why |
| --------- | --- |
| No `sessions` rows at all | The sessions prune runs at `expires_at + 7 days` and a guest session lives 8 hours, so this alone means the guest has been gone about a week |
| Hosts no party, ended or active | Ended parties are kept as history and their `host_user_id` FK has to keep resolving. A guest hosting is an edge case; skipping it costs one stale row and avoids having to decide what an ownerless party means |
| Not a member of any still-active party | Obvious, but worth stating: membership of a *finished* party is fine and its row is cleaned up with the user |
| No `media_requests` rows | A request represents real library work rather than a throwaway viewing session |

`watch_events`, `media_watch_state` and `push_subscriptions` carry a `user_id` with no declared FK,
so they would not block the delete, but they are cleared anyway rather than left orphaned. The
`DELETE` re-checks `is_guest = 1` itself, so the statement can never remove a real account even if
the selecting query were later loosened by mistake.

The chat backlog is not a consideration despite appearing to be one: it is an in-memory ring buffer
(`CHAT_RING_BUFFER_SIZE`), not a table, so it dies with the party and holds no reference to a user
row.

## Notification retries — none

`app/src/lib/notify/index.ts` (Discord/ntfy) and `app/src/lib/push` (Web Push, invoked from the same
`notifyMediaAvailable` call) are both single-attempt, best-effort sends: `fetchWithTimeout` with an
8-second `SEND_TIMEOUT_MS` (`notify/index.ts:23`), wrapped so a failure is caught, logged, and swallowed
(`notify/index.ts:130-157`, `Promise.allSettled` over per-channel tasks). There is no retry, no backoff,
and no queue — if the tick that calls `notifyAll()` (from `availability.ts` or `importer.ts`) can't
reach Discord/ntfy/the push service within 8 seconds, that specific notification is simply lost. The
next event (a different item becoming available) gets its own fresh single attempt; nothing re-sends
the one that failed.

## Client-side polling — out of scope, listed so it isn't re-audited

A grep for `setInterval`/`setTimeout` across `app/src` turns up a number of hits that look like
scheduling but are browser-side UI concerns, not server background work, and are excluded from the
job catalogue above:

- **`setTimeout(fn, 0)` calls** throughout `app/src/app/**` and `app/src/components/**` (dozens of
  hits) are the react-hooks `set-state-in-effect` lint-rule workaround documented in `CLAUDE.md` §7 —
  deferring a state update by one tick so it isn't set synchronously during the effect's first run.
  These are a UI correctness pattern, not scheduling, and were excluded from analysis for that reason
  so nobody re-audits them looking for a cadence that isn't there.
- **`app/src/lib/qbittorrent/hooks.ts:118`** — the `/downloads` page polls the UMT proxy on a
  configurable interval (`readRefreshInterval()`), paused via the Page Visibility API while the tab is
  hidden. Client-side only.
- **`app/src/app/requests/RequestsTable.tsx:245`** — a self-scheduling per-row download-progress poll
  (`A6-18`) that starts at 5s and backs off 1.5x per tick up to a 30s cap, and stops entirely once the
  item reaches a terminal state. Client-side only.
- **`app/src/app/admin/server/page.tsx:40`** — a fixed 15s `setInterval` refreshing the admin server
  stats page. Client-side only.
- **`app/src/app/downloads/TorrentDetailPanel.tsx:120`** — polls peer/piece state while the panel is
  open. Client-side only.
- Assorted player UI timers (`VideoPlayer.tsx` progress bar tick, `CountdownOverlay.tsx` 100ms tick,
  `MediaABLoop.tsx` loop poll, control-auto-hide timers, toast/status auto-clear timeouts) are all
  local component state, not background work.

None of these run when nobody has the relevant page open, and none of them touch the database on a
schedule — they exist entirely to keep an open browser tab's UI current.

## Gotchas

- **`safeCron` does not prevent a crash; node-cron 4.x already prevents it.** See "The automation
  scheduler" above. Don't add defensive try/catch inside a job body for survival — it's already
  redundant with node-cron's internal handling. `safeCron`'s only job is attaching a log label.
- **The grab cron path never sees the confirmation modal.** Confirmation is a UI-session concept; the
  cron always auto-picks and commits in one step via `grabItem`, exactly as it did before the
  confirmation flow existed. See "The grabber, in depth" above.
- **Don't restate a cadence in a module comment.** Three separate comments have already drifted from
  the real schedule (all now corrected). `scheduler.ts` and this doc are the only two places a cadence
  should appear.
- **Session absolute-TTL is measured from the last rotation, not true session origin**, because
  rotation resets `created_at`. The code comment at `dal.ts:90` calls this out directly. In practice a
  continuously-used session can live well past 90 days from when the user first logged in, bounded only
  by 90 days from its most recent 24h rotation.
- **`indexers` daily counters reset lazily**, on the next query/grab attempt after UTC midnight, not by
  a scheduled midnight job. If nothing queries a given indexer for a day, its `daily_query_count` simply
  stays stale (but still functionally correct, since the very next check resets it before comparing).
- **The party server's two `setInterval` timers are never explicitly cleared** on process shutdown —
  there's no `SIGTERM` handler for it. Inconsequential under Docker's restart-and-recreate model, but
  worth knowing if this code is ever run somewhere with graceful-shutdown expectations.

## Known gaps

Scheduling work that does not exist today but a reader familiar with similar systems might expect:

- **No notification retry/queue.** A single failed/timed-out Discord, ntfy, or Web Push send for a
  "now available" event is permanently lost — there is no backoff, no dead-letter table, no re-send.
  Consequence: a transient outage in a notification channel silently drops that event's alert with no
  record that it was ever attempted beyond a log line.
- **No explicit overlap lock on any cron job.** A job whose tick runs longer than its own interval
  (most plausible for `grab` if indexers are slow, or `upgrade-scan`/`import-lists` if TMDB/Trakt is
  slow) can have two ticks running concurrently. Every job happens to be idempotent or row-claim-guarded
  enough that this is currently harmless, but it is not enforced by any locking primitive — a future job
  added without that same care could double-act on the same data.
- **Per-indexer rate-limit buckets are in-memory and per-process.** They reset on every restart and
  don't survive a scale-out to multiple worker processes (not currently applicable to this
  single-process deployment, but the health-status/backoff logic is DB-backed while the rate-limit
  bucket is not — an inconsistency between the two adjacent mechanisms worth knowing about before
  changing either).

## Where this used to be documented

This doc replaced the scheduling prose scattered across the files below. All were trimmed to a pointer
on 2026-08-15 as part of the same pass that created this file. Listed so a future reader knows the
consolidation was deliberate and doesn't reintroduce a second copy:

- `CLAUDE.md` §7 "Automation scheduler" — was the full node-cron 4.x error-swallowing note, now two
  lines plus a pointer.
- `CLAUDE.md` §18 — the grab-confirmation cron sentence, cadence removed.
- `CLAUDE.md` §11 — the `pending_registrations` expiry sentence, now also names the `sessions` case.
- `docs/features/grab-confirmation.md` — the "5-minute background cron … untouched" sentence, cadence
  removed.
- `docs/incomplete/implementation-status.md` — its two "Scheduled jobs" tables are a 2026-05-30
  as-built snapshot, stale on both job count and cadence. Left in place as history with a note saying
  so, because that file is explicitly a build snapshot rather than current state.
- `FEATURE_STATUS.md` — the "cron callbacks wrapped in try/catch" claim was misleading (it implied
  crash protection that node-cron already provides) and was removed.
- `docs/incomplete/open-issues.md`'s 2026-08-13 "Wiring-audit re-raise of A17-4" entry is left
  untouched. It's a closure record for a specific finding, and rewriting history entries is not how
  that file works, but note its factual content is now restated here.
