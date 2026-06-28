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
