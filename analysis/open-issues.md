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

- **Heavy work synchronous in request handlers** (A10-08, A15-H1/H2, A19-H1) — `media/scan`,
  subtitle download, embedded-subtitle ffmpeg run in-request. Needs a job queue + concurrency caps.
  (The only remaining P1; D3/F3/A20-01 are closed.)

## OPEN — P2 / systemic

- **No-op settings** (A08-H1..H4) — **flagged, needs a product decision (wire vs remove), not guessed.**
  Per-item recommendations: Display prefs → wire `unified-display-prefs` into resume/recently-added/
  library page size, or remove; Playback (9 of 11) → wire each into `VideoPlayer`, or remove; Torrent
  Interface tab → wire remaining prefs into the live downloads page, or hide; Advanced Jellyfin-URL
  override → remove (no reader, security-sensitive to wire); `store/index.ts` `browsePageSize` slice →
  remove (0 readers); sidebar collapse/labels → seed zustand from pref on mount; `S`/`N` shortcuts →
  bind in `VideoPlayer` or fix the docs table.
- **a11y remainder** (A16) — modal focus-trap/restore/Escape gaps and light-theme `bg-zinc-950`
  contrast on ~17 pages are still open (the `error/not-found/loading` boundaries + aria-live are done).

## OPEN — Medium / Low remainder

- **A7-10** two parallel qBit SID caches — left separate by design (different lifetimes/credential
  sourcing); the `clearSession`-on-failed-retry fix (A7-11) was applied to both. Unify only if revisited.
- Remaining per-domain Medium/Low items in `audit-2026-06-13/NN-*.md` not explicitly tasked above
  (triage from the files as needed). A7-04/A6-18/A7-07/A7-12/A7-13 are now resolved.

---

## Partials / genuinely in progress

- **Download clients** — Transmission + Deluge are still unimplemented (now fail loudly at selection,
  A7-02 done). Implementing them is a feature, not a defect.
- **Subtitle search** — server-side auto-download done; player-side `<track>` injection from IMDB id not.
- **Theme marketplace** — custom themes work; export/import/share-string not.
- **Keyboard shortcut reference** — static table at `/settings/shortcuts`; auto-generation from a
  registry not.
- **Admin audit-log CSV export** — not done (watch-activity export exists).
- **Independence build is at MVP** — the deeper automation depth (decision gate-chain + rejection
  reasons, real custom formats, upgrade/cutoff, blocklist, notifications, import lists) is documented
  as grabbable in `sonarr/radarr/prowlarr-analysis.md` + `feature-mining-summary.md`, not built.

## Feature backlog (CLAUDE.md §13 + feature-mining)

Not defects. Top candidates from the feature mining: Party Play shared queue, voice chat, decision
gate-chain, real custom formats, Discord/ntfy notifications. See `feature-mining-summary.md`.

---

## Doc drift to fix

- `FEATURE_STATUS.md` lists "Watch party sync [ ] Not done" — it is done and audited (CLAUDE.md §16,
  `PARTY_PLAY_AUDIT.md` all-remediated).
- Version drift: `package.json` 0.9.2, CLAUDE.md says 0.9.5/0.9.6, `stack-audit.md` noted 0.4.0.
- `CLAUDE.md` "Known Issues" and `audit-2026-06-13/06`+`07` still describe items this session closed
  (updated in those files with a remediation banner).
