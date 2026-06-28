# Unified Media v0.10.2 — Master Audit Progress Tracker

Source: consolidated master document (full security/correctness audit of all 113 API routes +
every subsystem, performance/strain sweep, independence/dependency + mining analysis).
Started working: 2026-06-24.

Path mapping (doc paths are relative to the Next.js app root):
- doc `app/api/...`  ->  `app/src/app/api/...`
- doc `lib/...`      ->  `app/src/lib/...`
- App root: `/home/minijoe/dev/unified-frontend/app` (Next.js 16 / React 19, better-sqlite3 WAL, VAAPI HLS, Intel N100)

Severity key: [S] security · [D] data/engine correctness · [F] functional · [P] perf/strain · [H] hygiene.

Status legend: TODO · WIP · DONE · SKIP (with reason) · VERIFY (needs runtime check).

---

## Execution checklist (Section F order)

| # | Item | Sev | Status | Notes |
|---|------|-----|--------|-------|
| 1  | A-1 Seerr webhook fail-closed when secret unset | S-MED | DONE | unset secret now returns 403 early; removed skip-verification branch |
| 2  | A-2 Subtitle language path-traversal validation | S-MED | DONE | normalizeSubtitleLang() in monitor.ts; grab route validates input (400 on bad lang); downloader writeSrtFile guards want.language. tsc clean |
| 3  | A-3 Gate *arr/qbit writes to admin (or delete *arr proxies) | S-MED | DONE | qbit POST->requireAdmin (GET stays auth); prowlarr whole proxy->requireAdmin + CSRF on writes; deleted dead sonarr/radarr/bazarr proxies (0 callers). Full `next build` clean |
| 4  | B-1 HLS segment caching + streamed reads | P | DONE | serveManifest (no-store, buffered) vs serveSegment (immutable cache, streamed via Readable.toWeb). tsc clean |
| 5  | B-2 Global ffmpeg pLimit | P | DONE | transcodeLimit=pLimit(TRANSCODE_MAX_CONCURRENT, default 2); slot held for process lifetime via started-deferred so ensureHls polling unchanged. tsc+eslint clean |
| 6  | B-3 SQLite performance pragmas | P | DONE | synchronous=NORMAL, busy_timeout=5000, cache_size=-16000, mmap_size=256MB added in lib/db/index.ts; verified applied at runtime |
| 7  | A-5 Revoke sessions on suspend/demote/reset | S-LOW | DONE | suspend + PATCH(demote/suspend/force-pw) + admin reset-password now DELETE sessions WHERE user_id. tsc+eslint clean |
| 8  | C-2 Delete dead playback-session path | D | DONE | deleted api/media/playback route + createSession/getSession/endSession/buildDirectUrl/PlaybackSession/sessions Map from playback.ts. Kept getNativePlaybackData. Full build clean |
| 9  | D-1 Delete orphaned jellyfin routes + client | indep | DONE | deleted all 11 api/jellyfin/* routes + all 4 lib/jellyfin/* files (closed island, 0 external importers). Full build clean |
| 10 | D-2 Resilient *arr badge on browse/[id] | indep | DONE | getArrStatus already try/catch'd; added AbortSignal.timeout(3000) so a black-holed *arr can't stall the page render. tsc+eslint clean |
| 11 | C-1 Email comparison normalization | D | DONE | all 5 LOWER(email) sites -> bare `email = ?` with lowercased bind (profile/email, forgot-password, verify-email, register x2). Username compares left as-is (out of scope). tsc+eslint clean |
| 12a | A-4 Image proxy path hardening | S-LOW | DONE | IMAGE_PATH_RE `^/[A-Za-z0-9_-]+\.(jpg\|jpeg\|png\|webp\|svg\|avif)$i` — single segment, structurally no `..`/`@`/ws/extra path |
| 12b | C-3 admin/settings PUT key allowlist | D | DONE | KNOWN_SETTING_KEYS in lib/settings; PUT rejects unknown keys with 400 |
| 12c | C-5 Prune login_attempts + audit_log | H | DONE | pruneAuthTables() on hourly cron: login_attempts<24h, audit_log<90d |
| 12d | C-4 auto-delete dir-cleanup MEDIA_ROOTS boundary | D-LOW | DONE | rmdir of dir+parent gated on isPrunableDir (strictly inside a MEDIA_ROOTS root) |
| 13 | (optional) move react-query-devtools + @types/nodemailer to devDeps | H | N/A | already in devDependencies (both). Brief assumed they were in deps. No change. Note: ReactQueryDevtools is imported unconditionally in providers.tsx — fine for the full-`npm ci` Dockerfile, would break `--omit=dev` |

Other flagged-only (no action unless decided): C-6 reset-password slice(0,16) PK (negligible);
auth/profile/email no re-verification (intentional behind Authentik).

D-3 (download-client independence: move importer's two raw qbitFetch calls behind DownloadClient
interface) is NOT scheduled — only needed if swapping qBittorrent. Recorded, not actioned.

---

## Item detail

### 1. A-1 [S-MED] Seerr webhook fail-closed
File: `app/src/app/api/seerr/webhook/route.ts`
When `SEERR_WEBHOOK_SECRET` unset, signature check skipped and any POST processed (queues grabs to
arbitrary tmdbId). HMAC + timingSafeEqual themselves correct.
Fix: if no secret configured, reject (403/501) instead of processing.

### 2. A-2 [S-MED] Subtitle language path-traversal
Files: `app/src/app/api/media/subtitles/grab/route.ts`, `app/src/lib/subtitle/downloader.ts`
Filename `${base}.${want.language}.srt`; language from request body with only .trim(). `../` escapes
media dir on write.
Fix: validate language against `^[a-z]{2,3}$` (ISO 639) or normalizeLang() before storing in
subtitle_wants or using in any path. Apply everywhere subtitle_wants.language reaches a path.

### 3. A-3 [S-MED] *arr/qbit proxies allow destructive writes to any authed user
Files: `app/src/app/api/qbit/[...path]/route.ts`, `app/src/app/api/{sonarr,radarr,prowlarr,bazarr}/[...path]/route.ts`
Write verbs gated by requireAuth (any user) not requireAdmin. Horizontal priv gap (CSRF present so
not cross-site). *arr proxies nearly dead (only settings/media references) -> deleting cleaner. qbit
live (downloads page) -> just gate write verbs to admin.
Fix: require admin for write verbs; consider deleting *arr proxies.

### 4. B-1 [P] HLS segments buffered to RAM + served no-store
File: `app/src/app/api/media/hls/[id]/[...slug]/route.ts`
serveFile() fs.readFile() whole .ts + Cache-Control no-store. With -hls_list_size 0 every scrub-back
re-fetches immutable segments through auth + full buffer read.
Fix: serve seg*.ts with `public, max-age=31536000, immutable`; keep no-store only on master.m3u8;
stream segment (ReadStream) instead of buffering.

### 5. B-2 [P] No global ffmpeg concurrency cap
File: `app/src/lib/media-server/transcode.ts`
Dedup per-mediaId:aN only; total concurrent ffmpeg unbounded. Competing VAAPI encodes stall N100.
Fix: module-level pLimit(1) (try 1, maybe 2) around spawnFfmpeg. p-limit already imported.

### 6. B-3 [P] SQLite missing performance pragmas
File: `app/src/lib/db/index.ts` (only WAL + foreign_keys today)
Fix: add synchronous=NORMAL, busy_timeout=5000, cache_size=-16000, mmap_size=268435456.

### 7. A-5 [S-LOW] Credential/privilege changes don't kill sessions
Files: `app/src/app/api/admin/users/[id]/suspend/route.ts`, `.../[id]/route.ts` (PATCH),
`.../[id]/reset-password/route.ts`
Suspend, role-demote, admin reset don't delete target's sessions. Mitigated by getSession is_active
JOIN but already-delivered state stays usable.
Fix: on suspend + role-demote (+ admin reset) also `DELETE FROM sessions WHERE user_id = ?`.

### 8. C-2 [D] Dead HLS playback-session path
Files: `app/src/lib/media-server/playback.ts` (createSession/getSession/endSession + sessions Map),
`app/src/app/api/media/playback/route.ts`
createSession(method='hls') builds URL getItemById(sessionId) always 404s. Zero client callers; Map
never endSession'd.
Fix: delete both. Keep getNativePlaybackData (live path).

### 9. D-1 Delete orphaned jellyfin routes + client
The 6 `app/src/app/api/jellyfin/*` routes import lib/jellyfin, orphaned legacy, native equivalents
exist. Fix: delete `app/src/app/api/jellyfin/*` and `app/src/lib/jellyfin/*`.

### 10. D-2 Resilient *arr badge on browse/[id]
File: `app/src/app/browse/[id]/page.tsx` calls radarrFetch/sonarrFetch for cosmetic
Monitored/Not-monitored badge; throws if *arr down.
Fix: wrap in try/catch (hide badge on failure) or remove the badge.

### 11. C-1 [D] Email comparison convention mixed
register/route.ts uses `LOWER(email) = LOWER(?)`; others use `LOWER(email) = ?`. LOWER() on column
defeats UNIQUE index.
Fix: one convention — compare bare column to lowercased bind (`WHERE email = ?`, pass .toLowerCase()).

### 12a. A-4 [S-LOW] Image proxy path under-validated
File: `app/src/app/api/media/image/route.ts`
path only checked for leading `/`. No guard vs .. / @ / whitespace / trailing ?#.
Fix: allow only `^/[\w./-]+\.(jpg|png|webp|svg)$`, or reject .. @ whitespace http.

### 12b. C-3 [D] admin/settings PUT no key allowlist
Files: `app/src/app/api/admin/settings/route.ts`, `app/src/lib/settings/index.ts`
Any (string,string) persisted via INSERT OR REPLACE.
Fix: validate keys against known-keys allowlist; reject unknown.

### 12c. C-5 [H] login_attempts + audit_log grow unbounded
Fix: in hourly cron or startup, DELETE FROM login_attempts WHERE created_at < now-24h and
DELETE FROM audit_log WHERE created_at < now-RETENTION.

### 12d. C-4 [D-LOW] auto-delete dir-cleanup can walk toward MEDIA_ROOT
File: `app/src/lib/automation/auto-delete.ts`
Fix: stop upward rmdir cleanup at the MEDIA_ROOTS boundary.

### 13. (optional) devDependencies move
Move @tanstack/react-query-devtools + @types/nodemailer to devDependencies.

---

## Progress log

- 2026-06-24: Located codebase, mapped paths, created this tracker. Starting item 1.
- 2026-06-24: Item 1 (A-1) DONE. `api/seerr/webhook/route.ts`: when SEERR_WEBHOOK_SECRET unset,
  reject with 403 instead of processing. Was: logged a warning and fell through to queue grabs.
- 2026-06-24: Item 2 (A-2) DONE. Added `normalizeSubtitleLang()` to `lib/subtitle/monitor.ts`
  (regex ^[a-z]{2,3}$, returns null on invalid). grab/route.ts validates body.language (400 on
  invalid, separate from missing mediaId/fileId). downloader.ts writeSrtFile guards want.language
  defensively before building the .srt path. Scanner langs come from trusted SUBTITLE_LANGUAGES env.
  tsc --noEmit clean.
- 2026-06-24: Item 3 (A-3) DONE. qbit `[...path]` POST now requireAdmin (writes = add/delete/
  setPreferences/speed-limits on shared infra); GET stays requireAuth so non-admins can still view
  the downloads queue. prowlarr `[...path]` whole proxy -> requireAdmin (its only caller is the admin
  media-settings page, and indexer GET can leak credentials) + verifyOrigin on non-GET/HEAD. Deleted
  sonarr/radarr/bazarr `[...path]` proxies entirely (git rm) — zero client callers; server-side *arr
  access uses lib/{sonarr,radarr,bazarr} directly; browse/[id] badge uses radarrFetch/sonarrFetch libs
  (D-2), not these routes. Verified with full `next build` (exit 0; route list no longer lists them).
  Follow-up noted: downloads page nav link still shows for non-admins (mutations now 403/redirect);
  hiding it for non-admins is a UX decision, out of scope for this security item.
- 2026-06-24: Item 4 (B-1) DONE. `api/media/hls/[id]/[...slug]/route.ts`: split serveFile into
  serveManifest (master.m3u8 stays no-cache/no-store, buffered — it grows with -hls_list_size 0) and
  serveSegment (seg*.ts now `public, max-age=31536000, immutable` + Content-Length, streamed from disk
  via createReadStream + Readable.toWeb instead of fs.readFile buffering the whole .ts). `public` is
  safe: segments are per-media-item, identical for every authed user. tsc clean.
- 2026-06-24: Item 5 (B-2) DONE. `lib/media-server/transcode.ts`: added module-level
  `transcodeLimit = pLimit(MAX_CONCURRENT_TRANSCODES)` (default 2, env TRANSCODE_MAX_CONCURRENT).
  KEY NUANCE: spawnFfmpeg returns after the process *starts* (so ensureHls keeps polling for the
  manifest), but a transcode runs linearly to the end of the file, so a naive pLimit wrap would only
  serialize the spawn moment and NOT cap concurrent encodes. Fix holds the pLimit slot for the whole
  process lifetime (slot promise resolves on ffmpeg close/error) while surfacing a `started` deferred
  so ensureHls is unchanged. A 3rd concurrent transcode queues until a slot frees. tsc + eslint clean.
- 2026-06-24: Item 6 (B-3) DONE. `lib/db/index.ts` getDb(): added synchronous=NORMAL,
  busy_timeout=5000, cache_size=-16000 (~16MB), mmap_size=268435456 (256MB) after the existing
  WAL + foreign_keys pragmas. Verified all four apply via a throwaway better-sqlite3 open.
- 2026-06-24: Item 7 (A-5) DONE. Three admin routes now revoke target sessions: suspend/route.ts
  (DELETE sessions after is_active=0, fixed stale comment); [id]/route.ts PATCH (revoke when demoted
  OR is_active->0 OR force_pw_change->1); reset-password/route.ts (revoke after temp-pw set so the
  forced change can't be ridden past). Acting admin is self-target-guarded on suspend/demote already.
  tsc + eslint clean.
- 2026-06-24: Item 8 (C-2) DONE. Deleted `api/media/playback/route.ts` (git rm) and removed the dead
  createSession/getSession/endSession/buildDirectUrl + PlaybackSession interface + sessions Map from
  `lib/media-server/playback.ts`. Verified the only caller of those exports was the deleted route (the
  other getSession/createSession hits are the unrelated auth DAL). play/[id] + watch/[id] import only
  getNativePlaybackData (kept). Full `next build` clean; route list no longer lists /api/media/playback.
- 2026-06-24: Item 9 (D-1) DONE. Deleted all 11 `app/api/jellyfin/*` routes and all 4 `lib/jellyfin/*`
  files (api.ts, client.ts, playback.ts, types.ts). Doc estimated "6 routes" but there were 11; verified
  every @/lib/jellyfin import was confined to those routes or lib/jellyfin itself — zero pages/components/
  hooks/other-lib consume them, and no client fetches /api/jellyfin/*. instrumentation.ts still emits a
  Jellyfin-env-var warning (env-var-name strings only, not a code dep) — left as-is, out of scope. Full
  `next build` clean.
- 2026-06-24: Item 10 (D-2) DONE. browse/[id] getArrStatus() was ALREADY try/catch->null (a thrown
  *arr error already hid the badge — the doc's "page errors" was already mitigated). Added the missing
  piece for true severability: AbortSignal.timeout(3000) on the radarrFetch/sonarrFetch badge calls so a
  reachable-but-unresponsive *arr container can't hang the server-component render (clients have no
  timeout). Scoped to the badge; shared radarr/sonarr clients (used by admin settings/media) unchanged.
- 2026-06-24: Item 11 (C-1) DONE. Converted all 5 email comparisons from LOWER(email) to bare
  `email = ?` (uses the UNIQUE index) with a guaranteed-lowercase bind: profile/email (trimmed),
  forgot-password (email), verify-email (pending.email), register users-check (now binds
  email.toLowerCase()), register pending_registrations DELETE. register's users-check was the lone
  LOWER(?) site that diverged from the convention. Username comparisons (LOWER(username)) left
  untouched — out of C-1 scope. tsc + eslint clean.
- 2026-06-24: Item 12 (final hardening batch) DONE — all four:
  - A-4: `api/media/image/route.ts` now validates `path` against IMAGE_PATH_RE
    `^/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|svg|avif)$/i` (single `/<hash>.<ext>` segment). The single
    pre-extension dot means `..` can't appear; rejects extra path segments / @ / whitespace / trailing ?#.
  - C-3: added `KNOWN_SETTING_KEYS` to `lib/settings/index.ts` (auto_approve, gate_min_seeders,
    gate_max_size_movie_gb, gate_max_size_tv_gb, reaper_metadata_minutes). admin/settings PUT now
    rejects any unknown key with 400 instead of silently persisting it.
  - C-5: `lib/automation/scheduler.ts` hourly cron now calls pruneAuthTables() —
    DELETE login_attempts < now-24h, DELETE audit_log < now-90d (logs row counts when >0).
  - C-4: `lib/automation/auto-delete.ts` parses MEDIA_ROOTS; empty-dir cleanup rmdir of both dir and
    parent is gated on isPrunableDir() (resolved path strictly inside a configured root), so the upward
    walk can never remove a media root or anything at/above the boundary.
  Final full `next build` clean (exit 0). tsc + eslint clean across all touched files.

## ALL 12 EXECUTION-ORDER ITEMS COMPLETE (2026-06-24).
Not actioned (recorded decisions, not gaps): C-6 reset-password slice(0,16) PK (negligible);
auth/profile/email no re-verification (intentional behind Authentik); D-3 importer raw qbitFetch
behind DownloadClient interface (only needed if swapping qBittorrent); item 13 devDependencies move
(optional hygiene — see below). Section E feature backlog is build-when-ready, not part of this pass.
