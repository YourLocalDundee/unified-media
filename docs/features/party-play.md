# Party Play (Watch Together) and Chat (v0.9.5)

Native watch-together built on the finished player. A party is a shared viewing session for one media
item where every member's player is kept in sync. Anyone in the party can play, pause, or seek and
everyone follows. v1 ships sync, presence, text chat, and ephemeral emoji reactions over one socket.
The server is the single authority on party state; clients send intents and render whatever the server
broadcasts back.

> **Party play coordinates the existing player only** — it does not touch transcode, codec, audio-track,
> or subtitle behavior, and `position_ticks` remains the single source of truth for progress.

## Architecture — dedicated WebSocket server on port 3002

The Next.js instrumentation hook **cannot** attach to the Next standalone HTTP server's `upgrade` event
(verified against next 16.2.7: the `http.Server` is function-local in `start-server.js`, never handed
to `register()`, and Next installs its own `upgrade` handler that destroys unrecognised upgrades). So
party play runs a **dedicated `ws` server on its own internal port 3002**, started from
`src/instrumentation.ts` behind a `globalThis`-pinned started guard, in the **same process** as the
Next route handlers and the existing schedulers. That shared process is why the `globalThis`-pinned
`PartyStateStore` singleton is visible to both the WS server and the `/api/party` REST routes. The
Docker `CMD` stays `node server.js`.

Public-edge routing. The browser connects same-origin to `wss://unified.minijoe.dev/api/party/ws`. The
live Caddy block routes that path to 3002, everything else to 3001:

```
http://unified.minijoe.dev {
    import compressed
    @partyws path /api/party/ws*
    reverse_proxy @partyws unified-frontend:3002
    reverse_proxy unified-frontend:3001
}
```

Caddy upgrades WebSockets automatically. **No compose change is needed**: the service has no host port
mapping for 3001 either — Caddy reaches both ports by container DNS over the compose network. The WS
server listens on `0.0.0.0:3002`. Dev has no Caddy, so the client connects directly to
`ws://<hostname>:3002/api/party/ws` while the page is served from `:3001` (cookies are not port-scoped,
so `unified-session` is still sent).

`next.config.ts` CSP `connect-src` was widened to
`'self' http://ip-api.com wss://unified.minijoe.dev ws://localhost:3002`.

## Data model — durable (SQLite) vs ephemeral (memory)

Durable facts only persist to SQLite; live high-frequency state lives in memory to keep the heartbeat
storm off the single SQLite writer. Two tables (idempotent migration in `migrations.ts`):

| Table | Key columns |
| ----- | ----------- |
| `watch_parties` | `id` (32-char), `join_code` (UNIQUE 6-char), `host_user_id`, `media_id`, `status` ('active'|'ended'), `last_position_ticks`, `last_paused` (checkpoints, recovery only) |
| `watch_party_members` | `party_id`, `user_id`, `joined_at`, `left_at`, `is_host`, `UNIQUE(party_id, user_id)` (join idempotent — rejoin reactivates) |

`media_id` must reference a **playable** `media_items` row (non-NULL `file_path`); series containers
are rejected at create time. Checkpoints write at most every `CHECKPOINT_THROTTLE_MS` (12s) and on
pause/seek/join — never per heartbeat. Live authoritative state lives in the WS process behind
`PartyStateStore`.

## The PartyStateStore scale seam

`src/lib/party/state-store.ts` defines the `PartyStateStore` interface + `getPartyStore()` (singleton
pinned on `globalThis`). `src/lib/party/in-memory-store.ts` is the **v1 single-instance**
implementation (a `Map` + per-party `EventEmitter`, chat ring buffer, a per-party promise-chain lock so
`updateParty` mutations serialize atomically). This interface is the **horizontal-scale boundary**: to
run multiple instances later, swap the in-memory backing for Redis pub/sub or Postgres LISTEN/NOTIFY
without touching any other party code. Do not build that in v1. Reactions deliberately have no store
method — fire-and-forget, no backlog.

## Files

| File | Role |
| ---- | ---- |
| `src/lib/party/constants.ts` | All timing/tolerance constants (single source of truth) + the 8-emoji reaction set |
| `src/lib/party/types.ts` | Protocol contract — every client/server message, live + durable shapes (client-safe, type-only) |
| `src/lib/party/state-store.ts` | `PartyStateStore` interface + `getPartyStore()` |
| `src/lib/party/in-memory-store.ts` | `InMemoryPartyStateStore` (the scale seam's v1 backing) |
| `src/lib/party/position.ts` | `extrapolatePosition`, `medianReportedPositionTicks`, tick↔seconds helpers |
| `src/lib/party/session.ts` | WS-upgrade auth: `parseSessionCookie`, `lookupPartySession` |
| `src/lib/party/db.ts` | Durable query layer (create/join/leave/end, members, `checkpointParty`, `loadActiveParties`) |
| `src/lib/party/server.ts` | `initPartyServer()` — WS server + command pipeline + drift + grace + cleanup |
| `src/lib/party/events.ts` | `globalThis`-pinned `partyEvents` emitter — bridges store `endParty()` → WS `party_ended` |
| `src/lib/party/socket-url.ts` | `getPartySocketUrl()` — dev `:3002` vs prod same-origin `wss` |
| `src/lib/party/client.ts` | Client REST wrappers (create/join/info/leave/end) |
| `src/hooks/usePartySync.ts` | The client hook — reconnecting socket, clock offset, state apply, drift, chat/reactions |
| `src/components/party/*` | `PartyPanel`, `ChatPanel`, `ReactionOverlay`, `ReactionBar`, `StartPartyButton`, `JoinByCodeModal` |
| `src/app/api/party/**` | REST lifecycle: `POST /api/party`, `/join`, `GET`+`DELETE /[partyId]`, `POST /[partyId]/leave` |

No new env vars. `NEXT_PUBLIC_APP_URL` is reused to build the join link.

## REST lifecycle (rate-limited via `checkRateLimit`)

- `POST /api/party` — `requireAuth`, body `{mediaId}`, validates playable item, generates id + unique
  6-char `joinCode`, inserts party + host member, seeds the live store. Returns
  `{partyId, joinCode, joinUrl}` where
  `joinUrl = ${NEXT_PUBLIC_APP_URL}/play/${mediaId}?party=${joinCode}`. Limit 10/hour/user.
- `POST /api/party/join` — body `{joinCode}` or `{partyId}`, upserts/reactivates membership, ensures
  live state. Returns `{partyId, mediaId, joinCode}`. Limit 30/hour/user.
- `GET /api/party/[partyId]` — `requireAuth` + membership; durable info + member list.
- `POST /api/party/[partyId]/leave` — marks `left_at`; **last member out ends the party** (host
  leaving does NOT — control is shared).
- `DELETE /api/party/[partyId]` — host only; ends the party; the shared in-process store fans
  `party_ended`.

## WebSocket protocol and the server-authority pipeline

All messages JSON. Every client message carries `{type, partyId}` and is membership-checked **per
message** (a valid session that is not a member is rejected — the endpoint is public). Client→server:
`join`, `control{action,positionTicks,clientTime}`, `heartbeat`, `ready`, `ping`, `chat`, `reaction`,
`leave`. Server→client: `state` (full authoritative snapshot), `reseek`, `waiting`, `chat`,
`chat_backlog`, `reaction`, `pong`, `party_ended`, `error`.

**The pause-war fix:** every `control` runs through one serialized per-party path (`updateParty`). Each
applied command stamps a monotonically increasing `commandSeq` (arbitrates which wins) and an
`effectiveAt` absolute server timestamp (schedules when the winning transition fires on every client).
`effectiveAt` layers on `commandSeq`, doesn't replace it. Lead times are asymmetric: `PLAY_LEAD_MS`
(1000) so transcoding clients pre-buffer, `CONTROL_LEAD_MS` (300) for pause/seek. The server never
echoes a command back as a command — it applies and broadcasts the resulting state to everyone
including the originator. Clients translate `effectiveAt` to local time via a smoothed clock offset
(`CLOCK_OFFSET_EMA_ALPHA` 0.4) from `ping`/`pong`. A keepalive `state` every
`KEEPALIVE_STATE_BROADCAST_MS` (10s) corrects drift even absent commands (its `effectiveAt` =
`serverTime` → "reconcile now").

**Readiness gate** (cross-device fix). A play is held until all CONNECTED members report `ready=true`,
or released after `READINESS_GATE_MAX_WAIT_MS` (20s) — whichever first; while held, a `waiting`
broadcast lists who is still buffering. The timeout fires from the server's periodic tick checking
`pendingPlay`.

**Drift bands** (single source of truth, `constants.ts`): below `SEEK_DEADBAND_S` (0.25s) do nothing;
0.25s up to `DRIFT_HARD_RESEEK_S` (1.5s) the **client** absorbs it with a `video.playbackRate` nudge
clamped to `[0.90, 1.10]`; at/above 1.5s the server sends that one client a targeted `reseek`. During
`POST_JOIN_SETTLE_MS` (8s) after join/reconnect the hard reseek is suppressed (nudge only). With >2
connected members the **median** of reported positions sets the room timeline (one laggard never stalls
everyone); a member beyond `MEDIAN_OUTLIER_RESEEK_S` (1.5s) off the median gets a reseek. The monotonic
high-water-mark guard means a lagging heartbeat never drags the room backward.

## Resilience

App heartbeat every `HEARTBEAT_INTERVAL_MS` (5s) + ws ping every `WS_PING_INTERVAL_MS` (20s); a socket
missing `WS_PONG_MISS_LIMIT` (2) pongs is dropped. The client wraps its socket in a reconnecting
wrapper (backoff immediate/1s/2s/5s) and on reconnect re-`join`s and adopts the full snapshot
wholesale. A dropped member sits in `'grace'` for `DISCONNECT_GRACE_MS` (30s) before eviction (a
backgrounded tab / phone lock / cellular blip does not eject anyone). A party with zero connected
members ends after `EMPTY_PARTY_IDLE_END_MS` (60s). On boot, `loadActiveParties()` rehydrates
`status='active'` parties from checkpoints so a restart doesn't destroy in-progress parties.

## Chat and reactions

Both ride the same socket, authorized by the same per-message membership check. **Chat** is ephemeral
but the server keeps a `CHAT_RING_BUFFER_SIZE` (50) in-memory backlog per party, sent as `chat_backlog`
on join so a late joiner sees recent context. Sender name, `ts`, and `id` are stamped **server-side**;
the client supplies only `text`. Nothing is written to SQLite. **Reactions** (fixed eight:
😂 ❤️ 😮 😢 👍 🔥 🎉 👏) are fire-and-forget with no backlog.

## Client integration — the three action origins (the critical correctness rule)

`usePartySync(partyId, {videoRef, selfUserId, enabled})` layers onto `VideoPlayer` as a hook; the
player is not rewritten. Every play/pause/seek the player observes has one of three origins:

1. **Remote-applied** (the hook moving the player from a `state`/`reseek` message) — done inside an
   `applyingRemoteStateRef`; the `<video>`'s own `onPlay`/`onPause`/`seeked` side-effects must not send
   intents back. Prevents the echo loop.
2. **Player-emitted** (the `<video>` firing pause or a backward micro-seek while buffering/transcoding)
   — NOT user intent, must NOT become commands. Achieved structurally: intents are never derived from
   element events; those only update local UI.
3. **Genuine user action** (local user clicking play, pressing a shortcut, releasing the scrubber) —
   ONLY these become `control` intents.

In party mode the hook intercepts the user-action surfaces (`togglePlay`, the keyboard handlers via a
`partyKbdRef`, the scrubber commit `handleSeek`) so they call `party.sendIntent(action, positionTicks)`
instead of mutating the video. The video moves only when the resulting server `state` arrives, routed
through the `applyingRemoteState` path. The server thus **never receives** the spurious buffering events
rather than having to filter them. The server-side debounce + high-water guard remain as a backstop.
All party UI/rerouting is gated behind `partyId` truthiness, so non-party playback is unchanged.

Entry points: on `/play/[id]`, `?party={joinCode}` auto-joins on load; a "Start watch party" button
(`StartPartyButton`) creates a party; a "Join with code" modal handles manual entry.

## Deploy and the mandated edge test

Caddy route applied + reloaded (above). To ship, rebuild via compose (never bare `docker build`):

```
docker compose build --no-cache unified-frontend
docker compose up -d --force-recreate unified-frontend
```

After deploy, the spec **requires** an edge test: connect from an off-tailnet (cellular) client through
the full BunkerWeb → CrowdSec → Caddy path and confirm the upgrade completes and the socket survives at
least two minutes idle. The 5s heartbeat + 20s ws ping keep the socket under any typical 60s idle reap.
**If BunkerWeb still reaps it**, add a WebSocket-aware per-domain exception for `/api/party/ws` in
`/opt/docker/compose/edge/docker-compose.yml`, in the same style as the existing `unified.minijoe.dev_*`
overrides (raise the reverse-proxy read timeout for that path or exempt it from idle close); confirm the
exact BunkerWeb variable against the running config first. Tailnet clients don't hit this.

## Audit and remediation (v0.9.5)

A full 10-domain code audit is recorded in `PARTY_PLAY_AUDIT.md` at the repo root, and **all
Critical/High/Medium/Low findings have since been fixed** (one round, 10 agents, one file group each):

- **Input validation.** Every inbound WS field (`positionTicks`, `action`, `text`, `playbackRate`,
  `clientTime`, `partyId`) is validated; positions clamped to `[0, MAX_POSITION_TICKS]`, `action`
  allowlisted, oversized frames rejected (`maxPayload`).
- **Sync correctness.** `reconcileDrift` is forward-only (high-water-mark guard), drift measured
  against forward-projected member reports (no phantom drift), readiness-gate deadline preserved across
  repeated play presses, debounce runs inside the per-party lock.
- **Edge security.** WS upgrade checks `Origin` (`allowedWsOrigins()`), live sockets re-authorized every
  `SESSION_RECHECK_INTERVAL_MS` (rejecting expired/suspended/`force_pw_change`), per-socket per-type
  rate limiting + per-user/per-party/global resource caps, and an established socket must be a live
  member on that exact socket. REST routes call `verifyOrigin`; join failures rate-limited; GET returns
  404 (not 403) to non-members.
- **Client robustness.** `reseek` timer tracked/cleared, two-phase late-join second seek implemented,
  reconnect counter only resets once a connection proves stable, heartbeat reports the room rate (not
  the transient nudge), rate-nudge restores promptly, reaction ids use `crypto.randomUUID()`, pong RTT
  sanity-clamped.
- **Durable + UI.** Atomic last-member-out leave (`leaveAndMaybeEnd`), real FK constraints on fresh
  DBs, copy-link fallback with visible error, chat auto-scroll only when near the bottom, reaction-timer
  reconciliation.

New tuning constants (caps, rate-limit windows, `MAX_POSITION_TICKS`, origin allowlist) live in
`constants.ts`. One item is intentionally deferred: an explicit Caddy idle timeout for `/api/party/ws`
(audit L5) — the heartbeat/ping is the primary keepalive; the BunkerWeb idle-reap exception is added
only if the mandated off-tailnet cellular idle test shows reaping.

## Shared queue with auto-advance (v0.10.0)

Party Play has a shared **"up next" queue**. Any member may add/remove/reorder and skip to the next —
consistent with the shared-control model (no host-only gate). When the current item ends, the party
**auto-advances**: every member's player navigates to the next item with zero clicks. Items are
playable `media_items` only (series containers rejected, same rule as party create).

- **Durable + live.** The queue lives in `PartyLiveState.queue` (in-memory authority, mutated through
  atomic `updateParty`) and is mirrored to `watch_party_queue` on every mutation (delete+reinsert keeps
  positions gap-free). `rehydrate()` reloads via `loadQueue()` on boot.
- **Protocol.** Client→server: `queue_add{mediaId,title?}`, `queue_remove{itemId}`,
  `queue_reorder{itemId,toIndex}`, `queue_advance{fromMediaId}`. Server→client: `queue{items}` (full
  snapshot on join + after every mutation) and `queue_advance{mediaId,joinCode,items}` (navigate
  everyone). All membership-checked + field-validated; `MAX_QUEUE_LENGTH=200`.
- **Advance is idempotent.** `queue_advance` carries `fromMediaId`; the server advances only if it
  still equals the party's current `mediaId`. The client fires it on the `<video>` `ended` event (and
  the "Play next" button), so when every member's video ends near-simultaneously the first request wins
  and the rest are no-ops referencing the now-stale id. On advance the server shifts the queue head,
  sets the new `mediaId`, resets position to 0, sets `paused=false` (client `applyState` auto-plays
  once buffered — permitted because the document already had user interaction before the nav), bumps
  `commandSeq`, clears every member's `ready`.
- **The navigation race (important).** On auto-advance every client `router.push`es to
  `/play/${nextMediaId}?party=${joinCode}`, unmounting the old `VideoPlayer` and remounting on the new
  route. `usePartySync`'s cleanup normally sends an explicit `leave` on unmount — but that would risk
  last-member-out (`leaveAndMaybeEnd`) ending the party mid-navigation. So the `queue_advance` handler
  raises `suppressLeaveRef` and the cleanup **skips the leave**, letting the socket close fall into the
  30s disconnect grace window; the re-join on the next item reactivates the member (its durable
  `left_at` stayed NULL). The party never hits zero active members during a transition.
- **Files.** `QueueItem`/DTO + messages in `party/types.ts`; queue field in `PartyLiveState`
  (`in-memory-store.ts` inits `queue:[]`); durable helpers
  `persistQueue`/`loadQueue`/`getPlayableMedia`/`setPartyMedia` in `party/db.ts`; server handlers
  `handleQueueAdd/Remove/Reorder/Advance` + `broadcastQueue` in `party/server.ts`; client state/ops
  (`queue`, `addToQueue`, `removeFromQueue`, `reorderQueue`, `playNext`, `onQueueAdvance`) in
  `usePartySync.ts`; UI in `party/PartyPanel.tsx` (the "Up next" list with per-item move-up/down
  reorder (v0.10.2) + remove + Play next, plus a library-search `QueueAdder`).

## Creator-kick + control-lock (v0.11.3)

Two host-only moderation actions:

- **Kick (`handleKick`)** — host sends `{type:'kick', partyId, targetUserId}`. Server validates host,
  broadcasts `member_kicked` to all (kicked client sees it then its socket closes with code 4003),
  stamps `watch_party_members.kicked_at`, removes from live state. `isActiveMember` filters `kicked_at
  IS NULL` so the kicked user cannot rejoin. Client `usePartySync` detects self-kick → sets ended state.
- **Control-lock (`handleControlLock`)** — host sends `{type:'control_lock', partyId, locked:bool}`.
  Server sets `PartyLiveState.controlLocked`, persists to `watch_parties.control_locked`, broadcasts
  `control_locked` to all. `handleControl` checks the flag at the top and rejects non-host control
  messages with error `'control_locked'`. Survives server restart (hydrated from DB row on join/rehydrate).
- **Schema.** `watch_parties.control_locked INTEGER DEFAULT 0`; `watch_party_members.kicked_at INTEGER`.
- **UI.** `PartyPanel.tsx`: `UserX` kick button per non-host member (host only); amber lock-toggle
  button for host; amber "Host has locked playback controls" banner for non-hosts when locked.

## Guest join via invite link (v0.11.4)

Guests can join a party without an account. Key variables and design decisions for future sessions:

| Variable / concept | What it is |
| --- | --- |
| `joinCode` | The 6-char uppercase party code already on `watch_parties.join_code` — the same code used for member join; doubles as the invite code. |
| `partyJoinUrl` | Constructed in `VideoPlayer.tsx` as `${origin}/join?code=${joinCode}`. Shown to the host in PartyPanel "Copy link". Used to be `/play/{id}?party={code}` — changed so guests land on the invite page. |
| `is_guest = 1` | Column on `users`. Marks throwaway accounts auto-created by the guest-session route. No password, no email. `username = guest_<makeId(12)>` — unique, opaque. `is_active = 1` so the session query works normally. |
| `GUEST_SESSION_TTL_MS` | 8 hours (`8 * 60 * 60 * 1000`). Shorter than the normal 30-day TTL. Set as `expires_at` in the `sessions` row and as `maxAge` on the cookie. After expiry, `getSession()` returns null naturally — no cleanup job needed. |
| `displayName` | The nickname the guest typed on `/join`. Stored on `users.display_name` (max 32 chars). Used in the party roster just like any member's display name. |
| `/join?code=XXXXXX` | The public invite route. Server component: validates party exists, checks `getSession()` — if logged in, redirect to `/play`; if not, render `JoinForm`. Public in `proxy.ts` PUBLIC_PATHS. |
| `/api/party/guest-session` | POST endpoint. Also in PUBLIC_PATHS (no auth). Creates the guest user row + 8h session, calls `upsertMember`, sets the cookie, returns `{mediaId, partyId, joinCode}`. |
| Proxy redirect | When unauthenticated visitor hits `/play/*?party=CODE`, the proxy now redirects to `/join?code=CODE` instead of `/login`. Handles old-format party URLs shared directly from the browser bar. |
| Guest cleanup | Guest user rows persist indefinitely after session expiry. They are inert (session expires, cookie deleted). No deletion job is planned — low volume, low impact. |

**Files.** `app/src/app/join/page.tsx` (server component); `app/src/app/join/JoinForm.tsx` (client
component); `app/src/app/api/party/guest-session/route.ts` (POST, public); `src/proxy.ts` (PUBLIC_PATHS
+ party-URL redirect); `VideoPlayer.tsx` (joinUrl format); `migrations.ts` (`is_guest` addCols).

## Ready-check + 5s start countdown (v0.11.8)

A pre-play lobby gate, separate from the technical buffer-readiness gate described above. Members mark
themselves ready via a new **`userReady`** flag; the host presses "Let's start the party (X/Y ready)" to
fire a synchronized 5-second countdown on every client, then playback begins in sync. The host can start
regardless of ready state — this is a social nudge, not a hard gate.

| Concept | Detail |
| ------- | ------ |
| `userReady` | New field on `PartyMemberLive` / `MemberSummary`. **Distinct from** `ready` (the existing technical buffer-readiness flag reported on the video `'playing'` event). Reset to `false` on every `start_countdown`. |
| `set_user_ready` | Client→server: any member toggles their own `userReady`. |
| `start_countdown` | Client→server, **host-gated**: starts the countdown regardless of who's ready. |
| `countdown` | Server→client broadcast: `{endsAt, startPositionTicks}`. Every client pauses and seeks to `startPositionTicks` immediately, then plays locally once wall-clock reaches the shared `endsAt` — no further server round-trip needed to start in sync. |
| `COUNTDOWN_DURATION_MS` | `5000`, in `constants.ts`. |
| `CountdownOverlay.tsx` | Wired into `VideoPlayer`. Uses `useSyncExternalStore` for the reduced-motion check and defers its first tick a frame — both to satisfy the §7 `set-state-in-effect` lint rule, not stylistic choices. |
