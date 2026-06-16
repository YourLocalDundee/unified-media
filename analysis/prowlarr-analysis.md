# Prowlarr — Feature Mining (indexer management layer)

Source: `sources/Prowlarr/` (C# engine `src/NzbDrone.Core/`, React frontend `frontend/src/`)
Prowlarr is the *arr indexer manager/proxy. Our **Independence Build Phase 1** (CLAUDE.md §14) replaced
its core with an MVP: an `indexers` table + a Torznab fan-out search (`src/lib/indexer/`). Known MVP gaps
(from `implementation-status.md`): *no category management UI, no per-indexer caching, search route is
unauthenticated*. Prowlarr is exactly the feature depth we'd grow into.

---

## 1. Cardigann YAML indexer engine — 500+ trackers ★★★ (high value, high effort)

`src/NzbDrone.Core/Indexers/Definitions/` holds **55 C#-coded indexers** plus the **Cardigann engine**
(`Definitions/Cardigann/` — `Cardigann.cs`, `CardigannParser.cs`, `CardigannRequestGenerator.cs`,
`CardigannDefinition.cs`, `Captcha.cs`). Cardigann parses community-maintained **YAML definitions** (login
flow, search request templates, CSS/XPath/JSON row selectors, category maps) so Prowlarr supports
**500+ private/public trackers** without per-tracker code. The YAML defs aren't vendored in this checkout —
Prowlarr fetches them at runtime from the `Prowlarr/Indexers` definitions repo (versioned via
`IndexerVersions/`).

- **Why it matters:** Our generic-Torznab-only layer works *only if each tracker exposes Torznab*. Most
  private trackers don't — they need scraping with login/cookies/captcha, which is precisely what Cardigann
  does. Adopting it would multiply our indexer support overnight.
- **Port assessment:** High effort — it's a small DSL interpreter (YAML → HTTP request chain → selector
  parsing → normalized results), plus login/cookie/FlareSolverr handling. **Recommended alternative:** keep
  **Prowlarr itself as a Torznab source** behind our existing `indexers` layer (point one "indexer" at
  Prowlarr's aggregate Torznab feed). That gets us all 500+ trackers with near-zero work and is the
  pragmatic call for a home server. Only port Cardigann if we want true Prowlarr independence — document it
  as a "someday" item, not a near-term grab. This is the one place where *not* replacing the upstream tool
  is the right answer.

## 2. IndexerProxies — FlareSolverr / SOCKS / HTTP ★★

`src/NzbDrone.Core/IndexerProxies/` — `FlareSolverr/`, `Socks4/`, `Socks5/`, `Http/`. **FlareSolverr** is
the important one: it solves Cloudflare's JS/Turnstile challenge so requests to Cloudflare-protected
trackers succeed. Many public/semi-private trackers sit behind Cloudflare; without this, requests get 403.
- **Port assessment:** Medium. FlareSolverr runs as its own container (one already common in *arr setups).
  We'd add a per-indexer "use FlareSolverr proxy" option that routes the search HTTP through the
  FlareSolverr endpoint and reuses the returned cookies. Self-contained, high reliability payoff.

## 3. Indexer health + backoff (auto-disable failing indexers) ★★

`src/NzbDrone.Core/Indexers/IndexerStatusService.cs` + `IndexerStatus.cs`. On repeated failures Prowlarr
**escalates a backoff** (disable for 5min → 15 → 1h → ... up to ~24h) and auto-re-enables, with health
notifications. We have a basic one-shot `last_health_check`/`health_status` (Phase 1). The proper version:
track consecutive failures, compute an `disabled_until` with exponential backoff, skip disabled indexers in
the fan-out, surface "indexer down" in admin. **Low-medium effort, real reliability win** — one flaky
tracker shouldn't slow or fail every search.

## 4. Per-indexer rate limiting ★★

`src/NzbDrone.Core/Indexers/IndexerLimitService.cs`. Enforces per-indexer **query and grab caps** per time
window (many private trackers ban for exceeding API limits). Our fan-out has a manual semaphore for
*concurrency* (Phase 1) but no per-indexer *rate* cap. A token-bucket per indexer (`queries/day`,
`grabs/day` from config) prevents bans. Low effort, protects accounts.

## 5. Category management + capabilities ★★ (closes a known MVP gap)

`IndexerCapabilities.cs`, `IndexerCapabilitiesCategories.cs`, `CategoryMapping.cs`, `IndexerCategory.cs`,
`NewznabStandardCategory.cs`. Prowlarr fetches each indexer's **capabilities** (supported categories,
search params) and maps tracker-specific categories to the **Newznab standard category tree** (2000=Movies,
5000=TV, ...). This is the fix for our logged gap *"no category management UI — add categories to a Torznab
URL manually."* Porting the standard category map + a per-indexer capability probe lets us search "TV only"
correctly across heterogeneous indexers and show a category picker.

## 6. Indexer stats ★

`src/NzbDrone.Core/IndexerStats/` + `frontend/src/History/`. Per-indexer **query count, grab count, avg
response time, success/failure rate, last-failure**. A nice admin surface (`/admin/indexers` already
exists, CLAUDE.md §14) to see which trackers actually deliver. Builds naturally on the `grab_history` /
`grab_results` tables we already have.

## 7. Indexer flags (freeleech / internal / etc.) ★

`Indexers/IndexerFlag.cs`. Releases carry flags (freeleech, internal, scene, ...). These feed the Custom
Format `IndexerFlagSpecification` from `sonarr-analysis.md` #3 (e.g. "prefer freeleech"). Cheap to thread
through once we parse them from Torznab attrs; pairs with the custom-format work.

## 8. Parameter-based / category-level manual search ★

`frontend/src/Search/`. Manual search scoped by category and arbitrary params, results pushable straight to
the download client. We have interactive grabs (`TorrentPickModal`); the net-new is **category-scoped
manual search in admin** for debugging "does this tracker even return results."

---

## Explicitly NOT applicable

- **Applications sync** (`src/NzbDrone.Core/Applications/` — push indexers to Sonarr/Radarr/Lidarr/Readarr/
  Mylar). This is *Prowlarr's whole reason to exist*: centralize indexers, sync them into the other apps.
  **We are the unified app** — our indexer layer and our automation live in one process, so there is nothing
  to sync to. Skip entirely.
- **Usenet/Newznab indexers** — we're torrent-only (UMT). The Newznab half (Headphones VIP, usenet
  retention) doesn't apply.

---

## Recommendation

The pragmatic path for a home server, in order:
1. **Keep Prowlarr as a Torznab source** behind our `indexers` table (#1 alternative) — instant access to
   500+ trackers for ~zero effort. Do this before considering Cardigann.
2. **Health + backoff** (#3) and **per-indexer rate limiting** (#4) — cheap reliability/account-safety.
3. **Standard category mapping + capabilities** (#5) — closes our logged MVP gap, enables correct
   type-scoped search.
4. **FlareSolverr proxy** (#2) — when a wanted tracker is Cloudflare-gated.
5. Indexer stats (#6) and flags (#7) as polish; flags pair with the custom-format work.

Porting the full **Cardigann engine** (#1) is the only true road to Prowlarr independence but is a large
DSL-interpreter effort — defer unless independence from Prowlarr becomes a hard requirement.
