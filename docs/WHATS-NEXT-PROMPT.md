# What's Next — Planning Prompt

Paste the block below into a fresh Claude Code session at the repo root. It carries the full state, the
working conventions, the remaining backlog, and a from-scratch plan for the voice-chat feature. It is a
**planning** prompt — it asks Claude to plan and confirm before building, per Anthropic's
explore → plan → implement → commit workflow.

> Keep this file as the canonical "where we are / what's next." Update STATE and WHAT'S DONE when you
> ship; move shipped items to `docs/complete/FEATURES.md` and out of `docs/incomplete/BACKLOG.md`.

---

```
Resume work on unified-frontend (/home/minijoe/dev/unified-frontend). Read CLAUDE.md and
docs/README.md FIRST, then docs/CLAUDE-MD-GUIDE.md for how we keep context lean. Do not read the
deep-dive docs or analysis/ unless a task needs them — pull them on demand to protect context.

STATE: app at v0.10.2 (app/package.json + CLAUDE.md header). The committed tree is the trimmed-docs
baseline (CLAUDE.md ~485 lines; deep-dives under docs/). Deploy is ALWAYS via compose, never bare
docker build (compose tags compose-unified-frontend:latest):
  docker compose build --no-cache unified-frontend && docker compose up -d --force-recreate unified-frontend

HOW I WORK HERE (carry this the whole session):
- Plan before code. For anything touching >1 file or where the approach isn't a one-sentence diff,
  use plan mode: explore (read files, no edits) -> propose a written plan -> wait for my OK -> implement
  -> commit. For a trivial fix, just do it.
- Build 2 items at a time. After each item run `npx tsc --noEmit` + `npx eslint <files>`; run
  `npm run build` at the end of each pair. Then update the relevant progress doc before moving on so
  work survives a disconnect.
- Verify, don't assert. Show the command you ran and its output (tsc/eslint/build green) as evidence.
  Never report success without the check.
- Use subagents for investigation ("use a subagent to find every call site of X") so codebase reading
  doesn't fill my main context. Cap parallelism — no unbounded subagent fan-out.
- Versioning: SemVer, PATCH before MINOR. Bump 0.0.x for feature batches, 0.x.0 only for a milestone.
- When something ships: add a row to docs/complete/FEATURES.md + a CHANGELOG.md [Unreleased] entry,
  remove it from docs/incomplete/BACKLOG.md, and keep CLAUDE.md lean (deep-dive to docs/, pointer stub
  in CLAUDE.md). If a gotcha is now enforced by lint/a hook, delete its prose from CLAUDE.md §7.
- Code constraints: react-hooks rules are at ERROR (no eslint-disable) — defer setState in effects via
  setTimeout(fn,0); better-sqlite3 is synchronous; Next 16 dynamic route params are Promise<{...}>
  (await them); the qBittorrent proxy is /api/qbit (with an i), /api/qbt 404s.
- Comms: direct, peer-level. No em dashes / colons / semicolons as pauses.

WHAT'S DONE (index: docs/complete/FEATURES.md; chronology: CHANGELOG.md):
- The 5 original build phases + the 7-phase Independence Build (native indexer/automation/request-bridge/
  subtitle/media-server/native-browse/native-requests) are shipped.
- Party Play (v0.9.5) with shared queue + auto-advance (v0.10.0). On-demand subtitle search (v0.9.11).
  Two-mode request system (v0.9.0). Decision engine: hard gates + custom formats (v0.10.0).
- The 2026-06-13 audit is closed (all P0/P1). History: docs/analysis/audit-2026-06-13-summary.md;
  live tracker analysis/open-issues.md.

WHAT'S NEXT (full list: docs/incomplete/BACKLOG.md; proposed extras: docs/incomplete/FEATURE-IDEAS.md):
- FEATURE TO PLAN THIS SESSION: Voice chat in Party Play. Full spec below — plan it first, build only
  after I approve the plan.
- Other buildable backlog: Web Push (VAPID), mobile PWA, Jellyfin user linking, torrent-create dialog,
  piece-map UI, bandwidth quota, movie Collections, theme marketplace, keyboard-shortcut reference,
  bulk session revoke, audit-log CSV export, download-to-browse linking.
- Operational/manual (not headless): 2-browser party auto-advance test + off-tailnet cellular
  /api/party/ws idle test.

=========================================================================================
FEATURE SPEC TO PLAN: Voice chat in Party Play (opt-in, device-gated)
=========================================================================================

GOAL: optional live voice chat for members of a watch party, layered onto the existing party WS the
same way text chat and reactions are. It must be OFF by default, opt-in per user, and must degrade
cleanly to "not available" when the device or browser can't support it. It must NOT regress sync,
text chat, reactions, the queue, or the single-0-based-timeline / position_ticks invariant.

HARD CONSTRAINTS (do not violate — these mirror the existing party design):
- Voice coordinates nothing about playback. It rides ALONGSIDE the player; it must not touch
  transcode/codec/audio-track/subtitle behavior, and position_ticks stays the single source of truth.
- Shared-control model holds: there is no host-only gate on voice; any member may join/leave voice.
- Per-message membership check + field validation on every new WS message, exactly like the existing
  protocol. Re-auth on the SESSION_RECHECK interval applies to voice signaling too.
- Reuse constants.ts as the single source of truth for any new timeouts/caps. No magic numbers inline.

TECH APPROACH (research-backed):
- Transport: WebRTC peer audio (Opus), signaled over the EXISTING party WebSocket (do not stand up a
  second socket). Add signaling message types alongside the current ones rather than a parallel channel.
- Topology decision to make in the plan: full-mesh P2P vs an SFU. For a household party (a handful of
  members) full-mesh is simplest and avoids new server media infra. Recommend full-mesh for v1 and
  document the SFU swap as a later scale seam (mirror how PartyStateStore is the horizontal-scale seam).
- NAT traversal: most LAN/tailnet peers connect with STUN alone, but off-tailnet cellular peers will
  often need a TURN relay. So the plan must include standing up coturn (STUN/TURN) and wiring
  credentials. Treat TURN as required for the off-tailnet case (same population that needed the
  BunkerWeb cellular exceptions). Put coturn in the edge compose stack; do NOT hardcode secrets.
- This is the item BACKLOG flagged as "needs a decision: stand-up-coturn vs defer." We are choosing to
  stand up coturn. Call out the operational cost (a running TURN server, a port, credentials rotation)
  in the plan so it's an informed decision.

DEVICE / BROWSER GATING (the opt-in + capability story):
- Capability detect before offering voice. getUserMedia is only available in a SECURE CONTEXT and only
  if navigator.mediaDevices?.getUserMedia exists. On http or an unsupported browser, navigator.mediaDevices
  is undefined. Gate the entire voice UI on a hasVoiceSupport() check (secure context + mediaDevices +
  getUserMedia + at least one audioinput from enumerateDevices). If unsupported, show a disabled "Voice
  not available on this device" state, never a broken button.
- Permission is per-user and explicit. Voice is OFF until the user toggles it on; only then do we call
  getUserMedia({audio:true}) which triggers the browser mic prompt. Handle the three failure modes
  distinctly: NotAllowedError (user/OS denied — show how to re-enable), NotFoundError (no mic — show
  "no microphone found"), and the promise that never resolves (user ignored the prompt — timeout the
  "connecting" state). Always stop the stream tracks on leave/unmount to release the mic and clear the
  in-use indicator.
- iOS/Safari and OS-level mic permission (macOS especially) are real gotchas — plan for getUserMedia
  rejecting even when the API exists, and surface an actionable message rather than a spinner.

UX:
- A mic toggle in the PartyPanel, only rendered when hasVoiceSupport() is true. States: off / requesting
  permission / live (with mute) / error. Per-member voice presence + speaking indicator (reuse the
  presence the party already broadcasts). A self-mute that's instant and local (track.enabled=false),
  separate from leaving voice. Respect a global "I never want voice" user preference (store like the
  existing playback prefs) so a user is never prompted.
- Voice availability is independent of text chat / reactions — a user can be in the party, in text chat,
  and NOT in voice. Joining voice is a deliberate second step.

WIRING / FILES (follow the existing party structure):
- Signaling types in src/lib/party/types.ts (offer/answer/ICE-candidate/voice-join/voice-leave/
  voice-mute), client-safe + validated like every other message.
- New constants in src/lib/party/constants.ts (ICE servers config shape, voice caps, connecting timeout).
- Server: extend src/lib/party/server.ts to relay signaling (membership-checked, rate-limited per the
  existing per-type limits) — the server stays a dumb relay, it does NOT handle media.
- Client: a usePartyVoice hook (sibling to usePartySync) owning the RTCPeerConnection mesh, local
  stream lifecycle, and per-peer audio elements. usePartySync stays focused on playback sync; voice is
  a separate hook so a voice failure can never break sync.
- UI in src/components/party/* (a VoiceBar / mic control + per-member speaking dots).
- Edge: coturn service in /opt/docker/compose/edge/ (or wherever the edge stack lives), TURN creds via
  env, ICE server list delivered to the client from a server route (never bake static long-lived TURN
  creds into client JS — use short-lived credentials if practical).
- CSP: widen connect-src / add the TURN/STUN hosts as needed in next.config.ts, the same way the party
  WS origins were added.

ACCEPTANCE / VERIFY:
- tsc + eslint + build green (the standard gate).
- Capability gate proven: on an unsupported/insecure context the voice UI shows the disabled state and
  never calls getUserMedia.
- Opt-in proven: no mic prompt until the user toggles voice on; declining permission yields a clear
  error, not a spinner; leaving voice releases the mic (in-use indicator clears).
- Two-peer voice on the LAN/tailnet (STUN path) and at least one off-tailnet cellular peer through TURN
  — this is the manual edge test, same population as the existing party cellular idle test. Confirm
  sync, text chat, reactions, and the queue all still work while voice is live.
- No regression to position_ticks / single-timeline behavior.

DELIVERABLE FOR THIS STEP: do NOT write feature code yet. First produce the plan:
1) Confirm the build is currently green (run the gate, show output).
2) Use a subagent to map the exact current party WS message-handling + membership-check + per-type
   rate-limit code in src/lib/party/server.ts and the usePartySync hook structure, and report back.
3) Write the implementation plan to docs/incomplete/voice-chat-plan.md: the topology decision
   (full-mesh vs SFU) with your recommendation, the coturn deployment steps, the new message types,
   the capability-gate + permission state machine, the file-by-file change list, the CSP/env changes,
   and the manual edge-test procedure. State what is explicitly out of scope for v1 (e.g. video, SFU,
   noise suppression beyond the browser default).
4) Stop and wait for my approval of the plan before implementing. After approval, build in 2-item
   chunks with the gate after each, updating docs/incomplete/voice-chat-plan.md as you go.

Start now with steps 1 and 2, then write the plan (step 3) and stop.
```

---

## Why it's shaped this way (notes for you, not for the paste)

- **Planning-first, not build-first.** Anthropic's guidance is explicit that letting Claude jump
  straight to code on a multi-file feature produces code that solves the wrong problem. The prompt
  forces explore → plan → approve → implement, and ends by telling Claude to *stop after the plan*.
- **The lean-context rules are baked in** (read `CLAUDE.md` + `docs/README.md` first, pull deep-dives
  on demand, subagents for investigation, cap parallelism). That keeps the session itself cheap, which
  matters more than the file size — see `docs/CLAUDE-MD-GUIDE.md`.
- **Voice chat carries the household-scale reality**: full-mesh for a few people, TURN required for the
  off-tailnet cellular case (the same users who needed the BunkerWeb exceptions), capability-gated so
  it never shows a broken button, and opt-in so nobody's mic is touched without a deliberate toggle.
- **It reuses the party's proven seams**: signaling over the existing WS, constants in `constants.ts`,
  server as a dumb membership-checked relay, a separate `usePartyVoice` hook so a voice failure can't
  break sync. That's the lowest-risk way to add it.
