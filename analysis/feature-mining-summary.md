# Feature Mining Summary — `sources/` repos (2026-06-15)

One-pass review of all 7 reference repos in `sources/` for features worth grabbing, given where the app
is today (v0.9.5; Party Play done, Independence Build Phase 1–7 done at MVP level). Per-repo detail in the
linked docs. **This is a discussion menu, not a commitment.**

## The 7 repos, grouped

**Watch-together** (Party Play §16 already ships sync/chat/reactions/presence):
- [`watchparty-analysis.md`](watchparty-analysis.md) — richest reference; net-new features for us.
- [`openwatchparty-analysis.md`](openwatchparty-analysis.md) — confirms our sync math; few net-new.
- [`vynchronize-analysis.md`](vynchronize-analysis.md) — second reference for the shared-queue design.
- [`openlakewatchparty-analysis.md`](openlakewatchparty-analysis.md) — weak; only a WebRTC chat reference.

**Automation / indexers** (Independence Build Phase 1–2 replaced these at MVP):
- [`sonarr-analysis.md`](sonarr-analysis.md) — the shared *arr engine; deepest grabbable vein.
- [`radarr-analysis.md`](radarr-analysis.md) — movie-specific delta (Collections, edition/AKA parsing).
- [`prowlarr-analysis.md`](prowlarr-analysis.md) — indexer management (Cardigann, FlareSolverr, health).

---

## Top candidates across everything (my ranking for the discussion)

### Tier 1 — highest value-to-effort
1. **Decision-engine refactor: gate-chain + rejection reasons** (sonarr #1). Turn `scoreRelease()` into
   hard gates (min-seeders, reject-sample, max-size, blocklist) + soft score, persisting *why* a release
   was rejected. Unlocks better grabs *and* "why didn't this download" in the interactive picker. Reuses
   tables/flow we already have.
2. **Real Custom Formats** (sonarr #3). Activate the `custom_formats`/`quality_profile_formats` tables we
   already scaffolded with the actual matcher engine (regex/source/resolution/language/group/size/flags).
3. **Shared queue for Party Play** (watchparty #1 + vynchronize #1). Lift the "one item per party"
   limit → queue episodes/movies; "enqueue a whole season." Two independent references agree on the design.
4. **Notifications on request-available (Discord / ntfy)** (sonarr #7). Best *visible* user payoff;
   maps onto the availability poller; generalizes our Web-Push backlog item.

### Tier 2 — strong, a bit more work
5. **Upgrade-until-cutoff + proper/repack** (sonarr #2). Stop at "got a copy"; start getting the *right*
   copy and replacing bad releases.
6. **Blocklist + auto-retry on failed grab** (sonarr #9). Closes the reliability loop on the grab cron.
7. **Indexer health/backoff + per-indexer rate limiting** (prowlarr #3/#4). Account safety + resilience;
   one flaky tracker stops degrading every search.
8. **Voice chat in Party Play** (watchparty #2). Highest *raw* value for watch-together, but carries
   WebRTC + STUN/TURN infra cost. Voice-only first.
9. **Movie Collections "follow a franchise"** (radarr #1). Unique to movies; compelling auto-add UX.

### Tier 3 — opportunistic / pairs with the above
10. Import Lists (Trakt / RSS) auto-add (sonarr #6) — pairs with two-mode requests; mind auto-delete safety.
11. Standard category mapping + capabilities (prowlarr #5) — closes a logged MVP gap.
12. Release/Delay profiles (sonarr #4/#5); edition/AKA/HC parsing (radarr #3) — fold into custom formats.
13. Party polish: creator-kick + control-lock, tri-state sync badge, per-member playhead, message reactions.
14. Calendar of upcoming episodes (sonarr #13); indexer stats (prowlarr #6).

---

## Pragmatic non-grabs (decisions, not omissions)
- **Don't port Prowlarr's Cardigann engine** — instead point our `indexers` table at Prowlarr's aggregate
  Torznab feed for 500+ trackers at ~zero effort (prowlarr #1). Only port Cardigann if true Prowlarr
  independence becomes a hard requirement.
- **Don't adopt Prowlarr Applications-sync** — its reason to exist (push indexers to other apps) is moot
  in a unified app.
- **Skip** virtual cloud browser, screen-share, external-source (YouTube/magnet/HLS-URL) sync, Firebase/
  Stripe/Discord-bot, usenet/Newznab, Organizer/rename (we scan, not import), Rust session server, Jellyfin
  plugin model. All are architecture mismatches — see per-repo docs.

---

## Suggested first move
If we pick one thing: **Tier-1 #1 (decision gate-chain + reasons)** — it's the foundation the custom-format,
upgrade, and blocklist work all build on, and it immediately improves both auto-grabs and the interactive
picker. Tier-1 #3 (party queue) is the best standalone user-facing feature if we'd rather ship something
visible.
