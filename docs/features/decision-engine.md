# Decision Engine — Gate-Chain + Custom Formats (v0.10.0)

Two-stage release evaluation in the grabber, mirroring Sonarr/Radarr: **hard gates** decide what is
grabbable at all, then a **soft score** ranks what survives. The auto-pick path never grabs a gated
release; the interactive admin picker still lists gated releases (with reasons) and can override-grab
them.

## Hard gates (`src/lib/automation/gates.ts`)

`evaluateGates(result, config, blocked)` returns the list of reasons a release failed (empty = passed):

| Gate | Reason | Rule |
| ---- | ------ | ---- |
| Blocklist | `blocklisted` | `info_hash` is in `grab_blocklist` |
| Seed floor | `dead` | `seeders < gate_min_seeders` (default 1) |
| Sample | `sample` | title matches a whole-token `sample` |
| Size cap | `oversize` | `size > gate_max_size_*_gb` (movie default 100, tv 200; 0 disables) |

Thresholds are `app_settings` keys read each search (no redeploy): `gate_min_seeders`,
`gate_max_size_movie_gb`, `gate_max_size_tv_gb`, **editable in the UI at `/admin/automation` → "Grab
Gates"** (v0.10.2; via `GET`/`PUT /api/admin/settings`; 0 on a max-size disables that cap).
`partitionByGates(results, type)` splits scope-matched results into `passing` + `gatesByKey`;
`findBestRelease(passing, …)` auto-picks from the passing pool only. The pack finders
(`findSeasonPack`/`findArcPack`/`findCoveringPacks`) are gate-aware too.

**Blocklist.** `grab_blocklist` (keyed by lowercased `info_hash`) is auto-populated by the metadata
**reaper** (a dead stuck torrent whose indexer-claimed seeders never materialised is blocklisted so the
cron won't re-grab it) and managed by admins via `GET/POST/DELETE /api/automation/blocklist`
(requireAdmin + verifyOrigin), **surfaced in the UI at `/admin/automation` → "Blocklist"** (v0.10.2;
list + remove/unblock + manual block-by-hash form).

**Rejection reasons surface in the UI.** `ScoredCandidate.gates` is persisted in `grab_results`;
`/api/torrent-search` returns per-result `gates`; `SeasonGrabControl` renders them as amber badges
("why didn't this download") while keeping the row grab-able (it's the override surface). A search that
gates out every candidate records `SkipReason` `'gated'` (or `'no_seeders'` when the only failure was
the seed floor).

## Real custom formats (`src/lib/automation/quality.ts`)

`CustomFormatSpec.type` now covers
`title_regex | resolution | source | codec | language | release_group | size | flag`:

- **language** — ISO 639-1 parsed from the title (`meta.language`).
- **release_group** — exact scene-group match (`meta.group`).
- **size** — GB range `min-max` / `min-` / `-max` (needs the release size, threaded through
  `scoreWithProfile(title, profileId, sizeBytes)` from `autoPickScore`).
- **flag** — a named release flag tested against the raw release title via `FLAG_PATTERNS`.
  Known keys (exported as `CUSTOM_FORMAT_FLAGS`):

  | Key | What it matches |
  |-----|-----------------|
  | `proper` / `repack` / `internal` / `real` | Revision/re-release markers |
  | `extended` / `uncut` / `imax` | Edition variants (original set) |
  | `directors_cut` | `Director's Cut`, `Directors.Cut`, etc. (dot-separator-aware) |
  | `theatrical` | `Theatrical`, `Theatrical.Cut`, `Theatrical.Edition` |
  | `remastered` | `Remastered`, `Remaster`, `Re-mastered` |
  | `unrated` | `Unrated`, `Unrated.Cut` |
  | `hc` | `HC`, `HCSUB`, `KORSUB`, `RUSUB`, `HardSub`, `HardCoded` — burned-in subs |
  | `remux` / `hybrid` | Encode type |
  | `hdr` / `hdr10plus` / `dv` | HDR flavour |
  | `atmos` | Dolby Atmos audio |

  Unknown keys fall back to a word-boundary match of the value itself so ad-hoc tags still work.

Custom formats are scored within `autoPickScore` (`scoreWithProfile(...).totalScore`) and are
created/assigned with per-profile scores on the existing `/admin/quality-profiles` page (the
`CustomFormatBuilder` offers the new spec types with per-type value hints). The
`quality_profile_formats` score table and the matcher were already scaffolded; this activates the
fuller matcher.

## AKA / alternate-title fallback search

When the primary title search (`searchAllIndexers({ q: item.title, ... })`) returns zero results,
the grabber tries each stored **alternative title** as a sequential fallback query, stopping at the
first non-empty result. This covers foreign-primary-title items (e.g. primary TMDB title "Bølgen")
where scene releases use a different name (e.g. "The Wave").

**How titles are stored:** after `createItem()`, the admin-approve route (`fireImmediateGrab`) and
the auto-approve path both call `getAlternativeTitles(tmdbId, type)` (TMDB
`/movie/{id}/alternative_titles` or `/tv/{id}/alternative_titles`), cap the result at 20 unique
titles, and persist them via `storeAltTitles(itemId, titles)` on `monitored_items.alternative_titles`
(JSON `string[]`). The store happens before the grab fires so the immediate-grab path already has the
titles available.

**Grabber fallback** (`grabber.ts` `grabItem`): at most 5 alternative titles are tried in order; the
first that produces any indexer results becomes the candidate pool. Scope filtering (year-pin +
episode/season matching) is applied to the alternative-title results exactly as it is to primary
results, so the AKA fallback cannot pull in unrelated content.

## Related: grab scoring (the soft score, v0.9.10 Bug 2)

The soft score sits downstream of the gates and **de-prioritizes, never hard-rejects**.
`scoreReleaseSoft` + `autoPickScore` (`grabber.ts`) rank by quality (profile conditions +
resolution/source bonuses; a missed **required** condition is a −100 penalty, not removal) + custom
format + **seed weighting** (`+min(seeders,100)`; a 0-seed/dead release gets −1000 so it sinks below any
live release) + language preference (−100 on mismatch). Ordering: healthy-correct-quality >
healthy-wrong-quality > dead-correct-quality. `findBestRelease` refuses to auto-grab a 0-seed release
(recorded `no_seeders`); the interactive list still shows + grabs it.
