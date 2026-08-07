# Party Play (Watch-Together) — Audit A5 (2026-06-13)

READ-ONLY audit of the native watch-together feature: `src/lib/party/**`,
`src/hooks/usePartySync.ts`, `src/app/api/party/**`, `src/components/party/**`, and the
`VideoPlayer` integration. Three lenses: real-time sync correctness, button/interaction
wiring, and resource/leak optimizations.

## Summary

The prior `PARTY_PLAY_AUDIT.md` claimed "2 Critical, 8 High, 19 Medium, 10 Low" remediated.
**That claim holds up: the high-value fixes genuinely landed.** Input validation (C1), the
forward-only median clamp (C2), Origin check (H1), periodic session re-validation (H2),
per-socket rate limiting (H3), resource caps (H4), live-membership authority (H5), the
tracked reseek timer (H6), the two-phase late-join second seek (H7), the same-sweep pong
accounting (H8), readiness-gate deadline preservation (M1), in-lock debounce (M2), the
reaction-id UUID (M16), the reaction-timer reconciliation (M17), real FK constraints (M11),
the atomic last-member leave (M10), `verifyOrigin` on all routes (M12), and the copy-link
fallback (M14) are all present and correct in code.

The server-authority pipeline is sound: server is the single source of truth, clients send
intents and render only broadcast `state`, `commandSeq` is monotonic, host-disconnect does
NOT end the party (only last-member-out or host DELETE does), and a guest cannot hijack host
control (DELETE is host-checked server-side; `selfUserId` is server-resolved and only used
for UI). The structural anti-echo guarantee is intact: the `<video>` element handlers
(`handlePlay`/`handlePause`/etc.) only update local UI and never call `sendIntent`; intents
come exclusively from user-action surfaces.

What remains is mostly **integration completeness and a few small correctness/UX gaps**, not
the security/sync ship-blockers the prior pass fixed. The standout is **A5-01: the
`JoinByCodeModal` "join with code" affordance is never mounted anywhere** — the only working
join path is the one-tap `?party=` link, leaving a spec-required entry point dead. Two
MEDIUM items concern media-mismatch on join and a heartbeat/reconcile read outside the lock.

### Counts by severity

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 5 |
| Low | 6 |
| **Total** | **12** |

---

## High

### A5-01 — "Join with code" affordance is never wired; only the link join works
- **Severity:** High
- **File:** `src/components/party/JoinByCodeModal.tsx` (whole file); consumed by nobody.
  `grep -rln JoinByCodeModal src/` returns only the component's own file.
- **What's wrong:** `JoinByCodeModal` is fully built (calls `joinParty({joinCode})`, has
  Escape/backdrop close, Enter-submit guard, error state) but is **not imported or mounted in
  any page, nav, or the player**. The only join entry point that exists is the auto-join from
  a `?party={code}` URL in `VideoPlayer` (`src/components/media/VideoPlayer.tsx:170-194`).
  `StartPartyButton` is mounted only inside the player (you must already be watching the item
  to start a party), and there is no manual code-entry surface on home or in nav.
- **Why it matters:** The spec explicitly requires "A 'Join with code' affordance accessible
  from the player or home for manual code entry" (PARTY_PLAY_SPEC.txt:759) as one of the two
  join methods. A user handed a 6-char code (not a link) has no way to enter it. Half the
  documented join UX is non-functional. It also means dead, untested UI is shipping.
- **Suggested fix:** Mount `JoinByCodeModal` behind a "Join watch party" button on the home
  dashboard and/or in the player controls, wiring `onJoined` to navigate to
  `/play/${mediaId}?party=${joinCode}` so the correct media loads (see A5-02).

---

## Medium

### A5-02 — Manual/link join to a party for a *different* media item does not navigate the player
- **Severity:** Medium
- **File:** `src/components/media/VideoPlayer.tsx:177-185` (auto-join sets `partyMediaId =
  joined.mediaId` but never navigates); would also affect any future `JoinByCodeModal` wiring.
- **What's wrong:** On auto-join the handler does `setPartyMediaId(joined.mediaId)` but the
  player keeps rendering `itemId` (the page's `[id]`). The spec says "If the party is for a
  different media item than the client currently has open, the client navigates to the party's
  mediaId" (PARTY_PLAY_SPEC.txt:404, 755-757). For the link path the URL already encodes the
  right `[id]`, so they normally match — but nothing *enforces* it. If a code/link is entered
  for a party watching item B while the player shows item A, the user syncs play/pause/seek
  state against a video they are not watching: their `currentTime` drives an unrelated file,
  drift reseeks fire against the wrong content, and the panel link advertises `partyMediaId`
  while the `<video>` plays `itemId`.
- **Why it matters:** Silent, confusing desync; the readiness gate and drift math operate on
  mismatched timelines. The guard is cheap and the spec mandates it.
- **Suggested fix:** After resolving the join, if `joined.mediaId !== itemId` then
  `router.push(\`/play/${joined.mediaId}?party=${joinCode}\`)` instead of activating sync in
  place. Wire the same check into the `JoinByCodeModal` `onJoined` handler.

### A5-03 — Heartbeat mutates member state outside the per-party lock that `reconcileDrift` reads
- **Severity:** Medium
- **File:** `src/lib/party/in-memory-store.ts:136-146` (`heartbeat` writes
  `reportedPositionTicks`/`lastHeartbeat` directly, no `updateParty`); read back in
  `src/lib/party/server.ts:374-435` (`reconcileDrift`) and `src/lib/party/server.ts:286-353`
  (the debounce/median path).
- **What's wrong:** `heartbeat()` deliberately bypasses the `updateParty` critical section
  "to avoid storming subscribers." In the v1 single-instance, single-threaded Node runtime
  this is safe for the immediate handler (each socket's `await store.heartbeat` completes
  before `await reconcileDrift`). But `reconcileDrift` itself `await`s `store.updateParty`
  (server.ts:408) for the median clamp; another socket's heartbeat can run at that await point
  and mutate `reportedPositionTicks` between the median computation (server.ts:400) and the
  per-member reseek comparison (server.ts:423-434), so the reseek can be evaluated against a
  member position that no longer matches the median that was just applied.
- **Why it matters:** Low blast radius today (worst case: an occasional spurious or skipped
  reseek to one client). But the file's own comment markets `PartyStateStore` as the
  horizontal-scale seam where a future Redis backing "preserves atomicity" — and this method
  breaks that contract by mutating outside it. A future async backing store will make this a
  real race.
- **Suggested fix:** Either route heartbeat through `updateParty` (without emitting — add a
  no-emit variant), or snapshot the connected members' projected positions once at the top of
  `reconcileDrift` and use that array for both the median and the per-member loop so the read
  is internally consistent.

### A5-04 — `reportProgress`/`reportStart` keep posting watch-state while a remote-applied pause is in flight
- **Severity:** Medium
- **File:** `src/components/media/VideoPlayer.tsx:754-764` (`handlePlay` starts a 10s
  `reportProgress` interval) and `:335-346` (`reportProgress`), active regardless of
  `partyActive`.
- **What's wrong:** Party mode leaves the existing `reportProgress` interval and
  `reportStart` untouched (correct per spec — `position_ticks` stays the single source of
  truth). The subtlety: when the server pauses the room, the client pauses via `playRemote`/
  `v.pause()` under `applyingRemoteStateRef`, firing the element `pause` event →
  `handlePause` (UI only, fine). But the 10s progress interval reads `vid.paused` at an
  arbitrary moment; during the `effectiveAt - offset` scheduling window the local element may
  still be playing while the room is paused, so a `played:false`/position report can land
  mid-transition. This is not a sync-correctness bug (party state is authoritative), but it
  can write a slightly-ahead `position_ticks` for continue-watching that differs from the
  party's checkpoint.
- **Why it matters:** Minor: continue-watching position for a party participant can be a
  second or two off from the room. No desync of the party itself.
- **Suggested fix:** Acceptable as-is for v1; if tightened, gate the progress report on
  `!partyActive || !applyingRemoteStateRef.current`, or have party mode source its progress
  report from the authoritative snapshot rather than `video.currentTime`.

### A5-05 — `getPartyInfo` host/member data is fetched once and never refreshed; panel host badge can be stale
- **Severity:** Medium
- **File:** `src/components/media/VideoPlayer.tsx:183-185` (one-shot `getPartyInfo` on
  auto-join) and `handlePartyStarted:203-212` (host set from client `selfUserId`).
- **What's wrong:** `partyHostUserId` and the initial member list come from a single
  `getPartyInfo` call (or, for the starter, from client state). The live member list then
  updates via WS `state` messages (`party.members`), but `hostUserId` is never refreshed. The
  member-list panel keys the Crown/host badge off `partyHostUserId`. Since v1 has no host
  transfer this is usually fine, but the durable `is_host` flag returned by `getMembers`
  (db.ts:94-107) is ignored by the live panel — the panel trusts a value resolved once at
  join. If the auto-join `getPartyInfo` call fails (it is in a separate `try` after the join
  succeeds), `partyHostUserId` stays `null` and the host never sees the "End party for
  everyone" button even though they are the host.
- **Why it matters:** A transient failure of the second fetch silently strips the host's
  end-party control. The leave path still works, so not a lockout, but the documented
  host-only affordance can vanish.
- **Suggested fix:** Carry `hostUserId` (or an `isHost` flag) in the WS `state`/member
  summary so the panel derives host from the authoritative live stream, or retry/surface the
  `getPartyInfo` failure instead of swallowing it.

### A5-06 — Server `chat.text` is capped at `MAX_CHAT_LENGTH` (2000) but the client input caps at 500 — and empty-after-trim chat is silently dropped without feedback
- **Severity:** Medium
- **File:** `src/lib/party/server.ts:687-688` (`slice(0, MAX_CHAT_LENGTH)`, `MAX_CHAT_LENGTH
  = 2000` in constants.ts:72) vs `src/components/party/ChatPanel.tsx:59,119`
  (`maxLength={500}`, `slice(0,500)`).
- **What's wrong:** Two different chat-length ceilings (client 500, server 2000) — harmless
  but inconsistent. More notably, the server's empty-after-trim branch (`if (text.length ===
  0) return`, server.ts:688) and the validation rejections (`sendError('bad_field', …)`)
  produce `error` messages the client only `console.warn`s (usePartySync.ts:402-406); the
  user gets no UI feedback that a message was dropped. The reaction `bad_reaction` and the
  `rate_limited`/`not_member` errors are likewise console-only.
- **Why it matters:** Silent failure surface. A rate-limited chat sender, or a "not a member"
  rejection after an eviction/grace timeout, sees nothing — the message just vanishes. For a
  social feature this is a real UX gap.
- **Suggested fix:** Align the two length caps on one constant; surface `rate_limited` /
  `not_member` / `bad_reaction` server errors to the panel (a transient toast/line) instead
  of console-only.

---

## Low

### A5-07 — Dead code in the durable layer: `markMemberLeft` and `countActiveMembers` are unused
- **Severity:** Low
- **File:** `src/lib/party/db.ts:118-122` (`markMemberLeft`) and `:125-130`
  (`countActiveMembers`). Zero external references (`leaveAndMaybeEnd` superseded them).
- **What's wrong:** Both functions are exported but never called anywhere (verified by grep).
  Leftover from before the atomic `leaveAndMaybeEnd` (M10) consolidation.
- **Why it matters:** Dead surface area; a future caller might use `markMemberLeft` and
  reintroduce the non-atomic last-member race the M10 fix eliminated.
- **Suggested fix:** Delete both, or add a comment that `leaveAndMaybeEnd` is the only
  supported leave path.

### A5-08 — `MAX_POSITION_TICKS` is a fixed 24h cap, not the media's duration
- **Severity:** Low
- **File:** `src/lib/party/constants.ts:71` (`MAX_POSITION_TICKS = 86_400 * TICKS_PER_SECOND`);
  enforced in `src/lib/party/server.ts:442-444` (`isValidPosition`).
- **What's wrong:** Inbound `positionTicks` is validated against a global 24h ceiling, not the
  actual item length. The C1 fix correctly rejects `NaN`/`Infinity`/negative/oversized, but a
  member can still seek/heartbeat to any value up to 24h regardless of the real runtime, and
  that value is broadcast as authoritative and checkpointed.
- **Why it matters:** Minor — the player clamps `currentTime` to `duration` locally, and the
  504/linear-transcode seek limit (a documented v1 non-goal) bounds real playback. Mostly a
  cosmetic/telemetry concern, not exploitable into corruption (the 24h cap protects the
  INTEGER column).
- **Suggested fix:** Optional: the server does not know media duration in the WS process;
  acceptable to leave the coarse cap. If tightened, pass duration into the live state at
  create time and clamp against it.

### A5-09 — Reaction fan-out is unbounded per window (30/10s/socket) and every reaction is O(members)
- **Severity:** Low
- **File:** `src/lib/party/server.ts:709-722` (reaction broadcast) and `:600`
  (`WS_REACTION_MAX_PER_WINDOW = 30`).
- **What's wrong:** Reactions are rate-limited per sender (30 per 10s) but not coalesced; each
  one fans out to all members (`broadcastToParty`, O(members)). With `MAX_MEMBERS_PER_PARTY =
  50` and several spammers at the cap, that is up to ~50 senders × 3/s × 50 recipients ≈ 7500
  sends/s. The prior audit flagged reaction fan-out as the costliest broadcast (its H3 note);
  the per-socket cap mitigates but does not bound the aggregate.
- **Why it matters:** Low for a home server with a handful of viewers; the cap makes abuse
  bounded-but-large. Not a correctness issue.
- **Suggested fix:** Acceptable for v1 scale. If needed, coalesce reactions server-side into a
  short window before fan-out, or lower `WS_REACTION_MAX_PER_WINDOW`.

### A5-10 — Client pings every 10s but the spec/heartbeat cadence is 5s; offset converges slower than designed
- **Severity:** Low
- **File:** `src/hooks/usePartySync.ts:39` (`PING_INTERVAL_MS = 10_000`),
  `:544-546`. Heartbeats also carry `clientTime` (`:539`) so the offset still refines every
  5s via the heartbeat path on the server — but the dedicated `ping`/`pong` RTT sample that
  actually feeds the EMA (`:374-394`) only happens every 10s.
- **What's wrong:** The clock-offset EMA is driven only by `pong` replies (heartbeat
  `clientTime` is sent but the server's heartbeat handler does not reply with a server-time
  echo to refine the client offset — only `ping` gets a `pong`). So the client's offset
  updates every 10s, not every 5s. The spec says "control and heartbeat messages also carry
  clientTime so the server and client keep refining the offset without a dedicated ping every
  time" (PARTY_PLAY_SPEC.txt:507) — but the server only uses `clientTime` to refine *its own*
  view; it never sends a refinement back on heartbeat, so the client offset cadence is the
  ping cadence.
- **Why it matters:** Minor — 10s offset refresh is fine for a stable connection; the EMA and
  the L9 RTT clamp keep it sane. Slightly slower convergence after a network change.
- **Suggested fix:** Either lower `PING_INTERVAL_MS` to 5s, or have the heartbeat handler
  reply with the server time so the client can refine offset on every heartbeat as the spec
  intends.

### A5-11 — `connectionState` UI never distinguishes `grace` for self; a backgrounded tab shows "Connected" until close
- **Severity:** Low
- **File:** `src/hooks/usePartySync.ts:90-95` / the `onclose`→`scheduleReconnect` path
  (`:590-599`); `PartyPanel` connection dot (`PartyPanel.tsx:148-160`).
- **What's wrong:** The hook's `connectionState` is `'connected'` until the socket actually
  closes. A throttled/backgrounded tab whose heartbeats lapse is moved to `grace` *server-side*
  (and other members see the grey dot), but the affected client itself still renders
  "Connected" because its socket has not closed yet. There is no self-grace indication.
- **Why it matters:** Cosmetic only; on real disconnect the reconnect/`reconnecting` state
  shows. The other members' view is correct.
- **Suggested fix:** Optional; could surface server-reported self `connectionState` from the
  member list to the connection badge.

### A5-12 — Reaction overlay caps nothing; a flood within the 10s window stacks many simultaneous floaters
- **Severity:** Low
- **File:** `src/components/party/ReactionOverlay.tsx:19-77`; reactions appended in
  `usePartySync.ts:361-373` with no array cap (unlike chat's `CHAT_CAP`).
- **What's wrong:** Incoming reactions are pushed into `reactions` with a per-id 1.6s expiry
  timer, but there is no upper bound on how many can be on screen at once. Under the allowed
  30/10s/socket × N senders, dozens of floaters can stack in the corner column before they
  age out. Timers are correctly reconciled/cleared (M17 fix verified), so this is purely
  visual density, not a leak.
- **Why it matters:** Cosmetic; the floaters are `pointer-events-none` and self-expire.
- **Suggested fix:** Optional cap on concurrent rendered reactions (e.g. keep the most recent
  ~12), dropping older ones early.

---

## Status of prior PARTY_PLAY_AUDIT findings

Verified against current code. "Fixed" = the described remediation is present and correct.

| ID | Prior title | Status | Evidence |
|---|---|---|---|
| C1 | Unvalidated inbound fields | **Fixed** | `validateMessage` (server.ts:458-573) guards type/range on every field; `maxPayload` cap (server.ts:1141); `MAX_POSITION_TICKS` (constants.ts:71). |
| C2 | Median drags timeline backward | **Fixed** | Forward-only clamp `target = Math.max(median, reference); if (target > positionTicks)` (server.ts:404-414). |
| H1 | No Origin check on upgrade | **Fixed** | `allowedWsOrigins()` allowlist; mismatch → `socket.destroy()` (server.ts:1171-1177). Missing Origin allowed by design (non-browser). |
| H2 | Sockets never re-authorized | **Fixed** | `sessionId` captured (server.ts:1205-1230); periodic `lookupPartySession` in `pingSweep` closes on failure (server.ts:1033-1056); `SESSION_RECHECK_INTERVAL_MS`. |
| H3 | No per-message rate limit | **Fixed** | Per-socket rolling-window `allowRate` (server.ts:580-608) with per-class caps (constants.ts:74-80). |
| H4 | No resource caps | **Fixed** | Sockets/user at upgrade (server.ts:1195-1203), members/party (server.ts:806-808), total parties (server.ts:757-762). |
| H5 | Membership trusts durable row | **Fixed** | `isLiveMemberOnSocket` requires live member with matching `socketId` (server.ts:620-663); durable `isActiveMember` only at the `join` claim. |
| H6 | Reseek timer leak | **Fixed** | `reseekTimerRef` tracked, cleared on reschedule and unmount (usePartySync.ts:334, 626-629). |
| H7 | Two-phase late-join not implemented | **Fixed** | `lastSnapshotRef` + `extrapolateLiveTargetSec` re-seek on `canplay` before reporting ready (usePartySync.ts:438-459, 170-186). |
| H8 | Pong-miss off-by-one | **Fixed** | Miss counted in the same sweep; pings only OPEN sockets (server.ts:1013-1067). |
| M1 | Gate deadline never fires | **Fixed** | `requestedAt` preserved across repeat play presses (server.ts:311-322); periodic-tick force release (server.ts:977-979). |
| M2 | Debounce outside the lock | **Fixed** | `lastCommand` read+written inside `updateParty` mutator (server.ts:286-352). |
| M3 | False-positive reseeks (stale reports) | **Fixed** | `projectReport` extrapolates each member to `now` (server.ts:390-393, 425). |
| M4 | `partyEvents.on('ended')` double-register | **Fixed** | `removeAllListeners('ended')` before re-adding; handler reads runtime via accessor (server.ts:1261-1265). |
| M5 | Reconnect-storm counter reset | **Fixed** | Counter reset only on stable timer / first state/pong via `markConnectionStable` (usePartySync.ts:295-301, 564-586). |
| M6 | Heartbeat reports nudged rate | **Fixed** | Heartbeat sends `authoritativeRateRef.current` (usePartySync.ts:538). |
| M7 | Rate-nudge restored only on next STATE | **Fixed** | Heartbeat tick lifts a stale nudge back to room rate inside the deadband (usePartySync.ts:511-530). |
| M8 | `applyingRemoteState` microtask leak | **Fixed** | `playRemote` holds the flag until `play()` settles (usePartySync.ts:162-168). |
| M9 | Unguarded `req.json()` | **Fixed** | `await req.json().catch(() => null)` on create + join (route.ts:24; join/route.ts:23). |
| M10 | Last-member leave not atomic | **Fixed** | `leaveAndMaybeEnd` single transaction (db.ts:146-165). |
| M11 | FKs comment-only | **Fixed (fresh DB only)** | Real `FOREIGN KEY` clauses + `ON DELETE CASCADE` (migrations.ts:505-521); `foreign_keys=ON` per-connection (db/index.ts:32). Existing deployments keep FK-less tables by design — documented trade-off (migrations.ts:483-491). |
| M12 | No `verifyOrigin` on REST | **Fixed** | `verifyOrigin` on POST create, join, leave, DELETE (route.ts:16; join:15; leave:13; [partyId] DELETE:39). GET is read-only (no mutation). |
| M13 | Join code brute-forceable / 404-vs-403 probe | **Fixed** | Separate fail-bucket rate limit on bad codes (join/route.ts:32-38); GET returns 404 not 403 for non-members ([partyId]/route.ts:24-26). |
| M14 | Copy-link silent fail | **Fixed** | `execCommand` fallback + visible `copyFailed` state + manual-copy input (PartyPanel.tsx:60-99, 135-146). |
| M15 | Chat auto-scroll yanks user | **Fixed** | `NEAR_BOTTOM_THRESHOLD_PX` guard; only follows when near bottom (ChatPanel.tsx:41-47). |
| M16 | Reaction id collisions | **Fixed** | `crypto.randomUUID()` (usePartySync.ts:366). |
| M17 | Reaction timers cleared only on unmount | **Fixed** | Per-id reconciliation when an id leaves the array (ReactionOverlay.tsx:23-45). |
| M18 | `endParty` deletes lock mid-chain | **Fixed** | `endParty` no longer deletes the lock; `updateParty` finally tail reclaims it (in-memory-store.ts:168-186, 85-89). |
| M19 | `joinUrl` literal `undefined` | **Fixed** | Falls back to `new URL(req.url).origin` when env unset (route.ts:50). |
| L1 | Duplicate join-code index | **Fixed** | Removed; relies on `UNIQUE(join_code)` implicit index (migrations.ts:508-510). |
| L2 | Uncapped join-code retry | **Fixed** | `MAX_ATTEMPTS = 20`, throws on exhaustion (db.ts:69-74). |
| L3 | Frame-step keys bypass sync | **Open (by code) / minor** | Frame-step (`,`/`.`) now route through `partySeekTo` (VideoPlayer.tsx:679-687) — actually wired into party sync, so this looks **addressed**, contrary to being deferred. |
| L4 | `force_pw_change` not on socket auth | **Fixed** | `lookupPartySession` excludes `force_pw_change=1` users (session.ts:55-56). |
| L5 | Caddy idle timeout | **Out of scope** | Infra/Caddyfile — not in this code audit's surface; deferred pending the cellular idle test per prior note. |
| L6 | Modal a11y | **Fixed** | Escape + backdrop close, Enter-while-loading guard (JoinByCodeModal.tsx:23-29, 72-74) — though the modal itself is unmounted (see A5-01). |
| L7 | Chat length cap input-only | **Fixed** | `submit()` slices to 500 (ChatPanel.tsx:59); server caps at 2000 (note A5-06 inconsistency). |
| L8 | `getChatBacklog` shares object refs | **Fixed** | Now maps `{ ...m }` shallow copies (in-memory-store.ts:161). |
| L9 | Pong RTT no sanity clamp | **Fixed** | RTT < 0 / > 5000 / non-finite discarded before EMA (usePartySync.ts:380-387). |
| L10 | `connectionState` stuck on connecting | **Fixed** | Initializes to `'ended'` when `!enabled`/`!partyId` (usePartySync.ts:90-95, 481-487). |

**New / regressed since the prior audit:** A5-01 (join-by-code never mounted) and A5-02
(no media-mismatch navigation) are genuine gaps not covered by the prior findings — both are
integration-completeness issues against PARTY_PLAY_SPEC.txt:404,755-759. A5-03 (heartbeat
mutating outside the lock) is a pre-existing design choice the prior audit marked "verified
correct" for v1, but it does undercut the documented scale-seam atomicity contract and is
worth recording.

**Net assessment:** The remediation claim is credible. No Critical or new High-severity
security/sync defect was found; the one High is a missing-UI-wiring completeness gap. The
real-time sync core (authority, ordering, drift, reconnection, host-disconnect handling,
anti-echo) is correct and matches the spec.
