# Backlog — open work & future ideas

Remaining work. When an item ships: move it to `docs/complete/FEATURES.md`, add a `CHANGELOG.md`
entry, and remove it here. (Items already done — watch party, on-demand subtitle search, the admin
per-user tools, Sonarr/Radarr status, Web Push, Mobile PWA, keyboard shortcut reference, bulk session
revoke, audit CSV export, theme marketplace, download-to-browse linking, torrent creation, the piece
map — are in `docs/complete/FEATURES.md`, not here.)

## Buildable

- **Rate limiting audit** — confirm all state-mutating routes (profile mutations, admin actions, Seerr
  request creation) match the login handler's 10/15min/IP policy.

## Operational / manual (not headless-doable)

- **Party Play edge tests** — 2-browser auto-advance test + off-tailnet cellular `/api/party/ws` idle
  test (see `docs/features/party-play.md` → "Deploy and the mandated edge test").

## Needs a decision

- **Voice chat in Party Play** — requires WebRTC + a coturn STUN/TURN server; can't be built/verified
  headless. Decide stand-up-coturn vs defer.
- **Bandwidth quota** — cumulative downloads per session user, shown on the profile page with a soft
  limit configurable in the admin panel; needs a `bandwidth_usage` table. **Blocked on a product
  decision:** does "per-user" mean per-account (shared household logins undercount) or per-session/
  device? Decide before building the table.

## Open from the 2026-06-13 audit (P2)

- No-op settings (Display page except Theme, 9 of 11 Playback prefs, the Torrent Interface tab) — needs
  a product decision: wire them or remove them.
- a11y: modal focus traps + light-theme contrast.
