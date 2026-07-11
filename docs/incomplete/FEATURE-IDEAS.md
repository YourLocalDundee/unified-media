# New Feature Ideas (proposed)

Suggestions beyond the existing `BACKLOG.md`, grounded in what the codebase already has. Each notes
why it fits and the rough surface it'd touch. Not committed — triage into `BACKLOG.md` what you want.

## Builds directly on existing infrastructure (low new-surface)

- **Web Push for "request available" (finish the loop).** The Seerr webhook (`/api/seerr/webhook`)
  already receives `MEDIA_AVAILABLE`, and the two-mode request system already tracks per-user requests.
  Adding VAPID Web Push (already in `BACKLOG`) is the natural completion — the event source and the
  user-to-request mapping both exist; only the subscription store + the push send are new.
- **Party Play presence in the rest of the app.** The party WS already broadcasts member presence. A
  small "N friends watching X" strip on the home dashboard (read-only, from the live `PartyStateStore`)
  reuses existing state for a social surface at near-zero backend cost.
- **Subtitle offset / resync control in the player.** The player already owns a single 0-based timeline
  and renders `<track>`s; a per-track ±ms offset slider (client-only, applied to cue timing) is a small
  player-tool addition in the style of the existing `MediaToolsPanel` tabs, and a very common real-world
  need (out-of-sync subs).
- **"Up next" for solo playback (not just parties).** The shared-queue model (`watch_party_queue`,
  auto-advance) is proven; a single-user queue/autoplay-next for episodes reuses the same advance logic
  without the WS layer — binge support for people watching alone.
- **Audio-only / "cast to" mode.** The HLS audio-track switching already exists; a lightweight
  audio-only playback mode (screen off, lock-screen controls via the Media Session API) is mostly
  wiring `navigator.mediaSession` to the existing player state. Good for the "phone as remote" primary
  use case already in the design.

## Leverages the native independence-build stack

- **Calendar / upcoming view.** Sonarr/Radarr integration already exists for monitoring status; a
  unified "coming soon / recently aired" calendar (episodes airing this week, movies releasing) is a
  read-only aggregation over data the *arr layer already exposes.
- **Indexer health dashboard.** The decision engine already tracks gates, blocklist, and the metadata
  reaper. Surfacing per-indexer success rate / last-error / backoff state as an admin panel turns
  existing signals into an operational view (the handoff's "indexer health/backoff" item, made visible).
- **Quality-profile "test against a release name."** The custom-format matcher
  (`title_regex|resolution|source|codec|language|release_group|size|flag`) already scores releases. A
  small admin tool that takes a pasted release title and shows the gate result + score breakdown would
  make profile tuning empirical instead of guesswork — and it's read-only over existing scoring code.
- **Storage / disk-usage view.** The media server scans `MEDIA_ROOTS` and tracks `media_items` with
  `file_path`. A per-library size breakdown + free-space gauge (qBt already reports free space on
  `/transfer/info`) is a useful admin surface assembled from data already in hand.

## Quality-of-life / polish

- **Recommendations row ("because you watched X").** TMDB already powers discovery; a "similar to your
  recent watches" row on home cross-references watch history (which exists once the audit's
  watch-history wiring lands) against TMDB similar/recommendations — modest, high-visibility.
- **Bulk request from a TMDB list / collection.** Movie Collections is already in `BACKLOG`; extending
  it to "import a TMDB list and request all" reuses the request pipeline and the season-scope modal.
- **Per-user theme + the theme marketplace.** `ThemeToggle.tsx` already stores custom themes in
  localStorage; the marketplace export/import is in `BACKLOG`. Pairing it with server-side per-user
  theme persistence (a `users` column) makes themes follow the account across devices.
- **Watch-history-driven "continue watching" accuracy.** Once `watch_events` is wired (audit P2), a
  proper cross-device continue-watching that merges `media_watch_state` is a correctness win the audit
  already points at.

## From the automation gap analysis (Sonarr / Radarr / Prowlarr mining)

These came out of the source purge; ranked detail is in `feature-mining-summary.md`.

- ~~**Movie Collections ("follow a franchise").**~~ **SHIPPED v0.11.5** — `/admin/collections`.
- ~~**Delay profiles.**~~ **SHIPPED v0.11.5** — `delay_minutes` on quality profiles.
- **TV season-pack upgrade-until-cutoff.** Upgrade/cutoff shipped for movies (§19); TV was deferred for
  multi-file / partial-overlap complexity. Closing the gap makes "get the right copy" work for shows too.
- ~~**Capabilities probe.**~~ **SHIPPED 2026-07-10** — `testIndexer()` parses the Torznab `t=caps`
  response into categories/subcats (`parseCapsXml`), persisted on `indexers.caps_categories` and shown
  as badges in `/admin/indexers`.
- ~~**Standard category mapping + manual search.**~~ **SHIPPED 2026-07-11** — since every indexer here
  is a Torznab endpoint (Jackett/Prowlarr-backed), standard category IDs already work correctly against
  every tracker without a mapping layer; the real gap was additive-only widening for indexers whose caps
  probe shows a subcat but not the requested parent id (`resolveCategoriesForIndexer` in
  `src/lib/indexer/categories.ts` — never narrows/suppresses a query, only appends). `/admin/indexers/
  search` is the manual-search debug tool from `docs/analysis/prowlarr-analysis.md` #8: query + category
  picker → fans out via the existing `/api/torznab/search` → results table with a Grab button that posts
  straight to `/api/qbit/torrents/add`, bypassing quality profiles/gates on purpose (it's for "does this
  tracker return results", not library import).
- **Indexer flags + per-indexer stats.** Thread freeleech/internal/scene flags from Torznab `attr`
  elements — they feed a Custom Format matcher ("prefer freeleech") that already exists. Add a stats
  surface to `/admin/indexers` (query/grab counts, success rate, avg response time) built on
  `grab_history`. Pairs with the existing indexer health dashboard idea above.
- **Edition / AKA / hardcoded-sub parsing (movie-specific).** Parse Director's Cut / IMAX / Extended
  editions and AKA alternate titles from release names, and flag burned-in subs (HC/KORSUB). These fold
  into the Custom Format `title_regex` matcher so a user can prefer an Extended cut or reject HC. Small
  additions to the release-name parser.
- **Cutoff-Unmet "Wanted" admin surface.** A list of `monitored_items` below their profile cutoff, now
  that upgrade/cutoff is live (§19). Pairs with TV upgrade above; also useful as a manual retry surface.
- **FlareSolverr proxy.** A per-indexer opt-in that routes Torznab requests through a FlareSolverr
  sidecar for Cloudflare-gated trackers. Self-contained, but needs the container. Add when a wanted
  tracker is actually gated — not before.
- **Auto Tagging.** Rule-based tags derived from genre/year/network that drive delay profiles and release
  restrictions. Only worth it once multiple profiles are in use.

## Party Play polish (from watchparty / OpenWatchParty mining)

Small additions that reuse existing party state. All are cosmetic or thin protocol additions.

- **Tri-state synced/syncing/waiting badge.** The `position_ticks` median and readiness state are
  already computed server-side; surfacing them as a chip (synced / syncing / waiting) in the party panel
  is pure UI. See `openwatchparty-analysis.md` for the vocabulary.
- **Per-member playhead offset map.** Show "X is 3s behind" in the roster by diffing each member's last
  reported position against the session median — data the server already has.
- **Roster avatars.** Thread the existing initials-based avatars (hue-hashed per username) into the
  party member list. Zero new server state.
- **Message-level reactions.** Slack-style emoji reactions on individual chat messages (distinct from the
  floating-emoji broadcast). A thin extension of the chat message model.
- **Subtitle-choice sharing.** When a party member picks a subtitle track, broadcast the choice (track
  index or external URL) so all members load the same one. One extra WS message type.
- **"Queue a whole season" shortcut.** Fan out a series' episodes into the up-next queue in S/E order
  with one action. Builds on the existing `watch_party_queue` model.
- **Loop toggle.** Loop the current queue item instead of advancing. A single state flag on the session.

## Bigger swings (need a decision)

- **Mobile PWA + offline metadata** (already in `BACKLOG`) — the layout is standalone-capable; the
  service worker + `manifest.json` is the work. Pairs naturally with Web Push above.
- **Multi-instance horizontal scale** — the `PartyStateStore` interface is explicitly the scale seam
  (swap in-memory for Redis pub/sub). Only worth it if you ever run more than one app instance; noted
  as a deliberate non-goal in v1, kept here so it isn't forgotten.
- **Transcode pre-warming / "instant audio switch" (option A)** — documented as deferred at the top of
  `transcode.ts`; it needs a stream-start time offset that forks position tracking. A real feature, but
  it touches the single-timeline invariant the whole watch-progress + party-sync design depends on, so
  it's a decision, not a quick win.
