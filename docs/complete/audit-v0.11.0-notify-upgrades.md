# Audit — v0.11.0 working tree (notifications + upgrade-until-cutoff)

Depth-matched to the v0.10.2 master audit (security / correctness / data-engine / perf, plus a full
tsc + eslint + `next build` verification). Audited the uncommitted changeset only — the v0.10.2 items
are all closed (`audit-v0.10.2-master-progress.md`).

Changeset under audit (8 modified, 5 new):
- NEW `lib/notify/index.ts` (Discord + ntfy dispatch), `lib/notify/available.ts` (capture-before-update helper)
- NEW `lib/automation/upgrade.ts` (upgrade-until-cutoff, movies only)
- NEW `api/admin/notify/test`, `api/automation/upgrades` routes
- MOD `seerr/webhook`, `availability.ts`, `importer.ts` (3 paths), `scheduler.ts` (2 crons),
  `migrations.ts` (`pending_upgrades` table + `monitored_items.last_upgrade_scan_at`),
  `settings/index.ts` (3 KNOWN_SETTING_KEYS), `admin/automation/page.tsx` (Notifications/Upgrades UI)

## Verdict: CLEAN. No security or correctness defects. Build/tsc/lint all green.

## What was verified
- **Notification dedup is sound.** All five available-transition paths use the two-step
  capture-before-update pattern. `collectAvailableNotifications` is synchronous (better-sqlite3) and there
  is **no `await` between the capture and the UPDATE** on any path (webhook / availability / importer×3),
  so in the single-threaded Node process the read+write is atomic — whichever path flips a row first wins,
  the others capture 0 rows. Confirmed by reading each call site.
- **Webhook status list is exact.** `media_requests.status CHECK IN ('pending','approved','declined',
  'available','expired')`. The webhook captures `['pending','approved','declined','expired']` and the
  UPDATE uses `status != 'available'` — the capture set equals the transition set, so no over- or
  under-notification.
- **No double-notify across channels.** `dispatch()` fires Discord + ntfy via `Promise.allSettled`,
  per-channel try/catch, 8s `AbortController` timeout, failures logged + swallowed. Master toggle
  (`notify_on_available`, default '1') honored by the real path, bypassed by the admin test path.
- **ntfy unicode fix is correct** — JSON body (`{topic,title,message,tags}`) to the origin base, not
  latin1 `Title`/`Tags` headers. `parseNtfy` rejects multi-segment paths.
- **Upgrade engine dependencies all exist with matching signatures** — `getProfileFull` (upgrade_allowed/
  cutoff_quality_id/cutoff_format_score/language), `recordGrab`→`{info_hash}`, `findBestRelease(results,
  profile,language)`, `buildSearchParams`/`filterByScope`, `addTorrent({urls,category})`,
  `deleteTorrents(hashes,deleteFiles)`, TorznabResult fields. tsc confirms.
- **Upgrade file replacement is crash-safe.** Two-phase: `scanForUpgrades` never deletes (records
  `pending_upgrades`); `completeUpgrades` deletes the old file **only after** a NEW distinct `file_path`
  appears for the tmdb. Same-name in-place re-grab (newPaths empty) is handled separately and never
  deletes the surviving file. `fs.existsSync` guard before unlink. Movies-only (`type='movie'`) so the
  single-file clean-swap invariant holds; TV deferred by design.
- **New routes gated correctly** — `requireAdmin` on both; `verifyOrigin` on both POSTs. JSON parse
  guarded. `force-dynamic`.

## Noted (acceptable, no action)
- **N1 (P, edge):** importer fires `await notifyAll` inline per item rather than batching after the loop
  (as availability.ts does). Not a real divergence — the importer loop already awaits per item
  (`setLocation` + a 2s settle + `scanPath`), so a bounded 8s best-effort send adds negligible relative
  latency and only when a channel is configured *and* slow.
- **N2 (edge):** the 6-hourly upgrade scan does not exclude quick-request movies whose 48h auto-delete is
  pending — it can grab an upgrade for a movie about to be reclaimed. Self-healing (`existsSync` guard;
  old file may already be gone) and wasteful at worst, never destructive.
- **N3 (edge, ~impossible):** if the just-added upgrade torrent isn't yet listed by qBit on the *same*
  tick, the importer's Fallback-1 (`alreadyInLibrary` via the still-present old row) could mark the item
  imported early and abandon the upgrade (old file kept, `pending_upgrades` → completed). The upgrade
  scan and import crons are independent (6h vs 2min), so the add is always registered well before the
  next import tick — the race window is sub-second against a 2-minute gap. Non-destructive; the next 6h
  scan retries (item still below cutoff).
- **N4 (security, acceptable):** server fetches admin-set `notify_discord_webhook` / `notify_ntfy_url`
  (SSRF surface). Admin-only (KNOWN_SETTING_KEYS behind `requireAdmin` PUT); standard for self-hosted.

## Verification
- `npx tsc --noEmit` → exit 0
- `npx eslint` over all 9 changed/new source files → exit 0 (react-hooks rules at error)
- `npm run build` → exit 0; both new routes registered (`ƒ /api/admin/notify/test`,
  `ƒ /api/automation/upgrades`)

State: changeset remains **uncommitted** in the working tree, not deployed.
