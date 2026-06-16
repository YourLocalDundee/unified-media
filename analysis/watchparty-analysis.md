# watchparty (howardchung) — Feature Mining

Source: `sources/watchparty/`
Stack: React + TypeScript (Vite) client, Node + Socket.IO + Express server, Redis (live state),
Postgres (room persistence), Firebase (auth), Stripe (subscriptions), Hetzner/Scaleway/DO/Docker
(virtual-browser pools via neko).

This is the most feature-rich watch-together reference in `sources/`. Our native **Party Play (v0.9.5,
CLAUDE.md §16)** already covers the core: sync (play/pause/seek), presence, text chat, ephemeral emoji
reactions, drift correction, readiness gate, reconnection/grace. This doc lists what watchparty has that
**we do not**, with a port assessment for each.

Authoritative file: `server/room.ts` (1457 lines) — the full socket command surface is the `socket.on("CMD:*")`
block around lines 238–355.

---

## Socket command surface (for reference)

`CMD:name`, `CMD:picture`, `CMD:uid`, `CMD:host`, `CMD:play`, `CMD:pause`, `CMD:seek`, `CMD:playbackRate`,
`CMD:loop`, `CMD:ts`, `CMD:chat`, `CMD:chatV2`, `CMD:addReaction`, `CMD:removeReaction`, `CMD:joinVideo`,
`CMD:leaveVideo`, `CMD:joinScreenShare`, `CMD:leaveScreenShare`, `CMD:userMute`, `CMD:startVBrowser`,
`CMD:stopVBrowser`, `CMD:changeController`, `CMD:subtitle`, `CMD:lock`, `CMD:askHost`, `CMD:getRoomState`,
`CMD:setRoomState`, `CMD:setRoomOwner`, `CMD:playlistNext`, `CMD:playlistAdd`, `CMD:playlistMove`,
`CMD:playlistDelete`, `CMD:kickUser`, `CMD:deleteChatMessages`, plus WebRTC relays `signal` / `signalSS`.

---

## Grabbable features (ranked by value to us)

### 1. Shared playlist / queue ★ highest value
- **What:** A room holds an ordered `playlist: PlaylistVideo[]`. Members add items (`playlistAdd`),
  reorder (`playlistMove`), delete (`playlistDelete`), and the room auto-advances (`playlistNext`) when
  the current item ends (`room.ts:670` `playlistNext`, `:690` `playlistAdd`, `:703`). On empty video the
  server calls `playlistNext(null)` automatically.
- **Why we want it:** Today a party is **one media item by design** (CLAUDE.md §16 "Single media"). A
  queue is the obvious next feature — "let's watch all of Season 1 together" without re-creating a party
  per episode, or a movie marathon. It maps cleanly onto our existing `media_items`.
- **Port assessment:** Medium. Add a `watch_party_queue` table (`party_id`, `position`, `media_id`,
  `added_by`) or an in-memory ordered list in `PartyStateStore`. New WS messages `queue_add` / `queue_move`
  / `queue_remove` / auto-advance on `ended`. The auto-advance hooks into the player's existing
  next-episode logic (`series/[id]/next-episode`). Server stays authoritative; on advance, broadcast a new
  `state` with the new `mediaId` and members re-load `/play/${id}` (or swap source in place). Our items are
  local-only so we skip watchparty's URL/YouTube/magnet resolution entirely.

### 2. WebRTC voice + video chat ★ high value
- **What:** `joinVideo` / `leaveVideo` add the member to a WebRTC mesh; `signal` relays offers/answers/ICE
  between peers (`room.ts:348`). `userMute` toggles a member's audio for everyone. The server is only a
  signaling relay — media is peer-to-peer.
- **Why we want it:** Voice chat while watching is the single biggest UX jump for a "watch together"
  product and is a frequent ask. Text chat + reactions already ship; voice is the natural escalation.
- **Port assessment:** Medium-High. The signaling is trivial to add to our existing WS server (relay
  `signal` frames to the named peer). The real work is the client: `RTCPeerConnection` mesh, getUserMedia
  permission UX, mute/deafen controls, speaking indicators, and a webcam tile strip component. Mesh is fine
  for our scale (small parties); no SFU needed. **Caveat:** needs STUN/TURN. STUN (public) is free; TURN is
  needed for symmetric-NAT peers — most home/cellular pairs work over STUN, but document a TURN fallback
  (coturn container) for reliability. Voice-only first (cheap, high value), video tiles later.

### 3. Room moderation: lock / kick / mute / delete-messages ★ medium value
- **What:** `lock` pins room control to a uid (`room.ts:55`); `kickUser` ejects a member; `userMute`
  silences a member's voice; `deleteChatMessages` removes messages (moderation); `changeController` /
  `setRoomOwner` transfer control.
- **Why we want it:** We deliberately ship **shared control, no host** (CLAUDE.md §16). That's good for
  trusted friends but offers no recourse if someone griefs (spam-seeks, spam-chat). A lightweight
  **creator-only** kick + "lock control to me" toggle is a reasonable safety valve without abandoning the
  shared-control default.
- **Port assessment:** Low-Medium. We already track `host_user_id` on `watch_parties`. Add `kick` (drop the
  socket + tombstone the membership so they can't rejoin) and an optional `controlLock` flag in the store
  that gates `control` intents to the lock holder. Chat-message delete needs message IDs (we already stamp
  `id` server-side per CLAUDE.md §16) and a tombstone in the ring buffer.

### 4. Reactions attached to chat messages (toggle) — small value
- **What:** `addReaction` / `removeReaction` attach a reaction set to a specific chat message
  (`msg.reactions[emoji] = [clientId, ...]`, toggled, deduped per client — `room.ts:901–927`). This is
  Slack/Discord-style message reactions, distinct from floating screen reactions.
- **Why we want it:** Complements (does not replace) our fire-and-forget floating emoji. Low priority.
- **Port assessment:** Low. Our chat already has server-stamped message IDs; add a `reactions` map to the
  buffered message shape and two WS messages. Only matters once chat is heavily used.

### 5. Subtitle sharing across the party — small value
- **What:** `CMD:subtitle` broadcasts the chosen subtitle URL so everyone loads the same track
  (`room.ts:311`).
- **Why we want it:** Our player already has rich per-user subtitle selection (CLAUDE.md §10b). Syncing the
  *choice* across a party is a nice touch but arguably people want their own language. Low priority; if
  added, broadcast `subIndex` and let clients opt in.

### 6. Per-member playhead map (`tsMap`) — surfaced UI, small value
- **What:** `tsMap` is a per-client position map broadcast every interval (`room.ts:94–105`,
  `REC:tsMap`), letting the UI show how far behind/ahead each member is.
- **Why we want it:** We already compute a **median reported position** server-side for reconciliation
  (CLAUDE.md §16 "drift bands") but don't surface per-member offsets. Exposing a tiny "everyone's in sync /
  X is 3s behind" indicator is cheap polish on data we already have.

### 7. Avatars in the roster (`pictureMap`) — small value
- We render presence; watchparty also carries a `pictureMap` for avatar thumbnails in the roster. We
  already generate initials-avatars (CLAUDE.md §11) — just thread them into the `PartyPanel` member list.

### 8. Loop toggle — trivial
- `CMD:loop` loops the current item. Trivial to add; niche for our use case.

---

## Explicitly NOT worth grabbing (architecture mismatch)

- **Virtual cloud browser (neko) / `startVBrowser`** — spins up cloud VMs (Hetzner/Scaleway/DO/Docker,
  `server/vm/*`) to co-browse arbitrary sites. Massive infra surface, irrelevant to a local media server.
- **Screen sharing (`joinScreenShare` / `signalSS`)** — we watch local library content, not arbitrary
  screens. Skip unless we ever want "share my screen" as a side feature; the WebRTC plumbing would be
  reused from feature #2 anyway.
- **External source resolution** — YouTube (`@googleapis/youtube`), magnet/WebTorrent, arbitrary HTTP, HLS
  URLs, stream-your-own-file. We only sync items already in `media_items`. Not applicable.
- **Firebase auth / Stripe subscriptions / Discord bot / multi-shard Redis scaling** — we have our own
  SQLite auth, no billing, and a documented single-instance `PartyStateStore` scale seam (CLAUDE.md §16).

---

## Hardening notes worth stealing (not features, but good ideas)

- **Rate limiting per room** — watchparty uses a token bucket (10 tokens/min, per the OpenWatchParty
  feature list too). We already added per-socket per-type WS rate limiting in the v0.9.5 audit; cross-check
  our limits against theirs.
- **`chatV2`** — watchparty kept a v1/v2 chat message shape for backward compat. Reminder to version our WS
  protocol if we extend chat (reactions-on-message, queue) so older clients degrade gracefully.
- **Message size cap (64KB)** — matches our `maxPayload` hardening.

---

## Recommendation (for the "talk about it later" discussion)

Priority order if we extend Party Play: **(1) shared queue → (2) voice chat → (3) creator kick + control
lock**. Queue is the highest value-to-effort and reuses everything we have. Voice chat is the highest raw
value but carries TURN/infra cost. Everything else is polish.
