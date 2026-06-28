# Backlog — open work & future ideas

Remaining work. When an item ships: move it to `docs/complete/FEATURES.md`, add a `CHANGELOG.md`
entry, and remove it here. (Items already done — watch party, on-demand subtitle search, the admin
per-user tools, Sonarr/Radarr status — are in `docs/complete/FEATURES.md`, not here.)

## Buildable

- **Push notifications (Web Push / VAPID)** — fire when a requested item becomes available (polled from
  Seerr or via the existing webhook). Store VAPID-encrypted push subscriptions in the DB.
- **Mobile PWA** — `manifest.json` + service worker for home-screen install (iOS/Android). Offline
  metadata browsing via cache-first for library data. Layout is already standalone-capable.
- **Keyboard shortcut reference** — modal/page auto-generated from the existing shortcut definitions in
  `src/components/player/` and the global shortcut registry.
- **Bulk session revoke (across all users)** — admin action; complements the per-user revoke already in
  `/admin/users/[id]`.
- **Audit log CSV export** — admin export of the audit log.
- **Rate limiting audit** — confirm all state-mutating routes (profile mutations, admin actions, Seerr
  request creation) match the login handler's 10/15min/IP policy.
- **Torrent creation** — dialog to set a file path + tracker URLs, calling
  `POST /api/v2/torrents/createTorrent` (qBittorrent 5.0+).
- **Sequential download piece map** — canvas in the Files tab showing downloaded vs queued pieces, from
  `QbtTorrentProperties.pieces_have`/`pieces_num` + each `QbtFileInfo.piece_range`.
- **Bandwidth quota** — cumulative downloads per session user, shown on the profile page with a soft
  limit configurable in the admin panel. Needs a `bandwidth_usage` table.
- **Theme marketplace** — export/import custom themes as JSON or URL-encoded share strings. Builds on
  the existing custom-theme system in `ThemeToggle.tsx` (`unified-custom-themes` in localStorage).
- **Download-to-browse linking** — fuzzy-match torrent names to library items, show a "View in library"
  link on the downloads page (strip resolution/codec tags, compare against `item.Name`).

## Operational / manual (not headless-doable)

- **Party Play edge tests** — 2-browser auto-advance test + off-tailnet cellular `/api/party/ws` idle
  test (see `docs/features/party-play.md` → "Deploy and the mandated edge test").

## Needs a decision

- **Voice chat in Party Play** — requires WebRTC + a coturn STUN/TURN server; can't be built/verified
  headless. Decide stand-up-coturn vs defer.

## Open from the 2026-06-13 audit (P2)

- No-op settings (Display page except Theme, 9 of 11 Playback prefs, the Torrent Interface tab) — needs
  a product decision: wire them or remove them.
- a11y: modal focus traps + light-theme contrast.
