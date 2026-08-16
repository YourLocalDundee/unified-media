# Backlog — open work & future ideas

Remaining work. When an item ships: move it to `docs/complete/FEATURES.md`, add a `CHANGELOG.md`
entry, and remove it here. (Items already done — watch party, on-demand subtitle search, the admin
per-user tools, the external automation services status, Web Push, Mobile PWA, keyboard shortcut reference, bulk session
revoke, audit CSV export, theme marketplace, download-to-browse linking, torrent creation, the piece
map — are in `docs/complete/FEATURES.md`, not here.)

## Buildable

- **🐛 One request can produce two grabs — enforce one release per item.**
  Hit for real 2026-08-16. `POST /api/requests` with `pickedTorrent` (interactive
  pick), followed by approve, grabbed **both** the hand-picked 1080p release and a
  4K release the automation chose off the monitored item the same request created.
  Both completed; the automation's pick was the one imported, so the library ended
  up with the release the user had *not* chosen, and ~14.6GB was spent on one film.

  The profile in play was **"Any" (id 1), which has no `conditions`**, so nothing
  discriminated between the two candidates. That made the duplicate invisible
  rather than causing it — the double-dispatch is the actual defect.

  Two things to build:
  1. **Don't dispatch twice.** If a request carries an explicit `pickedTorrent`,
     the approve path must not also run the auto-picker for that item. Check the
     approve → `createItem` → immediate-grab path against the interactive path in
     `grabber.ts`.
  2. **Guard at the finish line anyway**, since a race can still produce two.
     Before import, if more than one completed release maps to the same item, keep
     exactly one and delete the rest with their data. Selection order:
     an explicit user pick always wins; then quality-profile match (`conditions`,
     `language`, `audio_mode`, format score); then name proximity to title+year;
     then the additive score, then seeders. When the profile is "Any", fall
     through rather than treating candidates as equally valid.

  Prefer **hardlinking** the winner into the library over moving it —
  `/srv/media/downloads` and `/srv/media/movies` are one filesystem, so the link
  costs nothing and the torrent keeps seeding from its original path. That is how
  the incident was cleaned up by hand.

- **Notification retry** — Discord, ntfy and Web Push sends are single-attempt with an 8s timeout and
  no backoff, queue, or dead-letter record. A transient outage silently drops that event's alert.
  Decide whether a retry is worth the complexity for a household-scale instance before building it.
  See `docs/features/scheduling.md` → "Known gaps".

## Operational / manual (not headless-doable)

- **Party Play edge tests** — 2-browser auto-advance test + off-tailnet cellular `/api/party/ws` idle
  test (see `docs/features/party-play.md` → "Deploy and the mandated edge test").

## Needs a decision

- **Native apps, phases 2-5** (`docs/features/native-apps.md`; the original session plan file was
  lost in the server wipe) — Phase 1 (Android phone wrapper) shipped 2026-07-14;
  remaining phases each have their own gate: Phase 2 (iOS wrapper) needs the user to accept a
  $99/yr Apple Developer cost plus a spike on whether WKWebView forwards the session cookie to HLS
  segment requests; Phase 3 (`/tv` D-pad route) is buildable headless but is the single largest
  remaining lift (spatial nav + reworking `VideoPlayer.tsx`'s keydown handler); Phase 4 (Android TV
  APK) is thin once Phase 3 exists; Phase 5 (Chromecast) needs a new signed-stream-token backend
  path plus a $5 Cast SDK developer registration.
- **Voice chat in Party Play** — requires WebRTC + a coturn STUN/TURN server; can't be built/verified
  headless. Decide stand-up-coturn vs defer.
- **Bandwidth quota** — cumulative downloads per session user, shown on the profile page with a soft
  limit configurable in the admin panel; needs a `bandwidth_usage` table. **Blocked on a product
  decision:** does "per-user" mean per-account (shared household logins undercount) or per-session/
  device? Decide before building the table.
- **`media-server` barrel import boundary** — only 1 of 59 possible imports actually goes through
  `src/lib/media-server/index.ts`; either route the other 58 through it or delete the barrel and its
  stated (and currently false) "import from here" contract. See `docs/incomplete/open-issues.md`
  "OPEN — Medium / Low remainder", 2026-08-15.

## Open from the 2026-06-13 audit (P2)

- No-op settings — **largely closed**; see `docs/incomplete/open-issues.md` "OPEN — P2 / systemic" for
  the reconciled per-pref status. Torrent Interface tab, `defaultView`, `posterSize` closed
  2026-06-19–20; `sidebarLabels` and `hwAccel` closed 2026-08-15. Only **`skipIntro`** remains a no-op,
  and it's not a product decision — it's blocked on chapter extraction not existing yet (see
  open-issues.md's "OPEN — Medium / Low remainder", 2026-08-15).
- a11y: modal focus traps + light-theme contrast.
