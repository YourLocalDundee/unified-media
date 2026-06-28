# Vynchronize (kyle8998) — Feature Mining

Source: `sources/Vynchronize/`
Stack: vanilla JS client (jQuery + Bootstrap), Node + Express + Socket.IO server (`server.js`),
multi-source player abstraction (`js/yt.js`, `js/html5.js`, `js/vimeo.js`, `js/dm.js`, `js/player.js`),
sync logic in `js/sync.js`, host election in `js/host.js`.

A small, older real-time sync app. Its core sync (host-authoritative play/pause/seek/sync) is below our
Party Play (v0.9.5) — we have server authority, drift bands, readiness gate, reconnection. **The one
feature worth mining is its queue, which corroborates watchparty's #1 grab.**

---

## Worth grabbing

### 1. Shared queue (reinforces `watchparty-analysis.md` #1) ★
Vynchronize has a fully-built queue protocol (`server.js`):
- `enqueue video` — add one item (server fetches title via `get title`)
- `enqueue playlist` — add a whole playlist at once (`get playlist videos`)
- `remove at` — remove by index
- `play at` — jump the room to a specific queue index
- `empty queue` — clear all
- `play next` — advance to next when current ends

This is a second, independent design for the **shared queue** feature. Combined with watchparty's
`playlistAdd/Move/Delete/Next`, it confirms the message set we'd want:
`queue_add`, `queue_remove(index)`, `queue_play_at(index)`, `queue_clear`, auto-advance on end.
The "enqueue whole playlist at once" maps neatly to **"queue an entire season"** for us (fan out a
series' episodes into the party queue in S/E order).

**Port note:** Same plan as in the watchparty doc — an ordered list in `PartyStateStore` + new WS messages,
server stays authoritative, items reference local `media_items`. Vynchronize's `play at` (jump to arbitrary
queue index) is a small nice-to-have on top of linear auto-advance.

---

## NOT applicable

- **Multi-source player abstraction** (`changeVideoClient` switching between YouTube / Vimeo / Dailymotion /
  HTML5 — `js/yt.js`, `js/vimeo.js`, `js/dm.js`, `js/html5.js`). Clean adapter pattern, but we sync only
  local library items. Irrelevant.
- **Host election / auto-host handoff** (`js/host.js`, `server.js` `autoHost` — when the host leaves, a new
  socket is promoted). We use shared control + last-member-out ends the party (CLAUDE.md §16), so we don't
  need host handoff. Our model is strictly better for this use case.
- **Basic NTP-less sync** (`sync` pulls current time from one user and pushes to others). Strictly weaker
  than our clock-offset + extrapolation. Skip.

---

## Recommendation

Take nothing directly, but use Vynchronize's queue protocol as the **second reference** when we design the
shared-queue feature (the headline grab from the watch-party repos). Its "enqueue playlist" → our "queue a
whole season" is the concrete UX win.
