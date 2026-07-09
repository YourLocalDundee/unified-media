# Backlog Build-out — closed out (2026-06-27 → 2026-07-01)

Two sessions worked through `open-issues.md` sections 2–3 (deferred partials) and a follow-on feature
batch, two items at a time with a tsc+eslint+build verify after each pair. **All items below shipped**;
this file is now history — see `docs/complete/FEATURES.md` and `CHANGELOG.md` for the authoritative
record. Kept only for the non-obvious facts that aren't captured elsewhere.

## What shipped

Transmission + Deluge download clients, theme marketplace (export/import/share-string), keyboard-
shortcut reference (`PLAYER_SHORTCUTS` registry → `/settings/shortcuts`), proper/repack upgrades,
indexer health/backoff, import lists (Trakt/RSS), per-indexer request-rate limiting, adapter-level
backoff, bulk session revoke, download-to-browse linking, edition/AKA/HC-sub parsing, and (later,
separate sessions) Movie Collections, delay profiles, per-indexer daily rate limiting, Party creator-
kick/control-lock, and Party guest join. Full detail on each is in `docs/complete/FEATURES.md` and the
relevant `docs/features/*.md` deep-dive.

## Non-obvious facts worth keeping

- **Two items turned out to already be shipped, not net-new:** admin audit-log CSV export
  (`api/admin/audit/export/route.ts` + the wired Export button already existed) and auto-retry on
  failed grab (`reaper.ts` already did blocklist+remove+reset-to-wanted+max-attempts). The stale
  `open-issues.md` lines claiming otherwise were fixed. If a "backlog" item looks suspiciously exactly
  like existing behavior, grep before building — this has now happened twice.
- **Theme marketplace was scaffolded-but-unrendered**, not absent: `ThemeSection.tsx` had the
  export/import handlers and state already written, with the Upload/Download icons imported but never
  used in JSX. The actual gap was wiring, plus hardening the codec (`btoa` throws on unicode, wasn't
  URL-safe, didn't sanitize import).
- **`vi.hoisted()` gotcha:** the first Vitest test in the repo needed `vi.hoisted()` because a
  `vi.mock()` factory can't see a plain module-scope `const` — it needs to reference a shared mock
  function declared via `vi.hoisted()` instead.
