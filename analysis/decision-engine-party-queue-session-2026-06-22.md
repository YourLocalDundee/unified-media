# Session handoff — Decision engine + Party queue (2026-06-22)

Shipped the three Tier-1 items from `feature-mining-summary.md`: **decision gate-chain + rejection
reasons**, **real custom formats**, and **Party Play shared queue with auto-advance**. All deployed and
verified in production.

- **Commit:** `69afb57` on `main` (`af0fb80..69afb57`), pushed to `origin`.
- **Version:** `0.10.0` (was 0.9.11).
- **Gate:** `npm run type-check` clean, `npm run lint` 0 errors (78 pre-existing warn-level findings),
  `npm run build` green.
- **Working tree:** clean.

---

## 1. Decision gate-chain + rejection reasons (feature mining Tier-1 #1)

Two-stage release evaluation in the grabber, like Sonarr/Radarr: **hard gates** decide what is grabbable
at all, then the existing **soft score** ranks what survives. Full reference in CLAUDE.md §17.

### Files
- **NEW `src/lib/automation/gates.ts`** — the gate engine + blocklist data layer.
  - `evaluateGates(result, config, blocked)` → `GateReason[]` (empty = passed). Reasons:
    `blocklisted | dead | sample | oversize`.
  - `getGateConfig(type)` reads tunable thresholds from `app_settings` each search (no redeploy):
    `gate_min_seeders` (default 1), `gate_max_size_movie_gb` (100), `gate_max_size_tv_gb` (200); a
    max-size of 0 disables that cap.
  - `partitionByGates(results, type, blocked?)` → `{ passing, gatesByKey }`.
  - Blocklist CRUD: `loadBlocklist()` (Set of lowercased hashes), `isBlocklisted`, `addToBlocklist`
    (idempotent upsert), `removeFromBlocklist`, `getBlocklist`.
  - `GATE_REASON_LABELS` for any server-side label use.
- **`src/lib/db/migrations.ts`** — new `grab_blocklist` table (PK `info_hash` lowercased, `title`,
  `reason`, `blocked_at`).
- **`src/lib/automation/grab-results.ts`** — `ScoredCandidate.gates?: GateReason[]`; new
  `SkipReason 'gated'`.
- **`src/lib/automation/grabber.ts`** —
  - `grabItem` now partitions scope-filtered results, annotates every `ScoredCandidate` with its gate
    reasons, auto-picks from the **passing** pool only, and records skip reason `'gated'` when everything
    was gated (or `'no_seeders'` when the only failure was the seed floor).
  - `findBestRelease(results, profile, language, gateOpts?)` — optional `gateOpts:{type,blocked?}` excludes
    gated releases from auto-pick. `findSeasonPack`/`findArcPack` pass `{type:'tv'}`; `findCoveringPacks`
    filters its pool through `partitionByGates` first.
  - `autoPickScore` passes `result.size` into `scoreWithProfile` (for size custom formats — see §2).
- **`src/lib/automation/reaper.ts`** — reaped dead stuck-metadata torrents are `addToBlocklist`ed so the
  cron won't re-grab them.
- **NEW `src/app/api/automation/blocklist/route.ts`** — `GET` list / `POST` block `{infoHash,title?,reason?}`
  / `DELETE` unblock `{infoHash}`. requireAdmin + verifyOrigin.
- **`src/app/api/torrent-search/route.ts`** — returns per-result `gates` (informational; the interactive
  picker still grabs anything).
- **`src/components/media/SeasonGrabControl.tsx`** — renders amber gate badges per candidate; rows stay
  grab-able (override surface). Labels duplicated client-side (`gates.ts` is server-only).

### Behaviour notes
- Auto-pick will never grab a gated release; the admin interactive picker is the override path.
- `SEED_DEAD_PENALTY` in `autoPickScore` is now somewhat redundant with the `dead` gate but kept (harmless;
  gated releases are excluded from auto anyway).

---

## 2. Real custom formats (feature mining Tier-1 #2)

Extended the custom-format matcher in `src/lib/automation/quality.ts`. The scaffolding
(`custom_formats` / `quality_profile_formats` tables, `scoreWithProfile`, profile admin page) already
existed; this activates the fuller matcher.

- `CustomFormatSpec.type` now: `title_regex | resolution | source | codec | language | release_group |
  size | flag`.
  - **language** — ISO 639-1 from the title (`meta.language`).
  - **release_group** — exact `meta.group` match.
  - **size** — GB range `min-max` / `min-` / `-max`; needs the release size, threaded via
    `scoreWithProfile(title, profileId, sizeBytes)` from `autoPickScore`.
  - **flag** — named release flag via `FLAG_PATTERNS` (proper/repack/internal/real/extended/uncut/remux/
    hybrid/hdr/hdr10plus/dv/atmos/imax); unknown keys fall back to a word-boundary match.
    `CUSTOM_FORMAT_FLAGS` exports the known keys.
- **`src/app/admin/quality-profiles/page.tsx`** — `SPEC_TYPES` now lists all eight; `SPEC_VALUE_HINT`
  gives a per-type placeholder. The profile API (`/api/quality-profiles/[id]`) stores specs as JSON with
  no type allowlist, so no server change was needed.

---

## 3. Party Play shared queue with auto-advance (feature mining Tier-1 #3)

Any-member shared "up next" queue. On item end the server auto-advances and navigates every member to the
next item (zero-click binge). Full reference in CLAUDE.md §16 "Shared queue with auto-advance".

### Files
- **`src/lib/db/migrations.ts`** — `watch_party_queue` (id, party_id, media_id, title, position, added_by,
  added_by_name, added_at) + index.
- **`src/lib/party/types.ts`** — `QueueItem`, `QueueItemDTO`, `PartyLiveState.queue`; client messages
  `queue_add/queue_remove/queue_reorder/queue_advance`; server messages `queue` + `queue_advance`.
- **`src/lib/party/constants.ts`** — `MAX_QUEUE_LENGTH = 200`.
- **`src/lib/party/in-memory-store.ts`** — `createParty` inits `queue: []`.
- **`src/lib/party/db.ts`** — `getPlayableMedia`, `persistQueue` (delete+reinsert, gap-free positions),
  `loadQueue`, `setPartyMedia` (point party at new media + reset checkpoint).
- **`src/lib/party/server.ts`** — `handleQueueAdd/Remove/Reorder/Advance` (each via atomic `updateParty`,
  then `persistQueue`, then `broadcastQueue`), `queueToDTO`/`broadcastQueue`, validateMessage cases, join
  sends the queue snapshot, rehydrate reloads the queue.
- **`src/hooks/usePartySync.ts`** — queue state + ops (`addToQueue`, `removeFromQueue`, `reorderQueue`,
  `playNext`), handles `queue`/`queue_advance`, fires `queue_advance` on the `<video>` `ended` event,
  `onQueueAdvance` opt for navigation, `suppressLeaveRef` (see race note below).
- **`src/components/media/VideoPlayer.tsx`** — passes `mediaId`/`onQueueAdvance` to the hook (navigates via
  `router.push(/play/${id}?party=${code})`), passes queue props to `PartyPanel`.
- **`src/components/party/PartyPanel.tsx`** — "Up next" list (remove + Play next) + `QueueAdder`
  (debounced `/api/media/items?q=` library search; series containers filtered out).

### Two design decisions made this session (confirmed with the user)
- **Auto-advance navigates all members** (vs. shared-queue-only/manual). On end → server advances →
  broadcasts `queue_advance{mediaId,joinCode}` → every client `router.push`es to the next item.
- **Any member controls the queue** (consistent with the existing shared play/pause/seek model).

### The navigation race (important — don't regress this)
On auto-advance every client `router.push`es, which unmounts the old `VideoPlayer`. The hook's cleanup
normally sends an explicit `leave`, which would risk `leaveAndMaybeEnd` ending the party (last-member-out)
while everyone is mid-navigation. Fix: the `queue_advance` handler raises `suppressLeaveRef`; the cleanup
then **skips the leave**, so the socket close falls into the 30s disconnect grace window and the re-join on
the next page reactivates the member (`left_at` stayed NULL). Advance is idempotent via the `fromMediaId`
guard (server advances only if it still matches the current `mediaId`).

### Advance playback state
On advance the server sets the new item `paused:false`, position 0; the client's `applyState` auto-plays
once buffered (permitted because the document had user interaction before the client-side nav). The
readiness gate is bypassed for advance (pendingPlay null) — drift reconciliation re-aligns members within
a few seconds. If a client's autoplay is blocked it stays paused on the new item until a manual play.

---

## 4. Deploy + verification (done)

```
docker compose -f /opt/docker/compose/docker-compose.yml build --no-cache unified-frontend
docker compose -f /opt/docker/compose/docker-compose.yml up -d --force-recreate unified-frontend
```

- Container healthy; logs clean — party WS on `0.0.0.0:3002/api/party/ws`, scheduler/subtitle/scanner up.
- Live DB migrated: `grab_blocklist` + `watch_party_queue` present with correct columns.
- `grab_blocklist` write/read/delete round-trip passed (cleaned up, 0 rows).
- `/api/health` → 200 (in-container; the service publishes no host port — Caddy reaches 3001/3002 by
  container DNS).

---

## 5. Not done / follow-ups

- **Manual two-browser test of party auto-advance** — the only path not exercisable by type-check/build.
  Queue an item, let the first end, confirm both clients land on the next AND the party survives the
  transition (the grace-window race fix). Worth doing at a screen.
- ~~**Gate thresholds have no admin UI**~~ — **DONE v0.10.2.** Editable on `/admin/automation` → "Grab
  Gates" via `GET`/`PUT /api/admin/settings`. See `analysis/bucket1-cleanup-session-2026-06-23.md`.
- ~~**Blocklist has an API but no admin page**~~ — **DONE v0.10.2.** `/admin/automation` → "Blocklist"
  (list + remove + manual block) over the existing `/api/automation/blocklist`.
- ~~**Queue reorder UI is remove-only in practice**~~ — **DONE v0.10.2.** `PartyPanel` "Up next" rows have
  move-up/down controls wired to `reorderQueue` (move buttons over drag for touch reliability).
- **Auto-advance starts the next item playing** — if you'd rather it land paused ("Up next, press play"),
  flip `s.paused = false` → `true` in `handleQueueAdvance` (server.ts).
- ~~**78 lint warnings** remain (pre-existing warn-level react-hooks rules; my `QueueAdder` effect adds a
  couple of the same kind). Promote to error + clean up when you want.~~ **DONE — v0.10.1 (2026-06-23).**
  All 78 fixed with real code changes (no suppressions); the four react-hooks rules are now enforced at
  `error`. See `analysis/lint-cleanup-session-2026-06-23.md` and CHANGELOG 0.10.1.

## 6. Remaining mining backlog (next candidates)

From `feature-mining-summary.md`, now that Tier-1 #1/#2/#3 are shipped: upgrade-until-cutoff + proper/repack
(Tier-2 #5), blocklist + auto-retry on failed grab (Tier-2 #6, the blocklist half is now in place),
indexer health/backoff (Tier-2 #7), Discord/ntfy notifications (Tier-1 #4), voice chat (Tier-2 #8).
