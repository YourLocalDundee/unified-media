# Radarr — Feature Mining (movie-specific delta over Sonarr)

Source: `sources/Radarr/`
Radarr shares ~90% of its engine with Sonarr. **Everything in `sonarr-analysis.md` (Decision Engine,
Custom Formats, Release/Delay profiles, Import Lists, Notifications, Blocklist, Upgrade/cutoff, Wanted,
Calendar) applies identically here** — the namespaces match (`src/NzbDrone.Core/{DecisionEngine,
CustomFormats,Profiles,ImportLists,Notifications,Blocklisting,...}`). This doc only covers what is
**movie-specific** and not in the Sonarr writeup.

---

## Movie-only grabbable features

### 1. Collections ★★
`src/NzbDrone.Core/Movies/Collections/` + `frontend/src/Collection/`. A TMDB **collection** (e.g. "The
Lord of the Rings Collection", MCU) can be monitored as a unit: adding the collection auto-adds/monitors
every movie in it, including future entries as TMDB adds them. For us this is a compelling user feature:
**"follow this franchise" → auto-request every film in the collection**. TMDB already exposes
`belongs_to_collection` on movie detail and a `/collection/{id}` endpoint, and we already have a TMDB client
(media-server Phase 5). Maps cleanly onto `monitored_items` + the two-mode request system (CLAUDE.md §15).
No equivalent exists for TV (series are the unit), so this is genuinely Radarr-only.

### 2. Discover / Recommendations ★
`frontend/src/DiscoverMovie/` + `ImportLists/RadarrList`, `TMDb`, `StevenLu`. Radarr surfaces
recommendations ("because you have X"), popular/trending lists, and curated lists (StevenLu = a popular
auto-curated movies list) as a discovery tab that can one-click-add. Our `/browse` is already TMDB
discovery (CLAUDE.md §5), so the net-new is the **curated/recommendation list providers** as Import-List
sources (StevenLu, IMDb lists, TMDb lists) feeding auto-add. Overlaps with Sonarr Import Lists #6 — note
the movie-specific providers here: **TMDb** (list/popular/person), **IMDb** (list), **StevenLu**,
**Trakt** (popular/box-office/watchlist), **RadarrList**.

### 3. Movie-specific release parsing ★★
`src/NzbDrone.Core/Parser/` (movie path). Three parsing nuances our `parseReleaseName()` doesn't handle,
called out explicitly in Radarr's README:
- **Editions** — "Director's Cut", "Extended", "IMAX", "Theatrical", "Remastered". These should be a
  matchable property (and a Custom Format condition) so a user can prefer the Extended cut. We currently
  drop this entirely.
- **AKA / alternative titles** — releases named with a movie's alternate/foreign title. Radarr matches
  against TMDB `alternative_titles`. Without this, foreign or AKA-named releases fail to match.
- **Hardcoded subs detection** — flag releases with burned-in subtitles (`HC`, `KORSUB`, ...) so they can
  be de-prioritized or rejected. Cheap regex; a clear quality win.

These three are small additions to the parser and slot straight into the Custom Format matcher engine from
`sonarr-analysis.md` #3 (Edition → a `ReleaseTitle`/property matcher; HC → a reject format).

### 4. "Only one copy per movie" model — design note, not a feature
Radarr's README: *"only one type of a given movie is supported"* (want both 4K and 1080p → two instances).
We should make a conscious choice here. Our `media_items` is keyed by file path, so we *could* hold multiple
qualities of one movie, but our `monitored_items`/request model assumes one wanted copy. Matches Radarr's
simplification — fine to keep, just document it when we build upgrade/cutoff (Sonarr #2).

---

## Shared with Sonarr (do not re-port — see `sonarr-analysis.md`)

Decision-engine spec chain, Custom Formats scoring engine, Release/Delay profiles, Blocklist + failed-grab
retry, Upgrade-until-cutoff + proper/repack, Import Lists framework, Notifications/Connect, Interactive
search with rejection reasons, Auto Tagging, Organizer/naming tokens, Wanted (Missing/Cutoff-Unmet),
Calendar. All identical; build once, use for both movies and TV.

---

## Recommendation

Build the shared engine improvements once (per `sonarr-analysis.md`). On top of that, the movie-only
priorities are: **(1) Collections "follow a franchise"** (best user feature, unique to movies), and
**(2) edition / AKA / hardcoded-sub parsing** (folds into the Custom Format engine). Discovery list
providers (StevenLu/IMDb/TMDb/Trakt) are part of the Import-Lists work, not separate.
