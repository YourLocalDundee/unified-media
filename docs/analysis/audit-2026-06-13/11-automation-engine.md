# Audit 11 — Automation Engine (Radarr/Sonarr-replacement brain)

Audit date: 2026-06-13. Scope: `src/lib/automation/*` + `src/app/api/automation/*`, traced end-to-end
through the request-approval grab triggers (`approve`, `auto-approve`, `seerr/webhook`, `requests` POST).
Read-only. Notifications/SMTP skipped per instructions.

## Summary

The pipeline (monitor → search/score → grab → watch → import → mark-available → auto-delete) is mostly
coherent and the destructive `auto-delete.ts` is reasonably guarded for the *happy path*. But the engine
has one structural defect that poisons the whole acquisition flow: **`monitored_items` has no unique
constraint and `createItem` is a plain `INSERT`**, so the five separate "create then grab" call paths all
depend on a `catch (msg.includes('already exists'))` guard that **can never fire**. The result is duplicate
monitored rows, duplicate torrents added to the download client for the same title, and a status state
machine that several writers update by `tmdb_id` (not by row id) — so duplicates desync. On top of that,
the **entire quality upgrade/cutoff state machine is dead code**: `min_format_score`, `cutoff_*`, and
`upgrade_allowed` are stored and editable through the profiles API but never read by `grabItem`. There is
**no idempotency/in-flight guard** anywhere, and the immediate-grab fire-and-forget races the 15-minute cron
that scans the same `wanted` row. `auto-delete` deletes by `tmdb_id`+`type` against the shared `media_items`
table, which can delete a user-owned copy of the same title that was scanned in independently of the quick
request (CRITICAL). Importer fallback path hardlinks by fuzzy filename match and can silently overwrite via
qBit `setLocation` onto an existing good file.

### Counts by severity

| Severity | Count |
|---|---|
| CRITICAL | 3 |
| HIGH | 6 |
| MEDIUM | 7 |
| LOW | 5 |
| **Total** | **21** |

---

## CRITICAL

### A11-C1 — `auto-delete` deletes by `tmdb_id`+`type`, can destroy user-owned media sharing that title
Severity: CRITICAL
File: `src/lib/automation/auto-delete.ts:50-67`, joined logic in `availability.ts:121-126`

**What's wrong.** `runAutoDelete()` selects `media_items` rows purely by `tmdb_id` + `type` (`WHERE tmdb_id = ?
AND type = 'movie'` / `... type IN ('episode','series')`), unlinks every `file_path` it finds, and deletes the
rows. The `media_items` table is the **shared** native library — every scanned file lands there, whether it
arrived via a quick request or was placed in `/media/movies` independently by the owner / a long-term grab /
a manual copy. There is no marker on `media_items` tying a row to the specific quick request that is expiring.
So if the same movie exists in the library for any reason other than this quick request (a permanent copy the
user owns, a separate long-term request, an *arr-side import outside this app), auto-delete will `fs.unlinkSync`
the **owned file** when the quick window closes. The `auto_approved = 1 AND status='available'` guard on
`media_requests` only proves *a quick request* expired — it does not prove the *files on disk* belong to that
request.

**Why it matters.** This is the single highest-risk behavior in the engine: it can permanently delete
wanted/owned media off disk. Per the audit rules, "could delete owned media" is CRITICAL by definition. It is
also silent — the user sees the file vanish from the library with only a `console.log`.

**Suggested fix.** Track ownership explicitly: store the deleting request's id (or the specific `media_items.id`
values that the importer created for this request) and delete only those rows/files. At minimum, before
unlinking, confirm there is no *other* non-expired `media_requests` row (long-term, or another user's) and no
"permanent/owned" flag referencing the same `tmdb_id`. Add a dry-run / soft-delete (move to a trash dir with a
TTL) so a mis-match is recoverable. Never delete a path that is not under the automation-managed library roots
that this request wrote to.

### A11-C2 — No unique constraint on `monitored_items`; dedup guards are dead → duplicate grabs
Severity: CRITICAL
File: `src/lib/db/migrations.ts:160-175` (schema), `src/lib/automation/monitor.ts:88-118` (plain INSERT),
guards at `approve/route.ts:164-169`, `auto-approve.ts:72-77`, `requests/route.ts:180-186`,
`approve/route.ts:61-69` (firePreferredGrab)

**What's wrong.** `monitored_items` declares only `idx_monitored_status` and `idx_monitored_tmdb` — both plain
(non-unique) `CREATE INDEX`. `createItem()` is an unconditional `INSERT` (no `INSERT OR IGNORE`, no
`ON CONFLICT`, no pre-`SELECT`). Every approval path wraps `createItem()` in
`catch (e) { if (!e.message.includes('already exists')) ... }`, expecting a UNIQUE-violation throw. **That throw
never happens** — SQLite raises no error inserting a duplicate `(tmdb_id,type)`, so the catch is unreachable.
Consequence: approving the same request twice, a webhook retry + an admin approval, or auto-approve + a manual
approve, each insert a **new** monitored row. `findItemForRequest` / `getMonitoredItemIdForRequest`
(`bridge.ts:39`, `grab-results.ts:55`) use `LIMIT 1`, so they silently pick one of the duplicates and the
others drift.

**Why it matters.** Two `wanted` rows for one title → the cron's `for (item of wanted)` loop grabs *both* →
two torrents added to qBittorrent for the same movie. The importer then processes both, and the two
availability writers update `media_requests` by `tmdb_id` (not row id), so state transitions land on whichever
duplicate, leaving the other stuck in `grabbed` forever (it never reaches `imported`, never freeing/aging
correctly). It also wastes indexer queries and download bandwidth on every poll.

**Suggested fix.** Add `CREATE UNIQUE INDEX idx_monitored_tmdb_type ON monitored_items(tmdb_id, type)` (handle
existing dup rows first), and make `createItem` use `INSERT ... ON CONFLICT(tmdb_id,type) DO NOTHING RETURNING`
or pre-`SELECT`+return-existing. Then the `'already exists'` catches become real (or, better, replace them with
an explicit "found existing, reuse it" path). Note `tmdb_id` is nullable, so partial-index or a
`WHERE tmdb_id IS NOT NULL` unique index is needed; manual admin items without a tmdb_id must still be allowed.

### A11-C3 — Immediate-grab fire-and-forget races the 15-min cron on the same `wanted` row (double-grab)
Severity: CRITICAL
File: `approve/route.ts:11-28` + `scheduler.ts:32-40`; same pattern in `auto-approve.ts:86-101`,
`seerr/webhook/route.ts:146-150`

**What's wrong.** After creating a monitored item, every approval path fires a non-awaited
`grabItem(item)` ("fire and forget — the 15-min cron is the safety net"). `grabItem` only flips status
`wanted → grabbed` at the very **end** (`grabber.ts:293`), after an `await searchAllIndexers()` +
`await addTorrent()` round-trip that can take seconds. If a `*/15` cron tick fires during that window, the cron
re-reads `getWantedItems()` (still `status='wanted'`), sees the same row, and runs a **second** `grabItem` —
adding a second torrent before the first finishes. There is no in-flight lock, no `status='grabbing'`
intermediate state, no idempotency key. The same applies to two overlapping manual "Grab Now" clicks, or the
`/api/automation/items/[id]/grab` endpoint racing the cron (it doesn't even require `status='wanted'`).

**Why it matters.** Double torrents per title, duplicate `grab_history` rows, wasted bandwidth, and an
inconsistent queue — exactly the failure the unique-index gap (C2) amplifies. Combined with C2 you can get 4×
torrents for one approval.

**Suggested fix.** Introduce a `grabbing` (in-flight) status set atomically at the *start* of `grabItem`
(`UPDATE monitored_items SET status='grabbing' WHERE id=? AND status='wanted'` and bail if `changes===0`), or a
short-lived per-item lock. `getWantedItems()` must exclude in-flight rows. Reset to `wanted` on failure.

---

## HIGH

### A11-H1 — Quality cutoff / upgrade / min-score state machine is entirely dead
Severity: HIGH
File: `quality.ts:163-199` (fields read only by admin getters), `grabber.ts:144-175,256-275` (never consults
them), profile API `src/app/api/quality-profiles/[id]/route.ts:29-49`

**What's wrong.** `quality_profiles` stores `upgrade_allowed`, `cutoff_quality_id`, `min_format_score`, and
`cutoff_format_score`, all writable through the profiles API and surfaced by `getProfileFull`. But
`grabItem`/`findBestRelease` load the profile via `getProfileById` (which selects only `id,name,conditions`)
and never read any of those fields. Therefore: (a) **`min_format_score` is not enforced** — a release with a
negative/below-minimum custom-format score is still grabbed as long as it beats the others; (b) there is **no
upgrade logic at all** — once an item is `imported` it is terminal, the engine never re-searches for a better
release even if `upgrade_allowed=1` and the current file is below cutoff; (c) `cutoff_quality_id` /
`qualityTierWeight` are computed and thrown away (the tier weight isn't even folded into the grab score —
`findBestRelease` uses `base + fmt.totalScore`, ignoring `tier.weight`).

**Why it matters.** The product is sold (CLAUDE.md §14) as a Sonarr/Radarr replacement; cutoff-based upgrades
and a minimum acceptable score are core to that. As written the engine grabs the first acceptable release and
stops, and will accept junk that an admin's `min_format_score` was meant to reject.

**Suggested fix.** Have `findBestRelease` reject `combined < min_format_score`. Incorporate `qualityTierWeight`
into ranking. Implement an upgrade pass: for `imported` items whose profile has `upgrade_allowed=1` and whose
current grabbed tier/score is below cutoff, periodically re-search and re-grab when a strictly-better release
appears (and import-overwrite intentionally). At minimum, document that upgrades are unsupported and stop
storing the unused fields to avoid implying they work.

### A11-H2 — Importer `setLocation` move can silently overwrite an existing good file
Severity: HIGH
File: `importer.ts:289-318` (qBit path), `importer.ts:232-276` (fallback hardlink/copy path)

**What's wrong.** Primary import calls qBit `setLocation` to move the torrent into
`/data/movies/<Title> (year)` or `/data/tv/<Title>` (`buildQbitTargetPath`). The target is derived only from
`item.title`+`item.year` — not from the actual release filename — and qBit's move will happily land on top of
an existing directory/file with the same name (e.g. an earlier successful import, or the duplicate-row second
torrent from C2/C3). The fallback path (`fs.linkSync` → on EEXIST/cross-device falls back to
`fs.copyFileSync`) uses `dest = path.join(targetPath, file)` with **no existence check**: `copyFileSync`
overwrites the destination by default, so a worse re-download can clobber a better existing file. There is no
"don't import if a good file already exists" guard and no upgrade decision (ties into H1).

**Why it matters.** Can overwrite an already-good library file with a duplicate or inferior copy; combined with
C2/C3 (duplicate torrents) this is a realistic data-quality regression on owned media.

**Suggested fix.** Before move/link, check whether a media file already exists at the target and skip (or apply
an explicit upgrade comparison). Use `fs.linkSync` only when dest doesn't exist; for `copyFileSync`, pass
`fs.constants.COPYFILE_EXCL` and handle the EEXIST. Derive the target filename from the release, not just the
monitored title.

### A11-H3 — Availability/import writers update `media_requests` by tmdb_id+type, hitting unrelated/other-user rows
Severity: HIGH
File: `availability.ts:121-126`, `importer.ts:182-184,270-271,311-315`

**What's wrong.** All three "mark available" writers run
`UPDATE media_requests SET status='available'... WHERE tmdb_id=? AND media_type=? AND status='approved'`. There
is no `user_id`, no request id, no `request_type` scoping. If two users have separate approved requests for the
same title, or a user has both a quick and a long-term approved request for it, **one import flips all matching
rows to `available`** and (in availability.ts) sets `auto_delete_at` for every quick row among them. The
monitored item that triggered this has no link back to a specific request, so this is a fan-out by title.

**Why it matters.** A single user's quick request becoming available can mark a *different* user's long-term
request available prematurely, and can attach a 48h auto-delete clock to requests that shouldn't have one —
feeding C1 (wrong-file deletion) and surfacing "available" to users for content not actually theirs.

**Suggested fix.** Carry the originating request id through the monitored item (add a `request_id` column) and
update exactly that row. Where one file genuinely satisfies multiple requests, make that explicit and per-user
rather than an unscoped title `UPDATE`.

### A11-H4 — Importer fallback fuzzy-match can import the wrong torrent's files
Severity: HIGH
File: `importer.ts:193-276` (`normaliseName`/`scoreMatch`, `MIN_SCORE = 4`)

**What's wrong.** When a torrent is gone from qBit, fallback 2 scans `/media/downloads/complete/` and picks the
directory/file with the most ≥3-char token overlap with the stored `release_title`, requiring only **4** token
matches. Token matching ignores order and uniqueness, treats year/resolution/codec/group as ordinary tokens,
and there is no title/year *anchor* — two different releases of similarly-named content (e.g. a franchise, or
`Title 2` vs `Title`) can share ≥4 tokens (`title`, `1080p`, `bluray`, `x264`). The highest scorer is then
hardlinked/copied into this item's library dir and marked imported.

**Why it matters.** Imports the wrong content under the requested title — the library now shows the wrong file
for the request, and (with C1) the wrong file can later be deleted. Silent: only a `console.log`.

**Suggested fix.** Anchor on parsed title equality + year (reuse `parser.parseReleaseName`) before token
scoring; require a much higher / normalized match ratio; for TV verify S/E. Prefer correlating by the torrent's
`save_path`/content name from qBit history rather than fuzzy directory scanning.

### A11-H5 — `findBestRelease` ignores seeders/availability — can grab a 0-seed dead torrent
Severity: HIGH
File: `grabber.ts:144-175` (selection), `parser.ts:229-248` (score has no seeder term)

**What's wrong.** Release selection ranks purely on parsed quality/source/custom-format score. `TorznabResult`
carries `seeders`/`leechers` (seen in `firePreferredGrab` at `approve/route.ts:88-90`) but `findBestRelease`
never consults them, has no minimum-seeder floor, and no size sanity bounds. The highest-"quality" title can be
a 0-seeder release that will never complete; the item then sits in `grabbed` indefinitely (availability only
promotes when the file appears) and the importer never finds it.

**Why it matters.** Stalls the pipeline on a per-item basis with no retry-to-next-candidate logic, and there is
no re-grab once `grabbed`. A request can hang forever on a dead torrent that a seeder check would have skipped.

**Suggested fix.** Add a configurable minimum-seeder threshold and a size band; on a grab that makes no
download progress after N ticks, blacklist that release hash and re-grab the next-best candidate.

### A11-H6 — `grabItem` does not guard against re-grabbing an already-`grabbed`/`imported` item
Severity: HIGH
File: `grabber.ts:192-295` (no status precondition), `items/[id]/grab/route.ts:30-37`,
`requests/[id]/grab/route.ts`

**What's wrong.** `grabItem` accepts any `MonitoredItem` regardless of current status and always proceeds to
search → add torrent → `recordGrab` → set `grabbed`. The manual grab endpoints explicitly allow force-grabbing
"any item" ("does not have to be in 'wanted' status"). Re-invoking on an `imported` item re-adds a torrent and
flips it back to `grabbed`, undoing the imported state and re-triggering the import loop / availability churn.
There is no idempotency key on `(item_id, info_hash)` in `grab_history` either, so the same release can be
recorded and re-added repeatedly.

**Why it matters.** A stray re-grab (manual button, or a duplicate row reaching the cron) regresses a finished
item, re-downloads, and can re-import/overwrite (H2). No mechanism prevents the same release from being grabbed
twice.

**Suggested fix.** Gate auto-grabs on `status='wanted'` (the cron already filters, but `grabItem` itself
should assert it for the immediate-grab/manual paths). Add a unique `(item_id, info_hash)` constraint or a
pre-check in `recordGrab`. For deliberate re-grab/upgrade, take an explicit `force`/`upgrade` flag.

---

## MEDIUM

### A11-M1 — qBit completion detection treats `pausedUP` / `stoppedUP` / `checkingUP` as "complete"
Severity: MEDIUM
File: `importer.ts:30-38` (`COMPLETE_STATES`), `availability.ts:26-29` (`SEEDING_STATES`)

**What's wrong.** Both completion sets include `pausedUP`/`stoppedUP`/`checkingUP`/`queuedUP`. A torrent can be
in `pausedUP`/`checkingUP` while **not** fully downloaded (e.g. paused mid-recheck, or a recheck that fails).
The importer does also OR in `progress >= 1.0` (good), but `availability.markCompletedDownloads` keys
*only* on state membership with no progress check — so a paused-but-incomplete torrent sets
`download_completed_at`, which then anchors the 48h auto-delete clock from a false completion time.

**Why it matters.** Premature `download_completed_at` shortens the real retention window (auto-delete fires too
early) and can mark items "seeding/complete" that aren't.

**Suggested fix.** In `markCompletedDownloads`, require `progress >= 1.0` (it already fetches enough fields via
`/torrents/info` — add `progress` to the select and gate on it), mirroring the importer.

### A11-M2 — Scope filter `seasons` regex `Season.?N` is loose and `S0N` can match wrong seasons
Severity: MEDIUM
File: `grabber.ts:102-122` (`seasonPatterns`, `S${s}|Season.?${n}(?!\d)`)

**What's wrong.** For a requested season `n`, the pattern is `S0n|Season.?n(?!\d)`. `Season.?N` allows an
optional single any-char between "Season" and the number, so "Season 2" but also "Seasons-2" etc.; more
importantly the `S0n` half (e.g. `S02`) will also match strings like `S02E…` — the pack-vs-episode partition
relies on a *separate* `S\d{2}E\d{2}` test to demote episodes, but a release titled `Show S02 1080p` and one
titled `Show S0205` (no separator) both satisfy `S02`. Multi-season requests (`seasons.length>1`) fall through
`buildSearchParams` to a **title-only** query (`grabber.ts:54-62` only special-cases length===1), so the
indexer query isn't scoped and relies entirely on this loose post-filter.

**Why it matters.** Can grab the wrong season or an episode when a pack was intended; multi-season requests
search un-scoped and may pull unrelated results that happen to pass the regex.

**Suggested fix.** Anchor season tokens with boundaries (`\bS0?n\b` and `\bSeason\s+n\b`), and for the
pack preference exclude any `S\d{2}E\d{2}` more strictly. For multi-season, issue one scoped query per season
rather than a title-only search.

### A11-M3 — `RE_YEAR` upper bound `20[012]\d` only reaches 2029
Severity: MEDIUM
File: `parser.ts:70` (`/\b(19\d{2}|20[012]\d)\b/g`)

**What's wrong.** The year regex matches `1900-1999` and `2000-2029` only. From 2030 on, release years won't be
parsed (year → null), so `extractTitle`'s earliest-anchor cut loses the year anchor and `parseReleaseName.year`
is null. Also `auto-approve` gates on `request.year >= currentYear`; once we pass 2029 a 2030 release simply
won't carry a parsed year from the filename (separate from the request's own year field, but the parser is used
in scoring/title-cut).

**Why it matters.** Future-proofing defect; mis-parses titles for 2030+ content and weakens year-based logic.

**Suggested fix.** Broaden to `20\d{2}` (with a sane sanity cap) or `19\d{2}|20\d{2}`.

### A11-M4 — Scheduler `started` guard is module-scoped, not `globalThis`-pinned (multi-worker double cron)
Severity: MEDIUM
File: `scheduler.ts:24-29`, called from `instrumentation.ts:20-21`

**What's wrong.** `let started=false` lives in module scope. CLAUDE.md §16 explicitly documents that for party
play they pinned the started guard to `globalThis` precisely because instrumentation can run more than once and
module state isn't reliably shared. The scheduler did not get the same treatment. In a single-process
standalone server this is fine, but if the deployment ever runs multiple Node workers/instances (or
instrumentation re-imports a fresh module graph), each gets its own `started=false` and registers its own set
of crons → N concurrent grab loops over the same `wanted` rows (amplifying C3).

**Why it matters.** Multiplies the double-grab race by the worker count; silent.

**Suggested fix.** Pin the guard on `globalThis` (same pattern as `PartyStateStore`/party server). Also consider
a DB-level advisory lock so only one instance runs the grab loop even across processes.

### A11-M5 — Cron grab loop has no overlap guard; a slow tick can overlap the next tick
Severity: MEDIUM
File: `scheduler.ts:32-40`

**What's wrong.** The `*/15` job awaits `grabItem` sequentially for every wanted item. With a large want list
and slow indexers, one tick's total runtime can exceed 15 minutes; node-cron will start the next tick while the
previous is still running (node-cron does not skip overlapping invocations). Both ticks read the same
`getWantedItems()` snapshot at the top and walk it. Combined with the lack of an in-flight status (C3), the two
overlapping loops grab the same still-`wanted` items.

**Why it matters.** Self-overlap re-introduces the double-grab even without the immediate-grab path.

**Suggested fix.** Add a module/`globalThis` "loop running" boolean and early-return if a previous tick is still
in flight (the same fix C3's in-flight status would also cover). The 2-minute import cron has the same
no-overlap exposure on slow qBit/scan.

### A11-M6 — `addTorrent` never sets a save path; relies on qBit default + later `setLocation`
Severity: MEDIUM
File: `grabber.ts:279-282`, `qbittorrent.ts addTorrent` (no `savePath` passed), importer comment
`importer.ts:6-13`

**What's wrong.** Grabs add torrents with only `category`, no `savePath`/`save_path`. Whether the file ends up
somewhere the importer's `setLocation`/fallback can find depends entirely on qBittorrent's configured default
save path and the `/downloads` ↔ `/media/downloads/complete` mount assumptions described only in a comment. If
qBit's default category save path differs, the importer's fallback scan of `/media/downloads/complete` misses
it and the item never imports (sits in `grabbed`). Nothing validates the assumed mount layout at runtime.

**Why it matters.** Fragile cross-container path coupling; a qBit settings change silently breaks import with no
error surfaced.

**Suggested fix.** Pass an explicit `savePath` on add (or set the category's save path deterministically), and
have the importer reconcile against the torrent's actual `save_path`/`content_path` from qBit rather than a
hard-coded complete dir.

### A11-M7 — `auto-delete` directory cleanup can `rmdir` the shared library root
Severity: MEDIUM
File: `auto-delete.ts:83-91`

**What's wrong.** After deleting files, the cleanup loops over each parent `dir`, and *also* walks one level up
(`parent = path.dirname(dir)`) and `rmdir`s it if empty. For a movie at `/media/movies/Title (2008)/movie.mkv`,
`dir` = the movie folder and `parent` = `/media/movies` — if that movie was the only thing in the library,
`rmdirSync('/media/movies')` removes the mounted library root directory itself. Same for `/media/tv`. It's
guarded by "only if empty," but emptiness of a mount root is plausible on a fresh/low-content install.

**Why it matters.** Can delete the bind-mount target directory, breaking the scanner and future imports until
recreated.

**Suggested fix.** Never ascend above the known library roots. Maintain an allowlist of roots
(`/media/movies`, `/media/tv`) and refuse to `rmdir` any path that is (or is at/above) a root.

---

## LOW

### A11-L1 — `setLocation` then fixed 2s sleep is a race with qBit's async move
Severity: LOW
File: `importer.ts:293-302`

**What's wrong.** After `setLocation`, the code sleeps a hard-coded 2000ms then scans. Large files / busy disks
take longer to move; the scan then finds nothing and the item isn't marked imported until a later tick (the
availability cron eventually catches it via `media_items`, so not fatal, but the immediate scan is wasted and
the log says nothing moved).

**Suggested fix.** Poll qBit for the torrent's new `save_path`/completion instead of a fixed sleep, or
re-scan on the next tick idempotently (already partly true).

### A11-L2 — Language hard-reject drops all untagged English releases on non-`any` profiles
Severity: LOW
File: `grabber.ts:157-161`, `parser.ts:51-56`

**What's wrong.** When a profile language is set (e.g. `en`), `findBestRelease` rejects any release whose
`parseLanguage` returns null. Most English scene releases carry **no** language tag, so `parseLanguage` returns
null and they're all rejected — a profile set to "English" would grab almost nothing. The code comments
acknowledge null≠English but the default `language` plumbed from the profile (`getProfileFull.language ?? 'any'`)
mitigates only if admins leave it `any`.

**Why it matters.** A well-intentioned "English only" profile silently starves the want list.

**Suggested fix.** Treat untagged as acceptable when the requested language is English (the common default), or
add an explicit "accept untagged" toggle.

### A11-L3 — `recordGrabResults` stores full candidate JSON unbounded per search
Severity: LOW
File: `grab-results.ts:20-37`, called every grab incl. the not-found path `grabber.ts:249,273`

**What's wrong.** Every grab attempt (including pure `not_found` cron ticks every 15 min for stuck items)
inserts a `grab_results` row containing the JSON of *all* candidates. For a chronically-unfindable item this
grows without bound (no retention/cap; only `getLatest...` reads the newest). Over months this bloats the DB.

**Suggested fix.** Cap rows per item (keep last N) or prune old `grab_results` on a schedule.

### A11-L4 — `not_found` does not reset/backoff; stuck `wanted` items re-searched forever every 15m
Severity: LOW
File: `scheduler.ts:32-40`, `grabber.ts:275`

**What's wrong.** Items that never find a release stay `wanted` and are re-searched on every 15-minute tick
indefinitely, hammering indexers with the same fruitless query and writing a `grab_results` row each time
(L3). No exponential backoff, no "searched N times, cool down" state.

**Suggested fix.** Track `last_search_at`/`search_attempts` and apply increasing backoff for repeatedly
not-found items.

### A11-L5 — Subtitle deletion in auto-delete wipes ALL sub files in a shared dir
Severity: LOW
File: `auto-delete.ts:70-79`

**What's wrong.** Per collected `dir`, it deletes **every** `.srt/.vtt/.ass/.ssa/.sub` file in that directory,
not just those belonging to the deleted media. For movies each movie has its own dir so this is usually safe,
but for TV the season/show dir can contain subtitles for episodes that are *not* part of this expiring request
(if scope was a subset of episodes). Those siblings' subtitles get deleted.

**Suggested fix.** Delete only subtitle files whose basename matches the deleted video file(s), not a blanket
extension sweep of the directory.

---

## Pipeline trace (for reference)

1. **monitor** — `getWantedItems()` returns `status='wanted' AND monitored=1`. (No in-flight state; dup rows
   possible — C2.)
2. **search/select** — `grabItem` → `buildSearchParams` → `searchAllIndexers` → `filterByScope` →
   `findBestRelease` (quality+format score only; no seeders/min-score/cutoff — H1/H5).
3. **grab** — `addTorrent({urls, category})` (no savePath — M6) → `recordGrab` → `status='grabbed'` (set last,
   racy — C3).
4. **watch download** — `availability.markCompletedDownloads` sets `download_completed_at` when qBit state is
   in `SEEDING_STATES` (state-only, no progress — M1).
5. **import** — `runImportCheck` (every 2m): if torrent complete → `setLocation` move → 2s sleep → `scanPath`
   → `status='imported'`; fallbacks: already-in-library, or fuzzy filename match in `/media/downloads/complete`
   (H2/H4/M6).
6. **mark available** — both `availability.checkAvailability` and `importer` write
   `media_requests.status='available'` by `tmdb_id+type` (fan-out — H3); availability sets `auto_delete_at`
   = completion + 48h for quick rows.
7. **auto-delete** — hourly: for `auto_approved=1 AND status='available' AND auto_delete_at<=now`, delete
   `media_items` files by `tmdb_id+type` (CAN HIT OWNED MEDIA — C1; dir cleanup can hit roots — M7; subs sweep —
   L5).

## Authz / API surface notes (positive)
- All `/api/automation/*` routes call `requireAdmin()` first. `updateItem` uses an `ITEM_ALLOWED_FIELDS`
  allowlist that genuinely prevents SQL-identifier injection in the dynamic SET clause (`monitor.ts:123-176`).
  POST `items` validates `type`/`title`. `bridge` GET projects a clean DTO. The manual grab endpoint correctly
  resolves the item and returns `grabItem`'s status — but inherits the no-precondition issue (H6) and races the
  cron (C3). `force-dynamic` is set everywhere to avoid stale caching.
