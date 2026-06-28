# Session handoff — Subtitle on-demand search, OpenSubtitles VIP login, lint fix (2026-06-22)

App version **0.9.11**. Branch **main**. All changes committed and the production container
(`unified-frontend`) rebuilt + recreated and verified healthy.

---

## 1. What shipped — on-demand subtitle search + live `<track>` injection

Closes the Phase 4 gap. Background auto-download already served subtitles to the player at page-load; viewers
can now also fetch one **mid-playback** with no reload, via a "Search online…" entry in the player subtitle menu.

- `SubtitleSearchPanel` (`src/components/player/SubtitleSearchPanel.tsx`) — search overlay opened from the
  subtitle menu. The captions button now shows even when a title has **zero** tracks (gated on `subtitleApiBase`).
- Routes under the player's existing `subtitleApiBase` (`/api/media/subtitles`):
  - `GET …/search?mediaId=&language=&hi=` (`requireAuth`) — resolves the item's IMDB id **server-side**, queries
    OpenSubtitles (title-query fallback when no IMDB id), returns trimmed candidates. No download quota cost.
  - `POST …/grab` (`requireAuth` + `verifyOrigin`, 20/hr/user) — downloads the picked file, `upsertSubtitleWant`
    (heals an existing `wanted`/`skipped`/`failed` row via the `(item,lang,forced,hi)` UNIQUE index), writes the
    `.srt` next to the media with language/HI/forced markers, sets `status='downloaded'`, returns stable `wantId`
    + remaining quota.
  - `GET …/want/[wantId]` (`requireAuth`) — serves a downloaded sub by immutable `subtitle_wants.id` as WebVTT.
    The pre-existing `…/{id}/{index}` route keys by *positional* index (shifts when a sub is added → unsafe for a
    live-injected track), so session grabs use the stable id.
- `VideoPlayer` keeps session grabs in `extraTracks`, appended after embedded + downloaded tracks
  (`subtitleTracks = [...embedded, ...downloaded, ...extra]`) so existing indices/`activeSubIndex` never shift;
  `handleSubtitleAdded` selects the new track by its appended index.
- `srtToVtt` extracted to `src/lib/subtitle/vtt.ts`, shared by both serving routes. `<select>` added to the
  keyboard-shortcut guard so the language dropdown doesn't trigger player shortcuts.

## 2. Critical bug found + fixed — search returned zero results

`searchSubtitles` filtered candidates on `attributes.format`, which the OpenSubtitles **v3 search response leaves
`undefined` on every row**. So it silently discarded all matches — the entire subtitle feature (auto-download
included) was dead, masked only by the never-configured API key. Confirmed against the live API (145 results → 0
kept). Filter removed; format is normalised at download time via `sub_format: 'srt'`, and the written file is
content-validated.

## 3. OpenSubtitles VIP login — the code never logged in

The client only sent the static `Api-Key`, which draws on a low **anonymous ~100/day** bucket. The **VIP
1000/day** quota is only reached by logging in. `opensubtitles.ts` now does `POST /login` with
`OPENSUBTITLES_USERNAME` + `OPENSUBTITLES_PASSWORD`, caches the JWT (~24h, refreshed on expiry/401) and the
returned `base_url` (VIP users route to `vip-api.opensubtitles.com`), and sends it as `Authorization: Bearer` on
`/download` and `/infos/user`. Without creds it still runs at ~100/day (logs a warning).

- `GET /api/subtitle/account` (admin) returns the live `/infos/user` quota — use it to tell a login/auth failure
  apart from a subscription problem.
- `VIP_DAILY_DOWNLOAD_CEILING = 1000` documents the ceiling; the live number comes from `/infos/user`.

## 4. `next lint` fixed for Next 16

Next 16 removed the `next lint` command and there was **no ESLint config in the repo at all**, so linting was
fully broken. Added flat `app/eslint.config.mjs` (spreads `eslint-config-next`), switched the script to
`eslint .`, fixed 2 pre-existing unescaped-entity errors. `eslint-config-next@16` bundles `react-hooks` v6 whose
new strict rules (`set-state-in-effect`/`purity`/`immutability`/`refs`) fired ~50× on pre-existing working code;
those four are set to **`warn`** (documented in the config) so the migration doesn't hard-fail. `npm run lint`
now exits 0 (75 warnings, all pre-existing patterns).

## 5. Verified

- **Live OpenSubtitles API:** search (145→10 usable, proving the fix), download via Bearer token returned a valid
  124 KB SRT, VIP bucket decremented **1000 → 999** (`downloads_count: 1`). Login mints a token and routes to
  `vip-api.opensubtitles.com`. `/infos/user` reads `allowed_downloads: 1000, vip: true`.
- **Production:** image rebuilt (`compose-unified-frontend:latest`), container recreated, `health=healthy`,
  `/api/health` → `{status: ok, db: true, media: true}`. In-container login succeeds (creds reached the container
  via `env_file`), reads VIP 1000/day. Both schedulers started.
- `npm run type-check` and `npm run lint` exit 0; production `npm run build` compiles.

## 6. Config / env state

- Compose sources `unified-frontend` env from `env_file: /home/minijoe/dev/unified-frontend/app/.env.local`
  (the **same** file used in dev) plus 3 inline `environment:` overrides. The compose-level
  `/opt/docker/compose/.env` is **not** used by this service.
- `.env.local` now has real values for `OPENSUBTITLES_API_KEY`, `OPENSUBTITLES_USERNAME`,
  `OPENSUBTITLES_PASSWORD` (file is gitignored; not committed). `SUBTITLE_MEDIA_ROOT=/media` is set, so grabs
  write to disk.
- To redeploy after future env changes: recreate (no rebuild). After code changes: rebuild + recreate via
  `docker compose -f /opt/docker/compose/docker-compose.yml build unified-frontend && … up -d --force-recreate unified-frontend`.

## 7. Still left / follow-ups (none blocking)

- ~~**Episode subtitle matching.**~~ **DONE v0.10.2.** On-demand search now resolves the parent series row
  via `series_id` and searches by the **series** IMDB id + `season_number`/`episode_number`
  (`parent_imdb_id`/`season_number`/`episode_number`), falling back to the episode's own imdb, then a
  series-title query. See `analysis/bucket1-cleanup-session-2026-06-23.md`.
- **Lint cleanup (optional).** 75 pre-existing warnings remain (mostly `react-hooks` v6: `set-state-in-effect`,
  `refs`). Promote those four rules back to `error` in `eslint.config.mjs` and fix them when ready.
- **Auth scope of grab.** On-demand search/grab is open to any authenticated viewer (not admin-only), rate-limited
  20/hr/user, with the shared VIP quota surfaced. Revisit if quota contention becomes a problem.
- **Nightly auto-download** now actually works (was dead pre-fix). It runs 3:00 AM scan + 3:30 AM download and will
  start populating sidecar `.srt` files for the library going forward.
- Pre-existing backlog (unchanged, CLAUDE.md §13): notifications, Party voice chat, Jellyfin user linking, mobile
  PWA, bandwidth quotas, theme marketplace export/import, keyboard-shortcut auto-registry, audit-log CSV export,
  Transmission/Deluge download-client stubs.

Full detail in CHANGELOG `[0.9.11]` and CLAUDE.md §10b (on-demand subtitles) + §14 (env table).
