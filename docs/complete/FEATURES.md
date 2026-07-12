# Shipped Features

Index of what's built. Chronology is in `CHANGELOG.md`; live deep-dives are under `docs/player/` and
`docs/features/`.

## Build phases (original UX-aggregation app)

All five shipped.

| Phase | Goal | Acceptance |
| ----- | ---- | ---------- |
| 1 — Scaffolding | App runs in Docker, reachable at `media.minijoe.dev`, auth available | Loads + redirects to `/login` if unauthenticated |
| 2 — Jellyfin | Browse library, detail pages, play content | Browse Movies, open detail, play a file |
| 3 — Seerr | Search non-library content + submit requests | Search → not in library → request → appears in `/requests` |
| 4 — qBittorrent | View/manage the download queue | `/downloads` shows live progress; pause/resume works |
| 5 — Unified UX | One product, cross-service linking, responsive | Home dashboard combines all three sources |

## Independence Build (native replacement of external *arr + Jellyfin)

Seven shipped phases of native TypeScript services inside the monorepo. All tables added to
`unified.db` via `src/lib/db/migrations.ts`; background jobs start from `src/instrumentation.ts`.

| Phase | Replaces | lib path | Admin route |
| ----- | -------- | -------- | ----------- |
| 1 — Indexer Aggregation | Prowlarr | `src/lib/indexer/` | `/admin/indexers` |
| 2 — Download Automation | Sonarr + Radarr | `src/lib/automation/` | `/admin/automation` |
| 3 — Request Bridge | Seerr→*arr link | `src/lib/automation/bridge.ts` | `/admin/automation/bridge` |
| 4 — Subtitle Management | Bazarr | `src/lib/subtitle/` | `/admin/subtitles` |
| 5 — Media Server | Jellyfin | `src/lib/media-server/` | `/admin/media-server` |
| 6 — Browse/Watch wired to native media server | Jellyfin browse/watch UX | — | — |
| 7 — Native Request Management | Seerr requests | `src/lib/requests/` | `/admin/requests` |

**Admin nav order:** Overview → User Monitoring → User Management → Invites → Requests → Watch Activity
→ Audit Log → Server Status → Indexers → Automation → Request Bridge → Subtitles → Media Server →
Quality Profiles → Collections → Settings.

### Independence-build env vars

| Variable | Phase | Required | Purpose |
| -------- | ----- | -------- | ------- |
| `JELLYFIN_USER_ID` | 3 | Yes | Admin user UUID — `GET /Users/Me` → `Id` |
| `SEERR_WEBHOOK_SECRET` | 3 | Optional | Verifies `X-Webhook-Signature` on webhook POSTs |
| `OPENSUBTITLES_API_KEY` | 4 | Yes | OpenSubtitles v3 **static API key** from the Consumers page (not the JWT) |
| `OPENSUBTITLES_USERNAME` | 4 | For VIP | Account username — required to reach the VIP 1000/day quota |
| `OPENSUBTITLES_PASSWORD` | 4 | For VIP | Account password — the client mints its own JWT via `POST /login` |
| `SUBTITLE_LANGUAGES` | 4 | Optional | Comma-separated codes, default `en` |
| `SUBTITLE_MEDIA_ROOT` | 4 | Optional | Container path to media; required for `.srt` disk writes |
| `TMDB_ACCESS_TOKEN` | 5 | Yes | TMDB API v3 Bearer token |
| `MEDIA_ROOTS` | 5 | Yes | Colon-separated container paths to scan (e.g. `/media/movies:/media/tv`) |
| `TRANSCODE_CACHE` | 5 | Optional | HLS segment temp dir; default `/tmp/transcode` |

### Seerr webhook (Phase 3)

Seerr → Settings → Notifications → Webhook → URL
`https://unified.minijoe.dev/api/seerr/webhook`. Enable `Request Approved` + `Media Available`. Set
secret in both Seerr and `SEERR_WEBHOOK_SECRET`. `/api/seerr/webhook` receives `MEDIA_APPROVED`,
`REQUEST_APPROVED`, `MEDIA_AVAILABLE`.

## Major features (deep-dives linked)

| Feature | Version | Deep-dive |
| ------- | ------- | --------- |
| Video player — tools, quality, chrome/orientation, audio+subtitle tracks | v0.9.3–0.9.4 | `docs/player/` |
| Two-mode request system (Quick / Long-term) | v0.9.0+ | `docs/features/request-system.md` |
| Unified torrent client UI + 8-tab settings | v0.5.2+ / v0.9.10 | `docs/features/torrent-system.md` |
| **Watch party sync** (shared control, presence, chat, reactions) | v0.9.5 | `docs/features/party-play.md` |
| Party shared queue + auto-advance | v0.10.0 | `docs/features/party-play.md` |
| Party creator-kick + control-lock | v0.11.3 | `docs/features/party-play.md` |
| Party guest join (invite link, no account needed) | v0.11.4 | `docs/features/party-play.md` |
| Movie Collections (follow a TMDB franchise) | v0.11.5 | — |
| Delay profiles (hold releases N minutes before grab) | v0.11.5 | — |
| Per-indexer queries/day + grabs/day rate limiting | v0.11.3 | `docs/features/decision-engine.md` |
| **On-demand subtitle search** + live `<track>` injection | v0.9.11 | `docs/player/audio-subtitles.md` |
| Edition/HC flags + AKA alternate-title fallback | v0.11.3 | `docs/features/decision-engine.md` |
| Decision engine — hard gates + custom formats | v0.10.0 | `docs/features/decision-engine.md` |
| Season/arc grab pipeline (TMDB episode_groups, interactive picker) | v0.9.7–0.9.10 | CLAUDE.md §5 (browse) |
| Admin user monitoring + per-user detail | v0.5.3 | CLAUDE.md §5 |
| Profile/account settings (self-contained, no external identity provider) | v0.5.2+ | CLAUDE.md §11 |
| Downloads made admin-only (queue, torrent settings, dashboard widget, nav) | v0.11.6 | `docs/features/torrent-system.md` |
| Sequential download piece map (Files tab canvas) | v0.11.6 | `docs/features/torrent-system.md` |
| Create-torrent dialog (admin) | v0.11.6 | `docs/features/torrent-system.md` |
| Mobile PWA (manifest, service worker, offline shell) | v0.11.7 | `docs/features/pwa-notifications.md` |
| Party ready-check + 5s start countdown lobby | v0.11.8 | `docs/features/party-play.md` |
| Web Push notifications (VAPID) | v0.11.9 | `docs/features/pwa-notifications.md` |
| Sonarr/Radarr/Bazarr fully removed + Prowlarr-direct admin surface removed | v0.11.10 | CLAUDE.md §3 |
| Indexer capabilities probe (Torznab `t=caps` → category badges in `/admin/indexers`) | v0.11.10 | — |
| Standard category widening (additive-only) + `/admin/indexers/search` manual-search debug page | v0.11.10 | — |
| `indexers.name` unique-constraint fix (retroactive dedup migration) | v0.11.10 | CLAUDE.md §3 |
| Indexer expansion: Prowlarr 10 → 30 configured, `indexers` table 15 → 35 rows, zero signups | v0.11.10 | CLAUDE.md §3 |

## Done items pulled from the old §13 backlog

- **Watch party sync** — DONE (v0.9.5). Native party play; shared sync/presence/text chat/emoji
  reactions over a dedicated WebSocket server. Control shared by all members.
- **Subtitle search** — DONE (v0.9.11). Background auto-download (Phase 4) plus on-demand player search:
  subtitle menu "Search online…" → `GET /api/media/subtitles/search` (IMDB id resolved server-side) →
  pick → `POST /api/media/subtitles/grab` → live `<track>` served by stable `subtitle_wants.id`, no
  reload.
- **Admin tools** — per-user watch history, sessions, audit log, login history implemented at
  `/admin/users/[id]` (v0.5.3), plus bulk "Revoke all sessions" on `/admin/monitoring` and audit-log
  CSV export (`/api/admin/audit/export`).
- **Sonarr/Radarr status** — read-only monitoring status on media detail pages (shipped as part of the
  independence build).
