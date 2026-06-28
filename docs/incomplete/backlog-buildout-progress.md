# Backlog Build-out Progress Tracker

Working through `open-issues.md` sections 2 (deferred partials) and 3 (independence veins),
**two items at a time**, updating this file after each item/pair so progress survives a disconnect.
Started 2026-06-27. Layered on top of the still-uncommitted v0.10.2 + v0.11.0 working tree.

Path map: app root `/home/minijoe/dev/unified-frontend/app`, code under `app/src/`.
Verify each pair: `npx tsc --noEmit` + `npx eslint <files>` + (per section) `npm run build`.

## Item checklist

| # | Item | Section | Status | Notes |
|---|------|---------|--------|-------|
| 2a | Transmission + Deluge download clients | 2 | DONE | full RPC/JSON-RPC impls; registry wires all 3; per-client env vars |
| 2b | Theme marketplace (export/import/share-string) | 2 | DONE | versioned unicode/URL-safe codec; UI wired (was scaffolded, unrendered) |
| 2c | Keyboard-shortcut reference auto-generation | 2 | DONE | new PLAYER_SHORTCUTS registry; page generated from it; player cases annotated |
| 2d | Admin audit-log CSV export | 2 | DONE (already shipped) | route + wired Export button already existed; open-issues.md was stale |
| 3a | proper/repack upgrades | 3 | DONE | upgrade engine now grabs PROPER/REPACK at cutoff (revisionLevel, proper window) |
| 3b | auto-retry on failed grab | 3 | DONE (already shipped) | reaper.ts already does blocklist+remove+reset-to-wanted+max-attempts |
| 3c | indexer health/backoff | 3 | DONE | consecutive_failures+disabled_until; exp backoff; fan-out skips backed-off |
| 3d | import lists (Trakt/RSS auto-add) | 3 | DONE | engine+2 tables+3 API routes+6h cron+admin card; long-term only (auto-delete safe) |

## ALL 8 ITEMS COMPLETE (2026-06-28). Full `npm run build` green. Changeset uncommitted.

---

## Phase 2 — deferred items + feature backlog (started 2026-06-28)

After CLAUDE.md was updated to v0.12.0 and feature-mining-summary.md refreshed (2 subagents), continuing
with deferred items then the feature backlog (sections 4/5), still 2 at a time + verify + tracker update.

Refreshed mining Tier-1 (feature-mining-summary.md): per-indexer rate limiting, movie Collections,
delay profiles, Party creator-kick + control-lock. Tier-2: TV season-pack upgrades, category mapping+caps,
indexer flags+stats, edition/AKA parsing, voice chat (needs coturn/STUN-TURN), calendar.

| # | Item | Status | Notes |
|---|------|--------|-------|
| D1 | Per-indexer request-rate limiting | DONE | token bucket (config.ts) + rate_limit_per_min col + /admin/indexers field |
| D2 | Adapter-level backoff (yts/eztv/nyaa) | DONE | adapters throw on hard failure; fan-out try/catch records backoff |
| 4a | Bulk session revoke (admin) | DONE | POST /api/admin/sessions/revoke-all (spares caller) + button on /admin/monitoring |
| 4b | Download-to-browse linking | DONE | match-torrent API already existed; wired "View in library" in TorrentDetailPanel |
| 4c | Movie Collections (follow franchise) | TODO | mining Tier-1; TMDB collection → monitored_items |
| 4d | Delay profiles | TODO | mining Tier-1; wait N min before grabbing |
| 4e | Mobile PWA (manifest + SW) | TODO | CLAUDE §13 |
| 4f | Jellyfin user linking | TODO | CLAUDE §13 |
| -- | Web Push, torrent-create, piece-map, bandwidth quota, indexer stats/flags, category mapping, edition parsing, TV season upgrades | TODO | remaining backlog |
| -- | Voice chat (Party) | NEEDS DECISION | WebRTC + coturn STUN/TURN infra; can't build/verify headless |
| -- | Caddy /api/party/ws idle timeout; 2-browser party test | BLOCKED | need manual off-tailnet cellular test (not headless-doable) |

## Phase 2 progress log
- 2026-06-28: CLAUDE.md → v0.11.1 (patch bump per user convention: bump 0.0.x before 0.x.0). Added §19
  upgrade/proper, §20 import lists, §21 indexer health; updated download-client table + §13 theme/shortcut/
  Sonarr-Radarr DONE + a "keep lean" maintenance note. feature-mining-summary.md refreshed (subagent).
  open-issues.md Partials reconciled. Status-sweep subagent confirmed backlog is intentional + flagged
  Sonarr/Radarr-status drift (fixed).
- 2026-06-28: **D1+D2 DONE (deferred).** D1 per-indexer rate limiting: in-memory token bucket
  `tryConsumeIndexerToken` + `indexers.rate_limit_per_min` col (additive) + PATCH allowlist + types +
  /admin/indexers edit-modal field; throttled = skipped (not a backoff hit). D2: yts/eztv/nyaa adapters
  now THROW on hard failure (HTTP/network/parse) while keeping []-for-empty, and the fan-out try/catch
  records their backoff — they're full backoff targets now. CLAUDE §21 updated. tsc+eslint clean.
- 2026-06-28: **4a+4b DONE.** 4a bulk session revoke: `POST /api/admin/sessions/revoke-all` (deletes all
  sessions except the caller's; logEvent) + "Revoke all sessions" button on /admin/monitoring. 4b
  download-to-browse: the hardened `/api/media/match-torrent` route already existed but was unwired;
  added `name` prop + lazy match fetch + "View in library →" link in TorrentDetailPanel overview.
  Full `npm run build` green (53 routes). Version 0.11.1.

## Progress log

- 2026-06-27: Tracker created. Pair 1 = 2a + 2b. Starting exploration.
- 2026-06-27: **2a DONE.** Implemented `TransmissionClient` (transmission RPC: X-Transmission-Session-Id
  409-retry, torrent-get/add/remove/start/stop, session-stats, client-side status filter, full-snapshot
  pollMaindata) and `DelugeClient` (JSON-RPC `/json`: auth.login + web.connect handshake with cookie
  cache + 1-retry, web.update_ui, core.add_torrent_magnet/url, remove/pause/resume, get_free_space).
  `config.ts` reads TRANSMISSION_*/DELUGE_* with UMT_* fallback; `registry.ts` instantiates all three and
  marks all implemented. tsc+eslint clean.
- 2026-06-27: **2b DONE.** Found `ThemeSection.tsx` had export/import handlers + state scaffolded but
  NEVER rendered (Upload/Download icons imported-unused), and the codec was naive (`btoa` throws on
  unicode, not URL-safe, import unsanitized). Added `encodeThemeShare`/`decodeThemeShare` to
  `ThemeToggle.tsx` — `umt-theme-v1:<base64url>` payload `{n,c}`, TextEncoder-based unicode-safe +
  URL-safe; decode sanitizes colors (A21-02), assigns fresh id, accepts legacy bare-base64. Exported
  `sanitizeColors`. Wired the UI: per-custom-theme Share (copy) button + Import tile + paste panel with
  error/copied feedback. tsc+eslint clean.
- 2026-06-27: Pair 1 verified (tsc exit 0, eslint exit 0). Moving to Pair 2 = 2c + 2d.
- 2026-06-27: **2d DONE — was already shipped.** `api/admin/audit/export/route.ts` (formula-neutralized,
  ?from/?to date filter) AND the wired `Export CSV` button on `/admin/audit` both already existed.
  open-issues.md "not done" line is stale. No code change; will fix the doc.
- 2026-06-27: **2c DONE.** Created `src/lib/shortcuts.ts` (`PLAYER_SHORTCUTS` grouped registry — the single
  source of truth, client-safe data). Rewrote `/settings/shortcuts` to generate the grouped table from it
  (no hand-maintained list). Annotated each VideoPlayer keydown case with its `shortcut:<id>` for
  traceability + an anchor comment. Deliberately did NOT rewire the player's party-coupled keydown hot path
  to match against the registry at runtime (regression risk, no user benefit). tsc+eslint clean.
- 2026-06-27: **Section 2 COMPLETE.** Full `npm run build` exit 0. Next: Section 3, Pair 3 = 3a + 3b.
- 2026-06-27: **3b DONE — was already shipped.** `reaper.ts` already implements the full failed-grab
  retry loop: blocklist the dead hash (gates.ts) + DownloadClient.deleteTorrents + reset monitored_item
  to 'wanted' for next-best re-search, with `reaper_max_grab_attempts` (default 3) parking at terminal
  'failed'. open-issues.md Partials line is stale. No code change.
- 2026-06-27: **3a DONE.** Extended `upgrade.ts`: added `revisionLevel(title)` (PROPER/REPACK/PROPERn/vN
  → revision int) and `PROPER_WINDOW_MS` (30d). The scan no longer hard-skips at cutoff; instead an
  at-cutoff item stays eligible for a same-or-better-tier release with a higher revision (a proper/repack
  fix) while within the proper window. Below-cutoff quality upgrades unchanged + untimed. Gated on the
  existing `upgrade_allowed` — no schema/UI change. tsc+eslint clean.
- 2026-06-27: Pair 3 verified (tsc 0, eslint 0). Next: Pair 4 = 3c + 3d.
- 2026-06-27: **3c DONE (health/backoff).** Added `indexers.consecutive_failures` + `disabled_until`
  columns (additive migration), `getSearchableIndexers()` (enabled AND not in backoff) and
  `recordIndexerResult(id, ok)` (reset on success; exponential backoff 10min→6h after 3 consecutive
  failures) in config.ts. `searchIndexer` records true/false from its HTTP outcome (200-empty = success,
  not failure); fan-out now queries getSearchableIndexers so a flaky tracker is skipped until backoff
  clears. Adapters (yts/eztv/nyaa) swallow errors so they record completion best-effort (not backoff
  targets) — documented. Per-indexer REQUEST-RATE limiting deferred (separate concern; noted). tsc 0.
- 2026-06-28: **3d DONE (import lists).** New `import-lists.ts` engine (Trakt items endpoint via
  `trakt-api-key` from `trakt_client_id` setting; generic RSS title→TMDB resolution) + 2 tables
  (`import_lists`, `import_list_items` dedup ledger) + 3 admin API routes (CRUD + per-list sync) + 6h
  cron (offset :20) + `ImportListsCard` on /admin/automation + `trakt_client_id` KNOWN key. **Auto-delete
  safe:** every add is a long-term monitored item via createItem (never quick); per-list ledger means a
  later library deletion never re-adds. tsc+eslint clean.
- 2026-06-28: **Section 3 COMPLETE.** Full `npm run build` exit 0 (53 routes; all 3 import-list routes
  registered). **ALL 8 backlog items done.** Changeset uncommitted, undeployed (layers on v0.10.2 +
  v0.11.0 working tree). Next housekeeping: fix stale open-issues.md lines (2d/3b already-shipped),
  CLAUDE.md doc for new features, then commit/deploy when ready.
