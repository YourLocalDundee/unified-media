# Sonarr — Feature Mining (the shared *arr automation engine)

Source: `sources/Sonarr/` (C# .NET Core engine `src/NzbDrone.Core/`, React frontend `frontend/src/`)
Sonarr ≈ Radarr architecturally; this doc documents the **shared automation engine** (applies to both
TV and movies). See `radarr-analysis.md` for the movie-only delta and `prowlarr-analysis.md` for indexers.

## Where we stand (Independence Build Phase 1–2, CLAUDE.md §14)

We already replaced the *core* at MVP level:
- `monitored_items`, `quality_profiles`, `quality_tiers`, `custom_formats`, `quality_profile_formats`,
  `grab_history`, `grab_results` tables (custom-format + quality-tier tables are **scaffolded but the
  scoring is simplistic**).
- `parser.ts` (`parseReleaseName`, `scoreRelease`), `grabber.ts` (`findBestRelease`), `scheduler.ts`
  (15-min grab cron + 30-min import check).
- Scoring = resolution bonus + source bonus + per-matched-condition bonus.

Sonarr's engine is what our `scoreRelease()` is a 5% slice of. The grabbable depth is large. Below, ranked.

---

## 1. The Decision Engine — a spec chain, not a score ★★★ highest value

`src/NzbDrone.Core/DecisionEngine/Specifications/` is the heart of *arr. Every candidate release runs
through an ordered list of **specifications**, each returning accept/reject **with a reason**. A release is
grabbed only if all specs accept. This is fundamentally better than our single additive score because it
(a) gives the user a *why-rejected* explanation and (b) separates hard gates from soft ranking.

Full spec list (`DecisionEngine/Specifications/`):

| Spec | What it gates | Have it? |
|---|---|---|
| `QualityAllowedByProfileSpecification` | quality is in the profile's allowed set | partial (we filter) |
| `CustomFormatAllowedByProfileSpecification` | min custom-format score met | ❌ |
| `UpgradeableSpecification` / `UpgradeAllowedSpecification` / `UpgradeDiskSpecification` | is this an upgrade over what we already have, and is upgrading allowed (cutoff) | ❌ **big gap** |
| `BlocklistSpecification` | release/hash not previously blocklisted (failed) | ❌ **big gap** |
| `QueueSpecification` | not already downloading the same/better | ❌ |
| `HistorySpecification` | not already grabbed recently | partial (dedup guard) |
| `AcceptableSizeSpecification` / `MaximumSizeSpecification` | size within quality min/max | ❌ |
| `MinimumAgeSpecification` / `RetentionSpecification` | usenet age/retention (N/A torrents) | n/a |
| `RepackSpecification` / `ProperSpecification` | grab a proper/repack to replace a bad release | ❌ |
| `ReleaseRestrictionsSpecification` | release-profile required/ignored terms | ❌ |
| `TorrentSeedingSpecification` | min seeders | ❌ (easy + high value) |
| `MonitoredEpisodeSpecification` | item is monitored | ✅ (we only grab wanted) |
| `DelaySpecification` (RssSync) | delay profile — wait for better quality before grabbing | ❌ |
| `NotSampleSpecification` / `RawDiskSpecification` | reject sample/ISO/raw-disc releases | ❌ (easy) |
| `SceneMappingSpecification` / `SameEpisodesSpecification` | scene numbering / multi-ep packs (TV) | TV-specific |
| `ProtocolSpecification` / `BlockedIndexerSpecification` | protocol allowed, indexer not in backoff | partial |

**Port plan:** refactor `scoreRelease()` into two stages — (1) a **gate chain** of boolean specs each
returning `{accepted, rejectionReason}`, run first; (2) the existing additive score only on survivors.
Persist rejection reasons so the interactive picker (we have `TorrentPickModal`) can show "why not grabbed."
The highest-value individual specs to add first: **min-seeders, reject-sample, max-size, blocklist,
upgrade/cutoff**.

## 2. Upgrade-until-cutoff + Proper/Repack ★★★

Sonarr keeps grabbing better releases until the profile's **cutoff** quality is met, then stops; and it
replaces a release with a **proper/repack** when one appears (`RepackSpecification`, `ProperSpecification`,
`UpgradableSpecification`). We currently grab once and mark `imported` — no upgrade path at all
(CLAUDE.md §14). This is the difference between "got a copy" and "got the copy you actually wanted." A
`cutoff` column on `quality_profiles` + an upgrade check in the grab cron is the MVP.

## 3. Custom Formats — a real scoring engine ★★★

`src/NzbDrone.Core/CustomFormats/Specifications/` — a custom format is a named set of conditions, each a
typed matcher, and the profile assigns a **score** per format. Matcher types:

`ReleaseTitleSpecification` (regex on title), `ReleaseGroupSpecification` (regex on group),
`SourceSpecification` (BluRay/WEB-DL/HDTV/...), `ResolutionSpecification`, `LanguageSpecification`,
`IndexerFlagSpecification` (freeleech, internal, etc.), `SizeSpecification` (min/max bytes),
`ReleaseTypeSpecification`. Each can be negated. Profile sums matched-format scores → total CF score, which
feeds the upgrade decision and a minimum-score gate.

We already have `custom_formats` + `quality_profile_formats` tables. **This is the feature those tables
were scaffolded for.** Porting the matcher set (regex/source/resolution/language/group/size, negatable,
scored) turns our placeholder tables into the real thing. This is the single most impactful upgrade to
download quality control.

## 4. Release Profiles — preferred / required / ignored terms ★★

`src/NzbDrone.Core/Profiles/Releases/` (`ReleaseProfile`, `TermMatcherService`, `TermMatchers/`). Simpler
than custom formats: per-profile lists of **must-contain**, **must-not-contain**, and **preferred** (scored)
terms, with optional Perl-regex (`PerlRegexFactory.cs`). Good lightweight first step before full custom
formats — e.g. "never grab x265 from group X", "prefer FLUX". Cheap to port.

## 5. Delay Profiles ★★

`src/NzbDrone.Core/Profiles/Delay/`. Wait N minutes after a release first appears before grabbing, to give
a better-quality/preferred release time to show up; can prefer one protocol (usenet vs torrent). For us
(torrent-only) the value is "don't grab the first 480p cam — wait an hour for the WEB-DL." A
`delay_minutes` column + a check against release first-seen time.

## 6. Import Lists — auto-add from external sources ★★ (discovery feature)

`src/NzbDrone.Core/ImportLists/` providers: **Trakt**, **Plex**, **AniList**, **MyAnimeList**, **Simkl**,
**RSS**, **Custom**, and another-Sonarr-instance. Periodically pulls a list and auto-adds (and optionally
auto-monitors/searches) items. For us this is a **"follow my Trakt watchlist / auto-add trending"** feature
that feeds `monitored_items` automatically — a natural companion to our two-mode request system
(CLAUDE.md §15). Trakt + a generic RSS list are the two worth doing. Note: ties into auto-delete safety
(don't auto-add then auto-delete user content — see audit A11-C1).

## 7. Notifications / "Connect" ★★

`src/NzbDrone.Core/Notifications/` — 30+ providers (Discord, Email, Ntfy, Telegram via Signal, Gotify,
Apprise, Pushover, Webhook, CustomScript, Plex/Emby/Jellyfin library-update, ...) firing on events:
**Grab, Download/Import, Upgrade, HealthIssue, ManualInteractionRequired, SeriesAdd/Delete**. We have a
backlog item for Web Push (CLAUDE.md §13). This is the generalized version: an event bus + pluggable
notifier with a settings UI. **Discord webhook + ntfy** are the two highest-value, lowest-effort targets
for a home server — "your request is ready" to your phone. Maps onto our request availability poller.

## 8. Interactive search with rejection reasons ★★

`frontend/src/InteractiveSearch/` + the decision specs produce a release list annotated with *why each was
or wasn't auto-grabbed* (size, seeders, format, blocklisted...). We have `TorrentPickModal` (interactive
grabs, CLAUDE.md §15) but no rejection annotations. Once the spec chain (#1) returns reasons, surfacing
them in the picker is nearly free and hugely improves "why didn't this download" debugging.

## 9. Blocklist + failed-download handling ★★

`src/NzbDrone.Core/Blocklisting/` + `Download/.../FailedDownloadService`. When a grab fails (stalls, wrong
content, removed), Sonarr blocklists that release and **automatically tries the next best**. We mark a grab
and walk away. A `blocklist` table + "on failure, re-run grab excluding blocklisted hashes" closes the loop
on our grab cron and is a real reliability win.

## 10. Wanted: Missing + Cutoff-Unmet ★

`frontend/src/Wanted/`. Two lists: **Missing** (monitored, not downloaded) and **Cutoff Unmet** (have it,
but below cutoff quality — upgrade candidates). We have monitored items but no cutoff concept yet (needs #2).
Good admin surface once upgrades exist.

## 11. Auto Tagging ★

`src/NzbDrone.Core/AutoTagging/` — rule-based automatic tags (by genre, year, network, ...). Tags then drive
delay profiles, release restrictions, etc. Lower priority; useful once we have several profiles.

## 12. Organizer / naming tokens — only if we ever do our own import ★

`src/NzbDrone.Core/Organizer/` — the `{Series Title} - S{season:00}E{episode:00} - {Quality Full}` token
renamer. We **scan existing files** (media-server Phase 5) rather than importing+renaming, so this only
matters if we ever take over the import/rename step from the download client. Defer.

## 13. Calendar ★

`frontend/src/Calendar/` — upcoming/aired episodes on a calendar. We have TMDB data; a calendar of upcoming
episodes for monitored series is a nice user-facing surface (iCal feed export is a bonus).

---

## Lower-priority / NOT for us

- **Usenet/SAB/NZBGet** (`Download/Clients`) — we're torrent-only via UMT. Skip the usenet half (retention,
  minimum-age specs are usenet-only).
- **Health checks / Backup / Housekeeping / Analytics / Update** — operational scaffolding; we have our own
  health route and Docker volume backups. Low value.
- **MetadataSource (TheTVDB/Skyhook)** — we use TMDB already (media-server Phase 5).
- **Extras/MediaCover/metadata-for-Kodi** — irrelevant; we serve our own UI.
- **Scene mapping / anime absolute numbering** (`DataAugmentation/Scene`) — only matters for anime/scene
  release naming; defer unless the library has anime that parses wrong.

---

## Recommendation (priority order for our automation v2)

1. **Refactor scoring → gate-chain + reasons** (#1) and add the cheap high-value gates: **min-seeders,
   reject-sample, max-size**.
2. **Real Custom Formats** (#3) — activate the tables we already built.
3. **Upgrade-until-cutoff + proper/repack** (#2).
4. **Blocklist + auto-retry on failure** (#9).
5. **Notifications (Discord/ntfy) on request-available** (#7) — best user-facing payoff.
6. Then: Import Lists (Trakt) (#6), Release/Delay profiles (#4/#5), Calendar (#13).

Items 1–4 turn the MVP grabber into something that reliably gets the *right* release and recovers from
failures; item 5 is the visible win for users.
