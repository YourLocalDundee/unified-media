# Party Play — Implementation Audit (v0.9.5)

> **STATUS: ALL FINDINGS REMEDIATED.** Every Critical/High/Medium/Low item below was fixed in a
> follow-up pass (10 agents, one file group each); `tsc --noEmit` and the production build are clean.
> The one deferred item is L5 (explicit Caddy idle timeout), which is addressed only if the mandated
> off-tailnet cellular idle test shows BunkerWeb reaping the socket. The findings are retained below as
> the record of what was audited and fixed. New tuning/limit constants live in
> `src/lib/party/constants.ts`.

Audit of the native watch-together / party-play feature documented in CLAUDE.md section 16
and specified in `PARTY_PLAY_SPEC.txt`.

- **Method.** Ten parallel read-only audits, one per domain (durable DB, REST, state store,
  WS connection layer, WS command pipeline, client hook, player integration, UI components,
  cross-cutting security, spec-compliance/infra). Findings below are deduplicated and
  re-ranked by consolidated severity. Where two independent auditors reported the same
  issue it is marked **[consensus]**.
- **Build status.** `npx tsc --noEmit` is clean. The production build compiles. All 22 timing
  constants match the spec exactly, the eight-emoji reaction set is exact, and every stated v1
  non-goal is respected.
- **Deployment status.** The feature is **built, committed (branch `feat/party-play`), and
  deployed live** behind Caddy on `unified.minijoe.dev`. Note the endpoint traverses a path where
  several BunkerWeb WAF features are disabled for this domain (CrowdSec, ModSecurity, blacklist,
  DNSBL — see CLAUDE.md §7), so the application is the primary line of defense.

## Verdict

The handshake authentication, the per-message membership-check skeleton, server-stamped chat
identity, parameterized SQL, host-only end-party, and the client's three-action-origins
separation are all correctly built. **However, the message bodies behind the auth gate are
trusted without validation, and the endpoint is missing several controls that a public-internet
WebSocket needs.** Two Critical issues and a cluster of High issues should be fixed before the
feature is used in earnest. None require architectural change — they slot into `handleMessage`,
the upgrade handler, `reconcileDrift`, the four REST routes, and the client hook.

## Severity summary

| # | Severity | Area | Issue | Location |
|---|---|---|---|---|
| C1 | Critical | WS security | Inbound message fields (`positionTicks`, `action`, `text`, `playbackRate`, `clientTime`) are unvalidated — one member can corrupt every player and poison the SQLite checkpoint | `server.ts` handleControl/heartbeat/chat |
| C2 | Critical | WS sync | Median reconciliation assigns `positionTicks = median` unconditionally, dragging the authoritative timeline backward (violates the high-water-mark guard) **[consensus]** | `server.ts` reconcileDrift (~346) |
| H1 | High | WS security | No `Origin` check on the WS upgrade → Cross-Site WebSocket Hijacking | `server.ts` upgrade handler |
| H2 | High | WS security | Session never re-validated on long-lived sockets → expired/suspended/revoked users keep control | `session.ts` / `server.ts` |
| H3 | High | WS security | No per-message rate limiting → chat/reaction/control/heartbeat flooding DoS | `server.ts` handleMessage |
| H4 | High | WS security | No resource caps (sockets/parties/members per user) → memory/CPU exhaustion | `server.ts` registry |
| H5 | High | WS authz | Membership check falls back to durable DB row → a never-joined / left / evicted socket can drive party state **[consensus]** | `server.ts` isMember (~378) |
| H6 | High | Client | `reseek` timer is untracked/uncleared → fires into a torn-down or replaced `<video>`; leaks | `usePartySync.ts` (~237) |
| H7 | High | Client | Two-phase late-join second seek is not implemented (post-`canplay` reseek is a no-op) → late joiners strand behind | `usePartySync.ts` onCanPlay (~329) |
| H8 | High | WS resilience | ws ping/pong miss accounting is off-by-one → dead peer evicted in ~60s not ~40s; grace window starts late | `server.ts` pingSweep (~752) |
| M1 | Medium | WS sync | Repeated play presses reset `pendingPlay.requestedAt` → the 20s readiness-gate timeout can never fire | `server.ts` handleControl (~274) |
| M2 | Medium | WS sync | Debounce record (`lastCommand`) is read/written outside the per-party lock → simultaneous pause-war is not collapsed | `server.ts` handleControl (~253) |
| M3 | Medium | WS sync | Drift compares a `now`-extrapolated reference against stale (≤5s old) member reports → false-positive hard reseeks on >2-member parties | `server.ts` reconcileDrift (~352) |
| M4 | Medium | WS lifecycle | `partyEvents.on('ended')` is registered without idempotence → can double-register / leak across module re-eval | `server.ts` (~933) |
| M5 | Medium | Client | `onopen` resets the reconnect counter → a socket that opens then immediately closes produces a tight 0ms reconnect loop | `usePartySync.ts` (~414) |
| M6 | Medium | Client | Heartbeat reports the transient nudged `playbackRate` instead of the room rate → drift oscillation | `usePartySync.ts` (~386) |
| M7 | Medium | Client | Rate-nudge is restored to 1.0 only when the next STATE arrives (≤10s) → sawtooth overshoot | `usePartySync.ts` (~181) |
| M8 | Medium | Client | `applyingRemoteState` resets on a microtask while `play()` resolves on a later macrotask → potential intent leak (mitigated: the player never derives intents from element events) | `usePartySync.ts` (~121) |
| M9 | Medium | REST | `await req.json()` is unguarded on create/join → a malformed/empty body returns 500 instead of 400 | `api/party/route.ts`, `join/route.ts` |
| M10 | Medium | REST/DB | Last-member-out leave is not atomic (mitigated by the synchronous single writer + idempotent end) | `[partyId]/leave/route.ts` |
| M11 | Medium | DB | FK relationships are comment-only despite `foreign_keys=ON` → deleting a user/media row orphans party rows | `migrations.ts` |
| M12 | Medium | REST security | No `verifyOrigin` on the party REST routes (mitigated by `SameSite=lax`; inconsistent with the app's auth routes) | `api/party/**` |
| M13 | Medium | WS security | Join-by-code is open and brute-forceable (~36^6), and GET 404-vs-403 lets a non-member probe party existence | `join/route.ts`, `[partyId]/route.ts` |
| M14 | Medium | UI | Copy-link has no fallback and a silent empty catch → fails silently on non-secure contexts / older mobile | `PartyPanel.tsx` (~53) |
| M15 | Medium | UI | Chat auto-scroll fires unconditionally → yanks a user who scrolled up back to the bottom | `ChatPanel.tsx` (~32) |
| M16 | Medium | UI | Reaction client id uses `ts + Math.random()` → collisions under spam cause stuck/dropped reactions and React key warnings | `usePartySync.ts` (~272) |
| M17 | Medium | UI | `ReactionOverlay` timers are cleared only on unmount, not when an id leaves the array | `ReactionOverlay.tsx` (~35) |
| M18 | Medium | Store | `endParty` deletes the per-party lock entry mid-chain → breaks serialization for in-flight `updateParty` (latent until the future async backing store) | `in-memory-store.ts` (~178) |
| M19 | Medium | REST | `joinUrl` emits the literal `undefined/play/...` if `NEXT_PUBLIC_APP_URL` is unset | `api/party/route.ts` (~48) |
| L1 | Low | DB | `idx_watch_parties_code` duplicates the `UNIQUE(join_code)` index | `migrations.ts` |
| L2 | Low | DB | `generateUniqueJoinCode` has an uncapped retry loop (no realistic risk at 36^6) | `db.ts` (~66) |
| L3 | Low | Player | Frame-step keys (`,` / `.`) bypass party sync and nudge only the local client | `VideoPlayer.tsx` (~676) |
| L4 | Low | WS security | `force_pw_change` is not consulted on socket auth (HTTP path enforces it) | `session.ts` |
| L5 | Low | Infra | The `@partyws` Caddy route has no explicit long read/idle timeout (pending the mandated cellular idle test) | `Caddyfile` |
| L6 | Low | UI a11y | `JoinByCodeModal` has no Escape/backdrop close, no focus trap, and Enter can double-submit while loading | `JoinByCodeModal.tsx` |
| L7 | Low | UI | Chat length cap is input-only (`maxLength`), not enforced in `submit()` | `ChatPanel.tsx` (~37) |
| L8 | Low | Store | `getChatBacklog` copies the array but shares message object references | `in-memory-store.ts` (~158) |
| L9 | Low | Client | `pong` RTT has no sanity clamp → a wild echoed `clientTime` can poison the clock-offset EMA | `usePartySync.ts` (~279) |
| L10 | Low | Client | `connectionState` initializes to `'connecting'` and never resolves when `enabled=false` | `usePartySync.ts` (~90) |

## Critical findings (detail)

### C1 — Inbound message bodies are trusted without validation

`handleControl`, the heartbeat handler, and the chat handler read attacker-controlled JSON from a
public socket and use the fields directly:

- `s.positionTicks = msg.positionTicks` in the play/pause/seek paths, with no
  `Number.isFinite` / range check. A member can send `positionTicks: 1e308`, `NaN`, or a string.
  The value is broadcast to every client as authoritative `state`, fed into `extrapolatePosition`
  and `medianReportedPositionTicks`, and written to SQLite via `checkpointParty` — which then
  rehydrates on restart. `Math.round(NaN)` is `NaN`; an overflowed value corrupts the INTEGER
  column.
- `control.action` is matched as `play` / `pause` / `else (seek)`. Any unknown `action` silently
  falls into the seek branch and moves the room.
- `chat.text` is `(msg.text ?? '').trim()` with no `typeof === 'string'` guard, so a numeric
  `text` throws (swallowed, message dropped) — confirming inputs are unguarded.

**Impact.** One party member can desync or freeze every other member's player, poison the median
reconciliation, and write garbage into the durable checkpoint. **Fix.** A single validation pass
in `handleMessage`, keyed by `type`: reject unless `Number.isFinite(positionTicks) && positionTicks
>= 0 && positionTicks <= cap`, restrict `action` to the three-value allowlist, require
`typeof text === 'string'`, and validate `playbackRate` / `clientTime` are finite.

### C2 — Median reconciliation drags the authoritative timeline backward **[consensus]**

In `reconcileDrift`, when more than two members are connected the code assigns
`s.positionTicks = median` unconditionally whenever the gap exceeds the deadband. The spec's
high-water-mark guard (spec lines 239–252) requires that the canonical timeline never moves
backward from client reports. If several members are buffering and the median is below the current
extrapolated position, this snaps the authoritative position — and therefore every in-sync client —
*backward*, which is the room-wide rubber-band the guard exists to prevent. It also overwrites
`lastTickWallClock = now` while hard-setting the raw median, discarding the forward extrapolation
accumulated since the last tick.

**Fix.** Make the reconciliation forward-only:
`const target = Math.max(median, reference); if (target > s.positionTicks) { s.positionTicks = target;
s.lastTickWallClock = now }`. The median can then pull the room toward consensus without ever
reversing the clock.

## High findings (detail)

- **H1 — No Origin check on the WS upgrade.** The upgrade handler validates path + cookie but never
  inspects `req.headers.origin`. Browsers send the ambient `unified-session` cookie on cross-origin
  WS upgrades and do not apply SameSite to the handshake, so any site a logged-in user visits can
  open `wss://unified.minijoe.dev/api/party/ws` and, with a known/guessed `partyId`, act as the
  victim. **Fix.** Reject upgrades whose `Origin` is not the app origin (prod + dev), `socket.destroy()`
  on mismatch.
- **H2 — Sockets are never re-authorized.** `lookupPartySession` runs once at upgrade; the socket
  then lives indefinitely (kept alive by heartbeat/ping). An expired, rotated, suspended
  (`is_active=0`), demoted, or explicitly revoked session keeps full rights for hours. **Fix.**
  Capture `sessionId` on the socket entry and re-run `lookupPartySession` periodically (e.g. in the
  ping sweep) and/or on each `control`/`chat`; close on failure.
- **H3 — No per-message rate limiting.** Reactions fan out O(members) with no coalescing; chat and
  control each do O(members) work; control spam forces a SQLite checkpoint per applied command,
  hammering the single writer the design is trying to protect. **Fix.** A per-socket token bucket per
  message class (reactions/chat a few per second, heartbeat dropped if faster than the interval).
- **H4 — No resource caps.** One account can open unlimited sockets, and nothing caps members per
  party or total live parties. **Fix.** Cap concurrent sockets per user, members per party, and total
  parties; reject past the cap (server-side — client backoff is not a control).
- **H5 — Membership auth trusts the durable DB row. [consensus]** `isMember` returns true if the
  user is in the live members map *or* `isActiveMember` (durable). So a socket that authenticated at
  upgrade but never sent `join`, or a user who left/was evicted, can still send `control`/`chat` for
  any party their account has a DB row in — without appearing in the member list. **Fix.** For an
  established socket, require live membership on *this* socket
  (`entry.partyId === partyId && state.members.get(userId)?.socketId === entry.id`); keep the durable
  fallback only for the `join` claim step.
- **H6 — Client `reseek` timer leak.** The `state` transition uses a tracked, cleared timer ref, but
  the `reseek` handler arms a bare `setTimeout` with no ref, no clear-on-reschedule, and no unmount
  cleanup. A reseek scheduled with 300ms headroom can fire after unmount/reconnect and mutate a stale
  or different `<video>`. **Fix.** Track it in a ref, clear before scheduling and in the unmount
  cleanup, alongside `transitionTimerRef`.
- **H7 — Two-phase late-join is incomplete.** The spec's late-joiner flow seeks to the snapshot,
  then on `canplay` re-reads the now-current authoritative position and seeks again, reporting ready
  only after that second seek. The code sets `pendingPostJoinReseekRef` but `onCanPlay` just clears
  the flag and reports ready — identical to the normal path, no second seek. Late joiners are stranded
  at the stale snapshot position and rely on the slow rate-nudge to converge (hard reseek is suppressed
  during the settle window). **Fix.** Retain the last snapshot in a ref; on `canplay` when the flag is
  set, re-extrapolate to `now+offset`, seek inside `withRemoteApply`, then report ready.
- **H8 — Pong-miss off-by-one.** The ping sweep sets `isAlive=false` and pings each round, but the
  miss counter only increments on the round *after* `isAlive` is already false, so eviction takes ~3
  sweeps (~60s at 20s interval) instead of the intended 2 misses (~40s). Because the `close` handler
  (and thus the 30s grace window) only runs after `terminate()`, grace effectively starts ~20s late.
  **Fix.** Increment `missedPongs` in the same sweep a non-pong is detected, terminate at the limit,
  and only ping OPEN sockets.

## Notable medium findings

- **M1 — Readiness-gate timeout can never fire.** A held play stores `pendingPlay.requestedAt = now`,
  but every repeat play press while held overwrites it with a fresh `now`, pushing the 20s deadline
  forward indefinitely. A user mashing play on a slow transcode keeps the gate open forever. **Fix.**
  Preserve the original `requestedAt` when a `pendingPlay` already exists.
- **M3 — False-positive reseeks.** On the reconcile branch the reference is extrapolated to `now`
  while member `reportedPositionTicks` are up to 5s stale, so an in-sync member can show ~5s of
  phantom drift and get a hard reseek (segment refetch + stutter). **Fix.** Compare like with like —
  extrapolate each member's report forward by `(now - lastHeartbeat)`, or compare raw against raw in
  both branches.
- **M9 — Unguarded `req.json()`** returns a 500 (noisier/leakier) instead of the intended 400 for an
  empty/malformed body. **Fix.** `await req.json().catch(() => null)` then treat null as the 400 path.
- **M11 — FKs are comment-only** while `foreign_keys=ON`, so the documented relationships are not
  enforced; deleting a user (the admin flow exists) orphans `watch_party_members` / `host_user_id`.
  **Fix.** Add real `FOREIGN KEY ... REFERENCES` clauses (optionally `ON DELETE CASCADE` for members)
  or state explicitly that FKs are logical-only here.
- **M14–M17 — UI ephemeral paths.** Copy-link fails silently on non-secure contexts (add an
  `execCommand` fallback + visible error); chat auto-scroll should only fire when the user is already
  near the bottom; reaction ids should use `crypto.randomUUID()` to avoid same-millisecond collisions;
  reaction timers should be reconciled when an id leaves the array, not only on unmount.

## Verified correct (no action needed)

- **Spec compliance.** All 22 timing/tolerance constants match the spec exactly; the eight-emoji
  reaction set is exact; tick math is correct.
- **v1 non-goals respected.** Control is shared (no host gate on play/pause/seek; host-only is limited
  to end-party); chat is never written to SQLite; reactions have no backlog and no store method; the
  reaction set is fixed at eight; only the in-memory store exists behind the `PartyStateStore` seam
  (no distributed backing built).
- **Security positives.** SQL is fully parameterized everywhere; chat/reaction `id`, `ts`, and sender
  identity are server-stamped (client-supplied identity ignored); reaction emoji is allowlist-checked;
  end-party is host-only and checked server-side; the handshake `socket.destroy()`s invalid sessions
  before completing the upgrade; `state` snapshots expose only `userId/displayName/ready/connectionState`
  and never serialize `graceTimer`, the raw Map, session ids, or secrets.
- **No XSS.** No `dangerouslySetInnerHTML`; chat text and display names render as escaped JSX text.
  React keys are stable (`m.id`, `userId`, `r.id`).
- **Player integration is regression-safe.** Only genuine user-action surfaces (play toggle, scrubber
  commit, keyboard) emit intents; `<video>` element events never emit intents (no `onSeeked` handler
  exists); every party branch is gated behind `partyId`; the existing direct-play / HLS / quality /
  audio-track / subtitle / resume / `reportProgress` / `position_ticks` paths are untouched and not
  reordered.
- **Durable + store correctness.** The migration is idempotent and schema-exact; `createPartyRow` is
  transactional; member upsert/reactivation is idempotent; the `updateParty` per-party promise-chain
  lock serializes mutations and releases on the error path; `extrapolatePosition`,
  `medianReportedPositionTicks`, and the tick helpers are mathematically correct; the store-layer
  heartbeat never moves authoritative position (the C2 violation is in `reconcileDrift`, not the store).
- **Pipeline correctness.** `commandSeq` is monotonic and increments only on applied commands; the
  asymmetric `effectiveAt` leads (1000 play / 300 control) are correct; the keepalive uses
  `effectiveAt == serverTime`; checkpoint throttling and forced-on-pause/seek/join are correct.
- **Build.** `tsc --noEmit` is clean.

## Remediation roadmap (recommended order)

1. **Input validation pass** (C1, C2-adjacent, M9, plus the `text`/`action` guards) — one function in
   `handleMessage`. Highest impact, lowest effort.
2. **Forward-only median reconciliation** (C2) — a two-line clamp in `reconcileDrift`.
3. **Edge auth hardening** — Origin check at upgrade (H1) and live-socket session re-validation (H2).
4. **Abuse controls** — per-message rate limiting (H3) and per-user resource caps (H4).
5. **Membership authority** (H5) — prefer the live members map for established sockets.
6. **Client robustness** — track/clear the reseek timer (H6), implement the two-phase second seek (H7),
   fix the reconnect-storm reset (M5), report the room rate not the nudged rate (M6).
7. **Resilience timing** — pong-miss off-by-one (H8) and readiness-gate deadline preservation (M1).
8. **REST + DB hardening** — `verifyOrigin` on the four routes (M12), atomic last-member leave (M10),
   real FK constraints (M11), `joinUrl` fallback (M19).
9. **UI polish** — copy-link fallback (M14), auto-scroll guard (M15), reaction id uniqueness (M16),
   reaction timer reconciliation (M17), modal a11y (L6).

## Appendix — per-domain verdicts

| Domain | Verdict |
|---|---|
| Durable DB / migrations | Sound; one non-atomic-leave and FK-enforcement gap |
| REST lifecycle | Solid and spec-faithful; fix the unguarded `req.json()` |
| State store / position math | Correct; the one real bug (C2) lives in `reconcileDrift`, not the store |
| WS connection / auth / lifecycle | Not ship-ready public: fix pong-miss, listener idempotence, membership fallback |
| WS command pipeline / sync | Close to spec; C2 (backward median) and M1 (gate deadline) are real bugs |
| Client hook | Ship-blocking reseek-timer leak (H6) + unimplemented two-phase join (H7) |
| Player integration | No Critical/High; regression-safe, only Low polish |
| UI components | No XSS; fix copy-link, reaction-id, auto-scroll before real use |
| Cross-cutting security | Not production-safe as-is; C1/H1–H4 are the priority |
| Spec compliance / infra | Fully compliant; constants exact, non-goals respected, build clean |
