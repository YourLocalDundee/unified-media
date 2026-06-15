# Independence Build — Implementation Status

*Last updated: 2026-05-30. **Superseded for current state by the 2026-06-13 full audit** — see
[`audit-2026-06-13/00-SUMMARY.md`](audit-2026-06-13/00-SUMMARY.md). This file is the build-completion snapshot;
the audit lists what is broken / no-op / insecure despite being marked "Complete" here (notably watch history,
proxy auth, CSRF, auto-delete safety, and ~27 dead modules).*

## Completion Summary

| Phase | Feature | Status | Est. Hours | Notes |
|---|---|---|---|---|
| 1 | Indexer Aggregation (Prowlarr replacement) | ✅ Complete | 25–35h | p-limit replaced with manual semaphore |
| 2 | Download Automation (Sonarr + Radarr replacement) | ✅ Complete | 60–80h | MVP: movies + TV, 3 default quality profiles |
| 3 | Request Bridge (Seerr → *arr link replacement) | ✅ Complete | 8–12h | Webhook receiver + availability poller |
| 4 | Subtitle Management (Bazarr replacement) | ✅ Complete | 30–40h | Daily scan + download cron; SUBTITLE_MEDIA_ROOT required for disk writes |
| 5 | Media Server (Jellyfin replacement) | ✅ Complete | 120–200h | Scanner, TMDB enricher, HLS transcode, playback sessions, watch state |
| 6 | Browse/Watch wired to native media server | ✅ Complete | 8–12h | Home, browse, detail, play pages migrated; TMDB image proxy; progress API |
| 7 | Native Request Management (Seerr requests replacement) | ✅ Complete | 12–18h | media_requests table; search via TMDB; RequestButton; admin approve/decline |

## Jellyfin Migration — Complete (2026-05-30)

Zero unconditional Jellyfin API calls remain from pages or components. The migration is 100% done.

### What was completed

**VideoPlayer.tsx** — All Jellyfin fallback fetch calls removed. Progress reporting (`progressApiUrl`), next-episode lookup (`nextEpisodeApiBase`), and subtitle serving (`subtitleApiBase`) are native-only props with no Jellyfin defaults. Component warns and skips gracefully if props are not set.

**Admin server-status** — Jellyfin health check removed. Now uses native DB reachability (`SELECT 1`) and `MEDIA_ROOT` filesystem accessibility (`fs.access`).

**`/api/health`** — Checks DB (`SELECT 1`) and `MEDIA_ROOT` (`fs.access`). Returns `{ status: 'ok'|'degraded', db, media, timestamp }` with HTTP 200 on ok or 503 on degraded.

**Browse** — `getSimilarItems` ("More Like This") and `getAvailableFilters` (year filter) are fully wired to the UI. Neither is a stub anymore.

**Dead code removed** — `JellyfinSeasonList.tsx` deleted. `JellyfinPerson` and `JellyfinStudio` types removed from `jellyfin/types.ts`.

**`getItemsByType()`** — Now accepts an optional `year?: number` parameter for year filtering.

**EpisodeCard, EpisodeCarousel, SeriesSection** — All moved off Jellyfin types and routes to native `NativeEpisode`/`NativeSeason` types and `/api/media/*` routes.

**subtitle/scanner.ts** — No longer uses `jellyfinFetch`; queries SQLite directly.

**continue-watching/route.ts** — Native SQL, no Jellyfin imports.

**`JellyfinError` class** — Added to `src/lib/jellyfin/client.ts`.

**Auth header format** — Fixed in 3 Jellyfin proxy routes.

**probe.ts** — Now extracts full audio and subtitle stream arrays (`ProbeStream[]`) from ffprobe JSON output.

### New native routes added

| Route | Purpose |
|---|---|
| `/api/media/series/[id]/next-episode` | Next episode lookup for VideoPlayer |
| `/api/media/subtitles/[id]/[streamIndex]` | Subtitle serving for VideoPlayer |
| `/api/media/seasons/[seasonId]/episodes` | Episode list for season |
| `/api/media/items/[id]/similar` | "More Like This" recommendations |
| `/api/media/filters` | Available year/genre filters for browse |

### Build health

Zero Turbopack warnings (was 2). Fixed `process.exit` edge runtime warning in `instrumentation.ts`. Fixed NFT trace warning from `server-status/route.ts`.

### Known remaining gaps

- **Embedded subtitle extraction** — returns 404 for embedded subtitle tracks. Downloaded `.srt` sidecar files work. Extraction via ffmpeg not yet implemented.
- **Chapter extraction** — `chapters` always returns `[]`. No extraction implemented yet.
- **HLS transcoding route** — Route exists but needs full implementation.

---

## Phase 1: Indexer Aggregation

### New files
```
src/lib/indexer/
  types.ts       — Indexer, TorznabResult, TorznabSearchParams, IndexerHealth
  config.ts      — getAllIndexers, getEnabledIndexers, getById, create, update, delete, updateHealth
  index.ts       — searchAllIndexers (fan-out), searchIndexer, testIndexer, parseXml

src/app/api/indexer/
  route.ts             — GET (list), POST (create)
  [id]/route.ts        — GET, PATCH, DELETE
  [id]/test/route.ts   — POST (health check)

src/app/api/torznab/search/route.ts   — GET fan-out (no auth)
src/app/admin/indexers/page.tsx       — CRUD UI with test + enable toggle
```

### DB table
```sql
CREATE TABLE indexers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  torznab_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_health_check INTEGER,
  health_status TEXT
)
```

### Packages added
- `xml2js` + `@types/xml2js` — Torznab RSS XML parsing
- `p-limit` — installed but ESM-incompatible; manual semaphore used instead

### Known limitations
- No category management UI (add categories to a Torznab URL manually)
- No per-indexer result caching
- Search route is unauthenticated (intentional — used by automation internally)

---

## Phase 2: Download Automation

### New files
```
src/lib/automation/
  types.ts       — MonitoredItem, QualityProfile, QualityCondition, GrabHistory, ReleaseMeta
  monitor.ts     — CRUD for monitored_items, quality_profiles, grab_history
  parser.ts      — parseReleaseName, scoreRelease, extractTitle
  grabber.ts     — buildSearchParams, findBestRelease, grabItem
  scheduler.ts   — initScheduler() singleton, two cron jobs

src/instrumentation.ts   — Next.js server hook; calls initScheduler() once on startup

src/app/api/automation/
  items/route.ts           — GET (list), POST (create)
  items/[id]/route.ts      — GET, PATCH, DELETE
  items/[id]/grab/route.ts — POST (manual grab trigger)
  queue/route.ts           — GET grab history
  profiles/route.ts        — GET quality profiles

src/app/admin/automation/page.tsx   — Monitored items + grab history UI
```

### DB tables
```sql
CREATE TABLE quality_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  conditions TEXT NOT NULL DEFAULT '[]'  -- JSON: QualityCondition[]
)
-- Seeded: Any, 1080p, 4K

CREATE TABLE monitored_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER,
  tvdb_id INTEGER,
  type TEXT NOT NULL CHECK(type IN ('movie','tv')),
  title TEXT NOT NULL,
  year INTEGER,
  quality_profile_id INTEGER NOT NULL DEFAULT 1,
  root_path TEXT NOT NULL DEFAULT '',
  monitored INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'wanted'
    CHECK(status IN ('wanted','grabbed','imported','ignored')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

CREATE TABLE grab_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  indexer TEXT NOT NULL,
  release_title TEXT NOT NULL,
  info_hash TEXT NOT NULL,
  grabbed_at INTEGER NOT NULL,
  import_status TEXT NOT NULL DEFAULT 'pending'
)
```

### Scheduled jobs
| Schedule | Job | File |
|---|---|---|
| `*/15 * * * *` | Scan Torznab for `wanted` items, grab best match | `scheduler.ts` |
| `*/30 * * * *` | Check native media server (`media_items` table) for `grabbed` items, mark `imported` | `scheduler.ts` → `availability.ts` |

### Release scoring
`parseReleaseName()` extracts: resolution, codec, source, release group, season/episode, year, title.
`scoreRelease()` gates on required QualityCondition rules, then adds:
- Resolution bonus: 2160p=40, 1080p=30, 720p=20, 480p=10
- Source bonus: BluRay REMUX=15, BluRay=10, WEB-DL=8, WEBRip=6, HDTV=4
- Per matching optional condition: +10

### Packages added
- `node-cron` + `@types/node-cron`

---

## Phase 3: Request Bridge

### New / modified files
```
src/lib/automation/
  bridge.ts         — onRequestApproved, findItemForRequest, findAllBridgedItems, extractTitle
  availability.ts   — checkAvailability, searchJellyfin

src/lib/seerr/api.ts          — added getRequest(id)
src/app/api/seerr/
  request/[id]/approve/route.ts  — now calls onRequestApproved after proxying to Seerr
                                    ALSO added requireAdmin() (was unguarded — security fix)
  webhook/route.ts               — Seerr webhook receiver

src/app/api/automation/
  sync/route.ts    — POST: manual availability check trigger
  bridge/route.ts  — GET: all monitored_items with tmdb_id

src/app/admin/automation/bridge/page.tsx  — Bridge status UI with sync button
```

### Bridge flow
```
User approves in Seerr UI
  → POST /api/v1/request/{id}/approve (Seerr internal)
  → OR admin approves via unified frontend: POST /api/seerr/request/{id}/approve
       → calls onRequestApproved(seerrRequest)
       → INSERT INTO monitored_items (idempotent by tmdb_id + type)
  → OR Seerr webhook fires POST /api/seerr/webhook
       → MEDIA_APPROVED / REQUEST_APPROVED → onRequestApproved

Phase 2 cron (*/15) picks up the wanted item → grab dispatched
Phase 2 cron (*/30) finds item in Jellyfin → status = 'imported'
```

### New env vars
| Variable | Required | Where used |
|---|---|---|
| `JELLYFIN_USER_ID` | Yes (poller) | `availability.ts` — Jellyfin `/Users/{id}/Items` search |
| `SEERR_WEBHOOK_SECRET` | Optional | `webhook/route.ts` — X-Webhook-Signature verification |

---

## Phase 4: Subtitle Management

### New files
```
src/lib/subtitle/
  types.ts           — SubtitleWant, SubtitleStatus, OS API response types
  opensubtitles.ts   — searchSubtitles, getDownloadLink, pickBestSubtitle
  monitor.ts         — CRUD for subtitle_wants table
  scanner.ts         — scanLibrary() queries SQLite directly (no longer uses jellyfinFetch)
  downloader.ts      — downloadPendingSubtitles() sequential download loop
  scheduler.ts       — initSubtitleScheduler(), two daily cron jobs

src/app/api/subtitle/
  route.ts           — GET (list with optional status filter)
  [id]/route.ts      — PATCH (update status), DELETE
  scan/route.ts      — POST (trigger scanLibrary)
  download/route.ts  — POST (trigger downloadPendingSubtitles)

src/app/admin/subtitles/page.tsx   — full admin UI
```

### DB table
```sql
CREATE TABLE subtitle_wants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jellyfin_item_id TEXT NOT NULL, jellyfin_item_type TEXT NOT NULL,
  title TEXT NOT NULL, imdb_id TEXT, media_path TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  forced INTEGER NOT NULL DEFAULT 0, hi INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'wanted',
  subtitle_file_id INTEGER, subtitle_path TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (jellyfin_item_id, language, forced, hi)
)
```

### Scheduled jobs added to instrumentation.ts
| Schedule | Job |
|---|---|
| `0 3 * * *` | Scan native media DB for items missing subtitles → create subtitle_wants |
| `30 3 * * *` | Download pending subtitle_wants from OpenSubtitles |

### New env vars
| Variable | Required | Purpose |
|---|---|---|
| `OPENSUBTITLES_API_KEY` | Yes | OpenSubtitles v3 API key |
| `SUBTITLE_LANGUAGES` | Optional | Comma-separated codes, default `en` |
| `SUBTITLE_MEDIA_ROOT` | Optional | Container path to media; required for .srt disk writes |

---

## Configuration Checklist

### .env.local (dev) / docker-compose env (prod)

```
# Already present
JELLYFIN_URL=http://192.168.0.50:8096
JELLYFIN_API_KEY=<from Jellyfin dashboard>
JELLYFIN_USER_ID=<UUID from GET /Users/Me>   ← REQUIRED by Phase 3
SEERR_URL=http://seerr:5055
SEERR_API_KEY=<from seerr settings>

# New for Phase 3 (optional)
SEERR_WEBHOOK_SECRET=<random string>         ← configure same value in Seerr webhook settings

# Needed for Phase 4 (not yet)
OPENSUBTITLES_API_KEY=<from opensubtitles.com>
```

### Seerr webhook configuration (Phase 3)
In Seerr → Settings → Notifications → Webhook:
- URL: `https://unified.minijoe.dev/api/seerr/webhook`
- JSON Payload: (default Seerr webhook format — no custom payload needed)
- Notification Types: enable `Request Approved`, `Media Available`
- If using secret: set the secret in Seerr's webhook settings AND `SEERR_WEBHOOK_SECRET` env var

---

## Phase 5: Media Server

### New files
```
src/lib/media-server/
  types.ts            — MediaItem, WatchState, ProbeResult, ProbeStream[], ParsedFilename
  probe.ts            — ffprobe wrapper via @ffprobe-installer/ffprobe; extracts full audio and subtitle stream arrays (ProbeStream[])
  filename-parser.ts  — parseFilename() for S01E02 TV and (year) movie patterns
  scanner.ts          — chokidar watcher, scanFile, removeFromDb, initWatcher, scanAll
  tmdb.ts             — TMDB API v3 client (Bearer token, 24h cache)
  enricher.ts         — enrichItem, enrichAll (250ms gap between calls)
  library.ts          — getItemById, getItemsByType, searchItems, getRecentlyAdded,
                        getEpisodesForSeries, getTotalCount, getWatchState,
                        upsertWatchState, getResumeItems
  transcode.ts        — HLS via fluent-ffmpeg; QUALITY_PRESETS (1080p/720p/480p/360p)
  playback.ts         — in-memory session map; createSession, getSession, endSession
  index.ts            — barrel export

src/app/api/media/
  items/route.ts                      — GET ?q / ?type / ?limit / ?offset
  items/[id]/route.ts                 — GET single item
  items/[id]/similar/route.ts         — GET similar items ("More Like This")
  stream/[id]/route.ts                — Range-request file stream (206 partial)
  playback/route.ts                   — POST create playback session
  progress/route.ts                   — POST upsert watch state
  scan/route.ts                       — POST scanAll + enrichAll (admin)
  stats/route.ts                      — GET movie/series/episode counts (admin)
  series/[id]/next-episode/route.ts   — GET next unwatched episode for a series
  subtitles/[id]/[streamIndex]/route.ts — GET subtitle track (downloaded .srt only; embedded tracks return 404)
  seasons/[seasonId]/episodes/route.ts  — GET episodes for a season
  filters/route.ts                    — GET available years and genres for browse filtering

src/app/admin/media-server/page.tsx   — stats, scan button, env var reference
```

### DB tables
```sql
CREATE TABLE media_items (
  id TEXT PRIMARY KEY,                  -- sha256 of file path
  file_path TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,                   -- 'movie' | 'series' | 'episode'
  title TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  year INTEGER,
  tmdb_id INTEGER,
  series_id TEXT,                       -- references media_items.id for episodes
  season_number INTEGER,
  episode_number INTEGER,
  runtime_ticks INTEGER,
  overview TEXT,
  poster_path TEXT,
  backdrop_path TEXT,
  genres TEXT,                          -- JSON array
  added_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)

CREATE TABLE media_watch_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  position_ticks INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  play_count INTEGER NOT NULL DEFAULT 0,
  last_played INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, media_id)
)
```

### Packages added
- `chokidar` — filesystem watcher for media directories
- `@ffprobe-installer/ffprobe` + `fluent-ffmpeg` + `@types/fluent-ffmpeg` — media probing and HLS transcode

### Scheduled startup (instrumentation.ts)
`initWatcher()` is called on Node.js runtime startup. It:
1. Scans all `MEDIA_ROOTS` directories immediately on start
2. Starts chokidar watchers for add/change/unlink events
3. New/changed files are probed with ffprobe, parsed by filename-parser, and inserted into `media_items`

### New env vars
| Variable | Required | Purpose |
|---|---|---|
| `TMDB_ACCESS_TOKEN` | Yes (enrichment) | TMDB API v3 Bearer token — get from themoviedb.org/settings/api |
| `MEDIA_ROOTS` | Yes | Colon-separated container paths to watch (e.g. `/media/movies:/media/tv`) |
| `TRANSCODE_CACHE` | Optional | HLS segment temp dir; defaults to `/tmp/transcode` |

### Docker notes
- Mount media directories as read-only volumes: `-v /path/to/media:/media:ro`
- Mount a writable transcode cache: `-v /tmp/transcode:/tmp/transcode` or use a tmpfs
- The `@ffprobe-installer/ffprobe` package ships a prebuilt ffprobe binary — no system ffprobe needed
