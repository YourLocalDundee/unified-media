# Source Mining Log

Permanent record of all upstream reference material consulted while building the unified-frontend
native stack. This log is what made the `sources/` directory safe to delete. See
`docs/incomplete/feature-mining-summary.md` for the ranked "what to build next" view of the
still-open gaps.

**Log closed:** 2026-06-28 at v0.11.2.
**Sources purged with this log:** 7 directories, ~147 MB (all gitignored, local-only on minime).
**Sources already purged earlier:** jellyfin-web, seerr, VueTorrent/qbittorrent-webui, Flood,
knext, next-authjs-starterkit — their analysis notes survive in `docs/analysis/`.

---

## Already-purged sources (analysis notes are the only record)

These directories were removed in earlier sessions before this log was written. The analysis files
listed are the complete record.

| Source | Analysis file | Key items that shipped |
|---|---|---|
| jellyfin-web | `jellyfin-analysis.md` | Informed native media server design (HLS, subtitle extraction, ticks conversion 1s=10M ticks, playback profile negotiation). Jellyfin itself was replaced; we did not adopt @jellyfin/sdk. |
| seerr | `seerr-analysis.md` | Permission bitmask pattern, dual-mode auth (API-key + session cookie), `mediaInfo` embedding to avoid N+1, status dual-tracking (std + 4K). TypeORM subscriber pattern noted but not adopted (we use cron). |
| VueTorrent / qbittorrent-webui | `vuetorrent-analysis.md`, `qbittorrent-analysis.md` | `QbitProvider.ts` was the primary qBittorrent API reference. `DashboardProperty` enum, column set, torrent state values, Add-Torrent payload shape, maindata/sync incremental diff, cookie-name change (`SID` → `QBT_SID_{port}`). Full endpoint catalogue in `docs/features/torrent-system.md`. |
| Flood | `flood-analysis.md` | 21-column baseline (simpler than VueTorrent's 58), five-tab detail structure (Details/Files/Peers/Trackers/Mediainfo), two-view sizing (Expanded/Condensed). Multi-client adapter pattern noted but not adopted (qBittorrent-only for now). |
| knext | `knext-analysis.md` | Knex + better-sqlite3 config template, migration-directory convention. We use raw better-sqlite3, so the Knex query-builder pattern was left; the DB file layout was the value. |
| next-authjs-starterkit | `next-authjs-starterkit-analysis.md` | `changePassword` action pattern (verify → hash → update), Settings-page card layout (Security/Notifications/Privacy/Danger Zone). Auth.js/Prisma/PostgreSQL stack not adopted (we use our own SQLite sessions). |

---

## Sources purged with this log

### Sonarr (42 MB) + Radarr (40 MB)

**Analysis files:** `sonarr-analysis.md`, `radarr-analysis.md`

**What we took (all shipped by v0.12.0):**

| Item | Where it landed |
|---|---|
| Decision gate-chain with boolean specs + rejection reasons | `src/lib/automation/gates.ts` (§17) |
| Real Custom Formats (title_regex, resolution, source, codec, language, group, size, flag) | `src/lib/automation/quality.ts` (§17) |
| Interactive search with rejection-reason display | `/admin/automation` grab UI (§17) |
| Blocklist + auto-retry on failed grab (reaper) | `src/lib/automation/` (§17) |
| Notifications on request-available (Discord, ntfy backends) | v0.11.0 |
| Upgrade-until-cutoff + proper/repack replacement (MOVIES) | v0.11.0–v0.12.0 |
| Import Lists from Trakt + RSS | v0.12.0 |
| Wanted: Missing surface | ships with automation admin |

**What we deliberately left:**

| Item | Reason |
|---|---|
| C# backend engine | We're TypeScript-only; re-implemented relevant concepts natively |
| Usenet / Newznab | Torrent-only setup via UMT |
| Organize / rename-on-import | We scan paths, not import; file system managed externally |
| Host-only calendar event triggers | We use a cron-based approach |
| Tautulli / Plex / Emby integrations | Jellyfin-free and Plex-free by design |

**Remaining open gaps (see `feature-mining-summary.md` for ranking):**

- TV season-pack upgrade-until-cutoff (movie half shipped, TV deferred for multi-file complexity)
- Delay profiles (wait N minutes before grabbing so a better WEB-DL can appear)
- Cutoff-Unmet "Wanted" admin surface (buildable now that upgrade/cutoff exists)
- Auto Tagging (rule-based tags → drives delay profiles + release restrictions)
- Release Profiles (largely subsumed by Custom Formats; skip unless a gap appears)
- Radarr-only: Movie Collections ("follow a franchise" — auto-monitor TMDB collection)
- Radarr-only: Edition parsing (Director's Cut / IMAX / Extended), AKA/alternate titles, hardcoded-sub detection (HC/KORSUB flags)

---

### Prowlarr (30 MB)

**Analysis file:** `prowlarr-analysis.md`

**What we took:**

| Item | Where it landed |
|---|---|
| Generic Torznab proxy as primary indexer integration | `src/lib/indexer/` |
| Indexer health tracking + exponential backoff | v0.12.0 |
| Category management basics | `src/app/admin/indexers` |

**What we deliberately left:**

| Item | Reason |
|---|---|
| Cardigann YAML DSL engine (500+ private trackers) | Pragmatic: point our indexers table at a live Prowlarr Torznab feed for the same coverage at ~zero effort |
| Applications-sync (push indexers to Sonarr/Radarr) | Moot in a unified app |
| Usenet / Newznab | Torrent-only |

**Remaining open gaps:**

- Per-indexer rate limiting (token-bucket of queries/day + grabs/day per indexer)
- Standard category mapping + capabilities (probe per-indexer caps, map to Newznab tree)
- Indexer flags (freeleech, internal, scene from Torznab attrs → Custom Format input)
- Indexer stats page (query/grab counts, success rate, avg response time per indexer)
- FlareSolverr proxy (per-indexer opt-in when a tracker is Cloudflare-gated)

---

### watchparty (14 MB) + OpenLakeWatchParty (16 MB) + OpenWatchParty (2.3 MB) + Vynchronize (4.6 MB)

**Analysis files:** `watchparty-analysis.md`, `openlakewatchparty-analysis.md`,
`openwatchparty-analysis.md`, `vynchronize-analysis.md`

**What we took:**

| Item | Source(s) | Where it landed |
|---|---|---|
| Core sync protocol (NTP-style clock offset + extrapolation, drift-band correction via `playbackRate` nudge) | watchparty, OpenWatchParty | `src/lib/party/`, port 3002 WS server (§16) |
| Presence + text chat + emoji reactions | watchparty | Party Play v0.9.5 |
| Readiness gate (all-ready before play) | watchparty | Party Play v0.9.5 |
| Reconnection + grace window | watchparty | Party Play v0.9.5 |
| Shared queue + auto-advance | watchparty, Vynchronize | Party Play v0.10.0 |
| Sync constants validated (EMA alpha 0.4, PLAY_LEAD_MS, CONTROL_LEAD_MS) | OpenWatchParty | Same values in unified — independent corroboration |
| Shared control (no host-only model) | design decision over watchparty | Party Play; documented in §16 |

**What we deliberately left:**

| Item | Reason |
|---|---|
| Chrome extension content scripts | We own the player; no need to hijack third-party players |
| Rust session server | Sync runs in-process on Next.js node 3002 |
| Firebase / Stripe / Discord-bot layers | Cloud SaaS; we're self-hosted |
| Redis pub-sub sharding | Single-instance; `PartyStateStore` interface is the scale seam if needed |
| Virtual cloud browser (neko) / screen share | Architecture mismatch; we stream local library |
| External-source resolution (YouTube, magnet, arbitrary HLS URL) | Local library only |
| Host-only control model | Replaced by shared control (better for trusted-friend model) |
| Multi-source player abstraction (YouTube, Vimeo, Dailymotion) | We have one player |
| Host election / auto-host handoff on disconnect | Replaced by last-member-out logic |

**Remaining open gaps:**

- WebRTC voice + video chat (signaling trivial on existing WS; STUN free, coturn TURN container needed for symmetric-NAT)
- Creator-kick + control-lock (griefer safety valve; `host_user_id` already tracked)
- Tri-state synced/syncing/waiting badge in party panel (OpenWatchParty vocabulary)
- Per-member playhead offset map ("X is 3s behind") from our existing median data
- Roster avatars in party panel (reuse existing initials-avatars)
- Message-level reactions (distinct from floating emoji reactions)
- Subtitle-choice sharing (broadcast chosen subtitle URL so all members load same track)
- Loop toggle for current queue item
- "Queue a whole season" shortcut (fan out a series' episodes in S/E order)

---

## Deliberate non-grabs (across all sources)

| Pattern | Reason left |
|---|---|
| Prowlarr Cardigann YAML DSL | Point at Prowlarr's Torznab feed for 500+ trackers at zero port cost |
| Seerr's Plex/Jellyfin auth integration | We run our own SQLite sessions; no Plex, Jellyfin-free |
| Sonarr Release Profiles | Largely subsumed by shipped Custom Formats (title_regex / group / flag matchers) |
| OpenLakeWatchParty (most of it) | Hijacks third-party players; opposite of our model |
| `@jellyfin/sdk` client | Replaced Jellyfin entirely; SDK would be a dead dependency |
| Ticks arithmetic (1s = 10M ticks) | Jellyfin-free; we use seconds everywhere |
| i18n (Seerr: react-intl, 40+ locales) | Single-user / single-language deployment; not worth the surface |
| TypeORM + PostgreSQL | We use synchronous better-sqlite3 directly; no ORM overhead |

---

## Stack audit record

`stack-audit.md` covers the 2026-06-04 dependency + schema audit (38 env vars, 36 deps, 19 DB
tables, Dockerfile accuracy, SMTP no-op behavior). The live tracker for remaining audit items is
`docs/incomplete/open-issues.md`.

---

## Audit report record

`audit-2026-06-13-summary.md` + `audit-2026-06-13/` (21 detailed domain reports) cover the
21-agent read-only audit. All P0/P1 findings closed. P2 polish items tracked in
`docs/incomplete/BACKLOG.md`.

---

## Where the open gaps live

- Ranked feature candidates from this mining: `docs/incomplete/feature-mining-summary.md`
- All feature ideas (broader): `docs/incomplete/FEATURE-IDEAS.md`
- Active buildable backlog: `docs/incomplete/BACKLOG.md`
