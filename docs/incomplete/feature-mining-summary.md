# Feature Mining Summary — `sources/` repos (refreshed 2026-06-28)

One-pass review of all 7 reference repos in `sources/` for features worth grabbing, given where the app
is today (v0.12.0). Per-repo detail in the linked docs. **This is a discussion menu, not a commitment.**

**Refreshed 2026-06-28.** A large chunk of the original Tier-1/Tier-2 list has since shipped (Independence
Build + the v0.10.0 through v0.12.0 automation work). Shipped items are marked below with their version, and
the "top candidates" ranking is rebuilt around what is still grabbable.

## The 7 repos, grouped

**Watch-together** (Party Play §16 ships sync/chat/reactions/presence + shared queue):
- [`watchparty-analysis.md`](watchparty-analysis.md) — richest reference. Voice chat + moderation remain net-new.
- [`openwatchparty-analysis.md`](openwatchparty-analysis.md) — confirms our sync math. Only the tri-state badge is net-new.
- [`vynchronize-analysis.md`](vynchronize-analysis.md) — second reference for the shared-queue design.
- [`openlakewatchparty-analysis.md`](openlakewatchparty-analysis.md) — weak. Only a WebRTC chat reference.

**Automation / indexers** (Independence Build Phase 1–2 replaced these at MVP, then v0.10–v0.12 deepened them):
- [`sonarr-analysis.md`](sonarr-analysis.md) — the shared *arr engine. Most of the depth is now built.
- [`radarr-analysis.md`](radarr-analysis.md) — movie-specific delta (Collections, edition/AKA parsing) still open.
- [`prowlarr-analysis.md`](prowlarr-analysis.md) — indexer management. Health/backoff shipped, rate-limit/categories open.

---

## Already shipped (do not re-suggest)

| Feature | Source | Version |
|---|---|---|
| Decision gate-chain + rejection reasons | sonarr #1 | v0.10.0 (§17) |
| Real Custom Formats (language/group/size/flag) | sonarr #3 / radarr #3 | v0.10.0 (§17) |
| Blocklist + auto-retry on failed grab (reaper) | sonarr #9 | v0.10.0 (§17) |
| Shared queue for Party Play + auto-advance | watchparty #1 / vynchronize #1 | v0.10.0 (§16) |
| Notifications on request-available (Discord / ntfy) | sonarr #7 | v0.11.0 (§18) |
| Upgrade-until-cutoff + proper/repack (MOVIES) | sonarr #2 | v0.11.0–v0.12.0 (§19) |
| Indexer health + exponential backoff | prowlarr #3 | v0.12.0 (§21) |
| Import Lists (Trakt + RSS auto-add) | sonarr #6 / radarr #2 | v0.12.0 (§20) |
| Transmission + Deluge download clients | (not from sources) | v0.12.0 |
| Interactive search with rejection reasons | sonarr #8 | shipped with §17 |
| On-demand subtitle search | (Bazarr-adjacent) | v0.9.11 (§10b) |
| Keyboard-shortcut registry | (not from sources) | v0.12.0 |
| Theme marketplace | (not from sources) | v0.12.0 |
| Per-indexer rate limiting (queries/day + grabs/day) | prowlarr #4 | v0.11.3 |
| Party Play: creator-kick + control-lock | watchparty #3 | v0.11.3 |
| Party Play: guest join via invite link | (not from sources) | v0.11.4 |
| Movie Collections — follow a TMDB franchise | radarr #1 | v0.11.5 |
| Delay profiles — hold releases N min before grab | sonarr #5 | v0.11.5 |
| Edition flags + HC-sub detection + AKA fallback search | radarr #3 | v0.11.3 |

---

## Top candidates across what remains (my ranking for the discussion)

### Tier 1 — highest value-to-effort

_(All original Tier-1 items shipped. See "Already shipped" table above.)_

### Tier 2 — strong, a bit more work

1. **TV season-pack upgrade-until-cutoff** (sonarr #2 TV half). Upgrade/cutoff shipped for MOVIES only (§19);
   TV season packs were deferred for the multi-file / partial-overlap complexity. Closing that gap makes
   "get the right copy" work for shows too. Medium-high effort.
2. **Standard category mapping + capabilities** (prowlarr #5). Probe each indexer's capabilities and map
   tracker categories to the Newznab standard tree, so "TV only" search works correctly across heterogeneous
   indexers. Closes a logged MVP gap and enables a category picker.
3. **Indexer flags + indexer stats** (prowlarr #6/#7). Thread freeleech/internal/scene flags from Torznab
   attrs (they feed a Custom Format like "prefer freeleech", the flag matcher already exists) and add a
   per-indexer stats surface (query/grab counts, success rate) on `/admin/indexers`, built on `grab_history`.
4. **Voice chat in Party Play** (watchparty #2). Highest *raw* value for watch-together, the natural step
   after text chat + reactions. Signaling is trivial on our existing WS server. Carries WebRTC + STUN/TURN
   infra cost (STUN free, a coturn TURN container needed as a fallback for symmetric-NAT pairs), which is why
   it sits here and not Tier 1. Voice-only first, webcam tiles later.
5. **Calendar of upcoming episodes** (sonarr #13). A calendar of upcoming/aired episodes for monitored series
   off TMDB data, with an optional iCal export. Nice user-facing surface.

### Tier 3 — opportunistic / pairs with the above

7. **Cutoff-Unmet "Wanted" admin surface** (sonarr #10). Now buildable since upgrade/cutoff exists (§19): a
   list of items below their profile cutoff. Pairs with Tier-2 #1 (TV upgrade).
8. **FlareSolverr proxy** (prowlarr #2). A per-indexer "route through FlareSolverr" option for
   Cloudflare-gated trackers. Self-contained, but needs the FlareSolverr container running. Add when a
   wanted tracker is actually Cloudflare-gated.
9. **Party polish on data we already emit:** tri-state synced/syncing/waiting badge (openwatchparty #2),
   per-member playhead offsets (watchparty #6, from our median data), roster avatars (watchparty #7, reuse
   initials-avatars), message-level reactions (watchparty #4), subtitle-choice sharing (watchparty #5),
   loop toggle (watchparty #8).
10. **"Queue a whole season" in one action** (vynchronize #1 "enqueue playlist"). A small enhancement on the
    existing party queue: fan out a series' episodes into the up-next list in S/E order.
11. **Auto Tagging** (sonarr #11). Rule-based tags (genre/year/network) that drive delay profiles and release
    restrictions. Only worth it once we run several profiles.

---

## Pragmatic non-grabs (decisions, not omissions)

- **Don't port Prowlarr's Cardigann engine.** Point our `indexers` table at Prowlarr's aggregate Torznab feed
  for 500+ trackers at ~zero effort (prowlarr #1). Only port Cardigann if true Prowlarr independence becomes a
  hard requirement.
- **Don't adopt Prowlarr Applications-sync.** Its reason to exist (push indexers to other apps) is moot in a
  unified app.
- **Release Profiles (sonarr #4) are largely subsumed** by the shipped Custom Formats (title_regex / group /
  flag matchers cover preferred/required/ignored terms). Skip the separate feature unless a real gap appears.
- **Skip** virtual cloud browser, screen-share, external-source (YouTube/magnet/HLS-URL) sync, Firebase/
  Stripe/Discord-bot, usenet/Newznab, Organizer/rename (we scan, not import), Rust session server, Jellyfin
  plugin model. All are architecture mismatches, see per-repo docs.

---

## Next up

Tier 1 is fully shipped. The top remaining picks are:
- **Tier-2 #1 (TV season-pack upgrade-until-cutoff)** — closes the biggest automation gap left
- **Tier-2 #2 (Category mapping)** — makes "TV only" searches correct across heterogeneous indexers
- **Tier-2 #3 (Indexer flags + stats)** — freeleech awareness + operational visibility
