# Voice Chat in Party Play — Implementation Plan

Status: **PROPOSED — awaiting approval. No feature code written yet.**

Opt-in, device-capability-gated live voice for watch-party members. WebRTC Opus audio signaled
over the existing party WebSocket. OFF by default. A voice failure must never regress sync, text
chat, reactions, the queue, or the `position_ticks` single-source-of-truth invariant.

---

## 0. Pre-work gate (done)

Baseline build is green before any change:

```
npx tsc --noEmit        → exit 0 (clean)
npm run build           → exit 0 (compiled, all routes emitted)
```

Investigation of the existing party WS protocol (server dispatch, per-message membership check,
per-type rate limiting, validation, broadcast/unicast helpers, session recheck, `usePartySync`
lifecycle) is captured inline in this plan's "How it bolts onto the existing protocol" sections.
Key file/line anchors:

- Dispatch switch: `src/lib/party/server.ts:835` (`handleMessage`)
- Per-message membership: `isLiveMemberOnSocket()` `server.ts:827`, invoked at `:867`
- Per-type rate limit: `RateWindow` `server.ts:102`, `allowRate()` `server.ts:787`, invoked `:852`
- Field validation: `validateMessage()` `server.ts:605`, invoked `:849`
- Broadcast-to-all: `broadcastToParty()` `server.ts:193`
- **Unicast to one member (already exists): `sendToMember(rt, state, userId, msg)` `server.ts:209`**
- Session recheck: `pingSweep()` `server.ts:1240`, `SESSION_RECHECK_INTERVAL_MS=60s` `constants.ts`
- Per-connection object: `SocketEntry` `server.ts:112`
- Client/server message unions: `src/lib/party/types.ts:219` / `:312`
- Hook: `usePartySync()` `src/hooks/usePartySync.ts:98`

---

## 1. Topology decision — full-mesh P2P vs SFU

**Recommendation: full-mesh P2P for v1.** Document the SFU swap as a later horizontal-scale seam,
mirroring how `PartyStateStore` is the documented scale seam for party state.

| | Full-mesh P2P (chosen v1) | SFU (deferred) |
| --- | --- | --- |
| Server media infra | None — server only relays signaling text frames | A running media server (mediasoup/LiveKit/Janus) terminating RTP |
| Connections per peer | N-1 peer connections, N-1 uplinks | 1 uplink to SFU, 1 downstream bundle |
| Bandwidth at N members | O(N) up per peer; fine at household scale | O(1) up per peer |
| New ops surface | coturn only | coturn + SFU + its scaling/credential/codec config |
| Complexity | Lowest; pure browser RTCPeerConnection | New service, server-side media routing |

Rationale: a household watch party is a handful of members. Opus audio at ~24-40 kbit/s means even
5 members is ~5 uplinks of ~40 kbit/s ≈ 200 kbit/s up per peer — trivial. Full-mesh adds **zero**
new media infrastructure (coturn is signaling-adjacent NAT traversal, not a media server). The SFU
is the answer when parties grow past ~6-8 simultaneous voice participants; we gate that behind the
same kind of seam comment we use for `PartyStateStore`.

**Mesh sizing cap:** enforce a voice-participant cap (`VOICE_MAX_PARTICIPANTS`, proposed 6) so a
runaway full-mesh can't melt a phone. Members past the cap see "voice full" and stay text-only.
This cap is independent of `MAX_MEMBERS_PER_PARTY=50` — a 50-member text party with a 6-seat voice
room is a valid state.

### Mesh connection establishment rule (avoid glare)

Deterministic offerer to prevent both peers offering at once: **the peer with the
lexicographically smaller `userId` creates the offer** to the peer with the larger `userId`. On
`voice_join` broadcast, each existing voice member compares ids and only the smaller-id side calls
`createOffer`. This is the standard "polite/impolite peer" tie-break reduced to a pure id compare,
and it needs no extra server state.

---

## 2. New WebSocket message types (signaling)

The server stays a **dumb membership-checked relay** — it never parses SDP/ICE, never touches
media. It validates envelope shape, checks membership + rate limit, and forwards. All payloads are
opaque strings to the server.

### Client → Server (add to `ClientMessage` union, `types.ts:219`)

| type | payload | relay |
| --- | --- | --- |
| `voice_join` | `{ partyId }` | broadcast to party (announces "I am now in voice") |
| `voice_leave` | `{ partyId }` | broadcast to party |
| `voice_mute` | `{ partyId, muted: boolean }` | broadcast to party (presence/UI only) |
| `voice_signal` | `{ partyId, to: userId, signal: { kind: 'offer'\|'answer'\|'ice', data: string } }` | **unicast** to `to` via `sendToMember()` |

`voice_signal` carries SDP (`offer`/`answer`) and ICE candidates as opaque strings. `data` is
length-capped (`VOICE_SIGNAL_MAX_BYTES`) and never inspected by the server beyond that cap.

### Server → Client (add to `ServerMessage` union, `types.ts:312`)

| type | payload | source |
| --- | --- | --- |
| `voice_join` | `{ partyId, from: { userId, displayName } }` | broadcast on a member joining voice |
| `voice_leave` | `{ partyId, from: { userId } }` | broadcast on leave/disconnect |
| `voice_mute` | `{ partyId, from: { userId }, muted }` | broadcast on mute toggle |
| `voice_signal` | `{ partyId, from: { userId, displayName }, signal }` | unicast forwarded to the addressed peer |
| `voice_peers` | `{ partyId, peers: [{ userId, displayName, muted }] }` | sent to a joiner so it knows the current voice roster to dial |
| `error` | reuse existing `ErrorMessage` with new codes `voice_full`, `not_in_voice` | unicast |

`voice_peers` is the join handshake: when a client sends `voice_join`, the server replies (unicast)
with the current voice roster so the joiner can run the offerer tie-break against each existing
peer. The "speaking indicator" is **client-derived** (Web Audio `AudioContext` analyser on each
remote stream / local stream) and shown locally — it does **not** generate a WS message, so it adds
zero signaling traffic. `voice_mute` is the only mic-state message and it is low-frequency.

### Server-side voice roster

Add a per-party `voiceMembers: Set<userId>` to the runtime party state (NOT persisted — voice is
ephemeral, like presence). Drives `voice_peers`, the `VOICE_MAX_PARTICIPANTS` cap, and a
`voice_leave` broadcast on socket close if the member was in voice. On disconnect/grace/session
expiry the existing cleanup path must also evict from `voiceMembers` and broadcast `voice_leave`.

---

## 3. Membership, validation, rate limiting (mirror existing gates exactly)

- **Membership:** every voice message routes through the same `isLiveMemberOnSocket()` check at
  `server.ts:867` before its handler runs. No separate path. A non-member's voice frame is rejected
  with `not_member` exactly like chat.
- **Validation:** add cases to `validateMessage()` (`server.ts:605`):
  - `voice_join`/`voice_leave`: `partyId` non-empty string.
  - `voice_mute`: `partyId` + `muted` boolean.
  - `voice_signal`: `partyId` + `to` non-empty string + `signal.kind ∈ {offer,answer,ice}` +
    `signal.data` string with `length ≤ VOICE_SIGNAL_MAX_BYTES`. Reject with `bad_field`.
- **Rate limiting:** add a `voice` counter to `RateWindow` (`server.ts:102`) and a check in
  `allowRate()` (`server.ts:787`) keyed by a new `WS_VOICE_MAX_PER_WINDOW`. ICE trickle can burst
  (tens of candidates during connection setup), so this cap is the highest per-type cap — proposed
  120 per 10s window — still well under `WS_MSG_MAX_PER_WINDOW=200`. `voice_join/leave/mute` are
  rare and share the same `voice` bucket.
- **Session recheck:** voice signaling rides the same socket, so the 60s `SESSION_RECHECK` in
  `pingSweep()` already covers it. No change needed beyond evicting from `voiceMembers` on the
  existing `ws.close(1008,'session_expired')` path.

---

## 4. Capability gate + permission state machine

### Capability gate — `hasVoiceSupport()` (new, `src/lib/party/voice-support.ts`)

Pure, client-only, no side effects, returns a discriminated result. Voice UI renders **only** when
this resolves supported; otherwise a disabled "Voice not available on this device" chip.

```
hasVoiceSupport():
  1. window.isSecureContext === true            (getUserMedia requires secure context)
  2. navigator.mediaDevices != null
  3. typeof navigator.mediaDevices.getUserMedia === 'function'
  4. navigator.mediaDevices.enumerateDevices reports ≥1 'audioinput'
       (labels may be empty pre-permission — presence of the kind is enough)
  → supported | unsupported(reason)
```

Note: `enumerateDevices` is async, so the gate is async and its result is cached in hook state.
Steps 1-3 are synchronous and can render the disabled state instantly; step 4 refines it.

### Permission/connection state machine (in `usePartyVoice`)

```
            ┌────────────────────────────────────────────────────────────┐
            │                                                            │
 unsupported ──(gate fails)                                             │
            │                                                            │
   idle ──(user toggles ON)──> requesting ──getUserMedia({audio:true})──┤
   ▲  ▲                           │                                     │
   │  │            NotAllowedError│ NotFoundError │ timeout(no resolve) │
   │  │                           ▼               ▼          ▼          │
   │  └──(user dismisses error)─ error(denied / no-mic / timed-out) ────┘
   │                                                                     │
   │                            success                                  │
   │                              ▼                                      │
   │                            live ──(self-mute toggle: track.enabled)─┐
   │                              │  (instant, local, no renegotiation)  │
   └──(user toggles OFF / unmount / leave party)── stopping ────────────┘
                                   │  stop all tracks, close peer conns,
                                   │  send voice_leave
                                   ▼
                                 idle
```

Failure handling (distinct, actionable — never a spinner):
- `NotAllowedError` / `SecurityError`: "Microphone blocked. Re-enable it in your browser/OS
  settings." (covers macOS/iOS OS-level denial where the API exists but the prompt rejects).
- `NotFoundError` / `OverconstrainedError`: "No microphone found."
- **Prompt ignored (promise never resolves):** wrap `getUserMedia` in a `VOICE_PERMISSION_TIMEOUT_MS`
  (proposed 30s) race; on timeout → `error(timed-out)` with a retry affordance.
- On every exit (leave/unmount/toggle-off): `stream.getTracks().forEach(t => t.stop())` to release
  the mic and clear the OS in-use indicator. Verified in the edge test.

### "Never prompt me" preference

A persisted per-user preference `voiceEnabled` (default OFF / "never"), stored the same way as the
existing playback prefs (the settings/playback store pattern). When set to never, the hook short-
circuits before `getUserMedia` and the toggle renders as opt-in-required. No mic access without a
deliberate per-session toggle ON.

---

## 5. ICE server delivery (no static creds in client JS)

- New server route **`GET /api/party/ice`** (`requireAuth()`), returns the ICE server list the
  client feeds to `new RTCPeerConnection({ iceServers })`.
- STUN is public/unauthenticated. **TURN uses short-lived (ephemeral) credentials** via coturn's
  `use-auth-secret` REST mechanism (coturn `static-auth-secret`): the route computes
  `username = <unixExpiry>:<userId>` and `credential = base64(HMAC-SHA1(secret, username))`, TTL
  `VOICE_TURN_CRED_TTL_S` (proposed 1h). The long-lived `TURN_AUTH_SECRET` never leaves the server.
- Shape returned:
  ```json
  { "iceServers": [
      { "urls": ["stun:turn.minijoe.dev:3478"] },
      { "urls": ["turn:turn.minijoe.dev:3478?transport=udp",
                 "turn:turn.minijoe.dev:3478?transport=tcp"],
        "username": "<expiry>:<userId>", "credential": "<hmac>" }
  ]}
  ```
- If `TURN_*` env is unset, the route returns STUN-only and the UI still works on LAN/tailnet (TURN
  is only needed for the off-tailnet cellular case). This keeps voice functional in dev without
  coturn.

---

## 6. coturn deployment (edge stack)

Edge stack confirmed at `/opt/docker/compose/edge/docker-compose.yml` (alongside BunkerWeb/Caddy).
coturn is the same population that needed the BunkerWeb cellular exceptions.

**Operational cost (informed-decision callout):** a new long-running service, an open relay port
range, and a shared secret that should be rotated. coturn relays media for off-tailnet peers, so it
carries real (if low, at household scale) bandwidth. Lock it down: `static-auth-secret` only (no
long-term user db), `no-cli`, deny private/loopback peer ranges (`denied-peer-ip`), `total-quota`.

Deploy steps:
1. Add a `coturn` service to the edge compose (`coturn/coturn` image, `network_mode: host` is
   simplest for the relay port range, or explicit port mapping `3478/udp+tcp` plus
   `49160-49200/udp` relay range — narrow range to bound exposure).
2. Mount `turnserver.conf`:
   ```
   listening-port=3478
   fingerprint
   use-auth-secret
   static-auth-secret=${TURN_AUTH_SECRET}     # from env, never committed
   realm=turn.minijoe.dev
   min-port=49160
   max-port=49200
   no-cli
   no-tlsv1
   no-tlsv1_1
   denied-peer-ip=0.0.0.0-0.255.255.255       # + RFC1918 ranges
   total-quota=100
   ```
   (TLS/`turns:` on 5349 is a v1.x follow-up; UDP/TCP 3478 covers the cellular case. Re-evaluate if
   a network blocks plain TURN.)
3. DNS: Pi-hole/host record `turn.minijoe.dev` → the edge host. For off-tailnet reachability the
   relay ports must be reachable from the public side (router/firewall), unlike the rest of the
   stack which sits behind BunkerWeb. **This is the one piece that is not behind the WAF** — note it
   explicitly; it is a UDP relay, not HTTP, so BunkerWeb does not proxy it.
4. Secrets: `TURN_AUTH_SECRET` in the edge `.env` (compose) AND in the app container env (the
   `/api/party/ice` route signs with it). Rotation = change in both + `docker compose up -d`.
5. BunkerWeb: no WAF rule needed (non-HTTP). Document the open relay port as an intentional edge
   exception next to the existing cellular notes.

---

## 7. CSP / env / headers changes (`app/next.config.ts`)

Two load-bearing edits found during investigation:

1. **`Permissions-Policy` currently `microphone=()` — this disables the mic for ALL origins,
   including self.** `getUserMedia({audio:true})` is blocked by policy before our gate runs. Change
   to `microphone=(self)`. (Leave `camera=()` — no video in v1.) This is the single most important
   header change; without it the feature cannot work.
2. **`connect-src`** currently `'self' http://ip-api.com wss://unified.minijoe.dev ws://localhost:3002`.
   Browsers match ICE server URLs against `connect-src`. Add the STUN/TURN host:
   `stun:turn.minijoe.dev:3478 turn:turn.minijoe.dev:3478`. (Schemes `stun:`/`turn:` are matched as
   the host source; include them so cellular TURN relay isn't CSP-blocked.)

`.env` additions (documented in CLAUDE.md §8 env block on ship):
- App container: `TURN_AUTH_SECRET`, `TURN_HOST=turn.minijoe.dev`, `TURN_PORT=3478`,
  `VOICE_TURN_CRED_TTL_S` (optional override). Unset `TURN_*` → STUN-only, voice still works on LAN.
- Edge container: `TURN_AUTH_SECRET` (same value), coturn realm.

No Caddy change — signaling rides the existing `/api/party/ws` route; `/api/party/ice` is a normal
HTTP route already covered by the `unified-frontend:3001` reverse_proxy. coturn is reached directly
by UDP/TCP, not through Caddy.

---

## 8. File-by-file change list

Build in 2-item chunks; gate (`tsc --noEmit` + `eslint <files>`) after each item, `npm run build`
after each pair; update this doc's checklist as items land.

### Protocol / shared
1. `src/lib/party/constants.ts` — add `VOICE_MAX_PARTICIPANTS=6`, `WS_VOICE_MAX_PER_WINDOW=120`,
   `VOICE_SIGNAL_MAX_BYTES`, `VOICE_PERMISSION_TIMEOUT_MS=30000`, `VOICE_TURN_CRED_TTL_S=3600`. No
   inline magic numbers anywhere else.
2. `src/lib/party/types.ts` — add the client + server voice message interfaces; extend both unions.
   New `error` codes `voice_full`, `not_in_voice`. Client-safe, type-only (matches existing).

### Server (dumb relay)
3. `src/lib/party/server.ts` —
   - `validateMessage()`: voice cases (incl. the `VOICE_SIGNAL_MAX_BYTES` cap + `signal.kind` enum).
   - `RateWindow` + `allowRate()`: add the `voice` bucket.
   - `handleMessage()` switch: `voice_join` (cap check → add to `voiceMembers` → unicast
     `voice_peers` → broadcast `voice_join`), `voice_leave`, `voice_mute` (broadcast),
     `voice_signal` (validate `to` is a live member → `sendToMember()` unicast).
   - Per-party runtime state: `voiceMembers: Set<userId>`; evict + broadcast `voice_leave` on
     socket close / grace / session-expiry cleanup paths.

### Server route
4. `src/app/api/party/ice/route.ts` — `requireAuth()`, returns ICE list with ephemeral TURN creds
   (HMAC over `<expiry>:<userId>`), STUN-only fallback when `TURN_*` unset.

### Client hook + capability
5. `src/lib/party/voice-support.ts` — `hasVoiceSupport()` (secure context + mediaDevices +
   getUserMedia + ≥1 audioinput), returns discriminated supported/unsupported(reason).
6. `src/hooks/usePartyVoice.ts` — **sibling to `usePartySync`, fully independent.** Owns the
   `RTCPeerConnection` mesh (Map<userId, RTCPeerConnection>), local `MediaStream` lifecycle, per-peer
   `<audio>` elements, the offerer tie-break, the permission state machine, self-mute
   (`track.enabled=false`), and the speaking-indicator analyser. It consumes voice WS messages and
   sends voice WS messages, but **a voice failure throws/cleans up inside this hook only — it never
   touches the sync socket or `usePartySync`.**

   WS sharing decision: to honor "no second socket for signaling," `usePartyVoice` does **not** open
   its own WebSocket. Instead `usePartySync` exposes a minimal voice transport seam — a
   `sendVoice(msg)` sender and a `subscribeVoice(handler)` registration for incoming `voice_*`
   frames — and `usePartyVoice` plugs into that. This keeps one socket (the spec's hard constraint)
   while keeping the hooks separate so voice can't break sync. `usePartySync`'s message dispatch
   (`usePartySync.ts:359`) routes any `voice_*` frame to the registered voice handler and ignores it
   if none is registered.

### UI
7. `src/components/party/VoiceBar.tsx` — mic toggle (off / requesting / live+mute / error /
   unavailable), rendered only when `hasVoiceSupport()` is supported. Disabled "Voice not available
   on this device" state otherwise.
8. `src/components/party/*` (the member list / presence component) — per-member voice presence dot +
   speaking indicator + muted icon, mirroring how reactions/presence already render. Reuses the
   `members` presence the party already broadcasts; voice membership comes from `voice_join/leave`.

### Settings
9. `src/app/settings/playback/*` (or the existing playback prefs store) — add the persisted
   `voiceEnabled` ("never prompt") preference next to the other playback prefs.

### Config / infra (not app code, tracked here)
10. `app/next.config.ts` — `Permissions-Policy microphone=(self)`; `connect-src` += STUN/TURN host.
11. `/opt/docker/compose/edge/docker-compose.yml` + `turnserver.conf` — coturn service, secret via
    env, narrowed relay port range.

### Docs on ship
12. `docs/complete/FEATURES.md` row + `CHANGELOG.md [Unreleased]` + remove from
    `docs/incomplete/BACKLOG.md` + a short pointer stub in `CLAUDE.md §16` (deep-dive → a new
    `docs/features/party-voice.md` or a section in `party-play.md`). Add the `TURN_*` env to §8.

---

## 9. Manual edge-test procedure (the acceptance gate)

Headless automation can't cover this; it is the same population as the existing off-tailnet party
idle test.

1. **Capability gate (insecure context):** load over `http://` or a non-secure-context browser →
   voice UI shows the disabled "not available" state and **`getUserMedia` is never called** (verify
   in devtools — no mic prompt, no permission entry).
2. **Opt-in proven:** join a party. No mic prompt appears until the toggle is flipped ON. Flip ON →
   browser mic prompt appears (only then).
3. **Permission failure paths:** deny the prompt → distinct "blocked, re-enable" message, not a
   spinner. On a device with no mic → "no microphone found". Ignore the prompt → after
   `VOICE_PERMISSION_TIMEOUT_MS` the connecting state resolves to a timed-out error with retry.
4. **Mic release:** leave voice / leave party / navigate away → OS mic in-use indicator clears
   (tracks stopped).
5. **Two-peer LAN/tailnet (STUN path):** two members on the LAN/tailnet hear each other. Confirm the
   ICE route returned a working STUN entry; confirm no TURN relay was needed (devtools
   `getStats` → candidate type `host`/`srflx`).
6. **Off-tailnet cellular peer (TURN path):** one peer on cellular off-tailnet joins voice; confirm
   audio flows and `getStats` shows a `relay` candidate (TURN actually used). This is the coturn
   proof.
7. **No regression with voice live:** while voice is live, confirm sync (play/pause/seek stays
   aligned), text chat, reactions, and the shared queue all still work. Confirm `position_ticks`
   remains the single source of truth and the single 0-based timeline is unaffected.
8. **Voice failure isolation:** kill a peer connection / revoke mic mid-session → sync, chat,
   reactions, queue keep working; only voice degrades.
9. **Cap:** with `VOICE_MAX_PARTICIPANTS` reached, the next joiner sees "voice full" and stays
   text-only without error spam.

---

## 10. Explicitly OUT OF SCOPE for v1

- **Video / camera.** Audio only. `camera=()` stays in Permissions-Policy.
- **SFU / server-side media routing.** Full-mesh only; SFU is the documented later scale seam.
- **Noise suppression / echo cancellation beyond the browser defaults** (we pass
  `echoCancellation/noiseSuppression/autoGainControl: true` constraints and rely on the browser; no
  custom DSP).
- **Recording, transcription, or persistence of voice.** Voice is ephemeral; nothing is stored.
- **Per-peer volume mixing UI / spatial audio.** Each remote is a plain `<audio>` element at full
  volume in v1 (self-mute + leave are the only controls).
- **TURN over TLS (`turns:` / 5349) and TURN REST auth rotation automation.** v1 uses ephemeral HMAC
  creds over plain TURN 3478; TLS relay and automated secret rotation are follow-ups.
- **Reconnect/renegotiation hardening beyond basic ICE restart.** v1 tears down and re-dials a peer
  on connection failure rather than full ICE-restart negotiation.
- **Push-to-talk, voice activity gating on the wire.** Speaking indicator is local-only display; the
  mic stream is continuous while live (self-mute is `track.enabled=false`).

---

## 11. Risk register

| Risk | Mitigation |
| --- | --- |
| `Permissions-Policy microphone=()` silently blocks mic | First config change; verified in edge-test step 2 |
| Voice failure cascades into sync | Separate `usePartyVoice` hook; voice rides a transport seam on the one socket but owns all its own state/teardown |
| Full-mesh melts phones at scale | `VOICE_MAX_PARTICIPANTS=6` cap; SFU seam documented |
| TURN secret leakage | Ephemeral HMAC creds only; long-lived secret server-only; STUN-only fallback if unset |
| Open relay port is outside the WAF | Intentional + documented; coturn locked down (auth-secret, denied-peer-ip, quota, narrow port range) |
| ICE trickle bursts trip rate limit | Dedicated high `voice` bucket (120/10s) under the 200 overall ceiling |
| Mic left in-use after leave | Mandatory `track.stop()` on every exit path; edge-test step 4 |

---

## 12. Implementation checklist (fill in as built)

- [ ] 1. constants.ts
- [ ] 2. types.ts
- [ ] 3. server.ts relay + voiceMembers
- [ ] 4. /api/party/ice route
- [ ] 5. voice-support.ts
- [ ] 6. usePartyVoice hook (+ usePartySync transport seam)
- [ ] 7. VoiceBar.tsx
- [ ] 8. member presence speaking indicator
- [ ] 9. voiceEnabled preference
- [ ] 10. next.config.ts (Permissions-Policy + connect-src)
- [ ] 11. coturn edge service + turnserver.conf
- [ ] 12. docs (FEATURES / CHANGELOG / BACKLOG / CLAUDE.md pointer / env)
