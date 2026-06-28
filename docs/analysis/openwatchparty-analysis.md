# OpenWatchParty (mhbxyz) — Feature Mining

Source: `sources/OpenWatchParty/`
Stack: Jellyfin **plugin** (C#) injected into jellyfin-web + a standalone **session server in Rust**
(`src/server/src/*.rs`) speaking JSON-over-WebSocket on `:3000/ws`. Excellent documentation set under
`docs/technical/*` and `docs/product/*`.

**Key finding:** OpenWatchParty's sync engine is *functionally identical to the one we already shipped*
in Party Play (v0.9.5). It independently arrived at the same design — NTP-style clock sync with EMA
smoothing, target-server-timestamp action scheduling, lead-time position compensation, and a non-host
drift-correction loop. So there are **few net-new features** here. Its real value to us is **(a) external
validation that our sync design and constants are correct**, and **(b) a clean, well-written reference for
two things we may want later**.

---

## Confirms our design (cross-check, don't re-port)

From `docs/technical/sync.md`, OpenWatchParty's constants line up almost exactly with ours
(CLAUDE.md §16, `src/lib/party/constants.ts`):

| Concept | OpenWatchParty | Ours | Match? |
|---|---|---|---|
| Clock sync | Simplified NTP, `rtt/2` offset | same (`ping`/`pong`) | ✅ |
| Offset smoothing | EMA `0.6*old + 0.4*new` | `CLOCK_OFFSET_EMA_ALPHA = 0.4` | ✅ identical |
| Play lead | 1000ms ("allow buffering sync") | `PLAY_LEAD_MS = 1000` | ✅ identical |
| Pause/seek lead | 300ms | `CONTROL_LEAD_MS = 300` | ✅ identical |
| Action scheduling | `scheduleAt(target_server_ts)` | `effectiveAt` absolute server ts | ✅ same idea |
| Lead-time pos comp | `adjustedPosition()` + `SYNC_LEAD_MS` | extrapolatePosition in `position.ts` | ✅ same |
| Drift correction | non-host `syncLoop`, playbackRate nudge 0.85–2.0x | client nudge clamped `[0.90,1.10]`, server reseek ≥1.5s | ✅ same shape, ours is tighter |

**Takeaway:** No action needed — this is independent corroboration that Party Play's sync math is sound.
Their playbackRate nudge range (0.85–2.0x) is *wider/more aggressive* than ours ([0.90,1.10]); ours is
deliberately gentler to avoid audible pitch artifacts. Keep ours.

---

## Worth grabbing

### 1. `docs/technical/jellyfin-syncplay-reference.md` — reference, not code ★
A 416-line writeup of how **Jellyfin's own SyncPlay** works internally (group state machine, buffering
gates, ping-based time sync). This is the canonical prior art for media sync and a good check against our
readiness-gate / median-position logic if we ever revisit drift edge cases. **Action: keep as a reading
reference; nothing to port.**

### 2. Drift-state UI vocabulary — tiny polish
Their UI exposes a 3-state sync indicator: **synced / syncing / waiting** plus an online/offline dot
(`docs/product/features.md`). We have the underlying states (readiness gate `waiting` broadcast, grace,
median reconcile) but a clean tri-state badge in `PartyPanel` is nice, cheap polish on data we already emit.

### 3. Protocol envelope discipline — reference
`docs/technical/protocol.md` uses a uniform envelope `{type, room, client, payload, ts, server_ts}` for
*every* message. Ours is similar (`{type, partyId, ...}`). Worth a glance if we version the protocol for the
queue/voice features from the watchparty analysis — their stamping of `server_ts` on every frame is the
pattern we already follow.

---

## NOT applicable

- **Rust session server** — separate process/language; we run sync in-process on the Next.js node (port
  3002, CLAUDE.md §16). No reason to adopt Rust.
- **Jellyfin plugin (C#) + jellyfin-web injection** — we replaced Jellyfin with a native media server
  (Independence Build Phase 5). The plugin model is irrelevant to us; we own the player.
- **Host-only control model** — they're explicitly host-controlled with "democratic mode planned." We
  already ship shared control. We're ahead here.

---

## Recommendation

Nothing to build from this repo. File `jellyfin-syncplay-reference.md` and `sync.md` mentally as "if Party
Play sync ever misbehaves, read these." The one cheap pickup is the **tri-state synced/syncing/waiting
badge** in the party panel. Treat this repo as a confidence check that we built the sync layer correctly.
