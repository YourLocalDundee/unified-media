# Audit A4 — Video Player & Playback Engine

Scope: `src/app/play|watch`, `src/app/api/media/*`, `src/app/api/jellyfin/*` (stream/playback/sessions/subtitles), `src/components/media/VideoPlayer.tsx`, all of `src/components/player/**`, `src/lib/{jellyfin,media-server}/playback.ts|transcode.ts|probe.ts|codecs.ts`. Party Play is out of scope (only flagged where it breaks core playback). Notifications/SMTP skipped per rules.

## Summary

The custom player is well-structured and most controls are wired correctly to the `<video>` element and the Web Audio graph. The single biggest correctness problem is the **Web Audio chain is never torn down**: `useAudioChain` opens an `AudioContext` and `createMediaElementSource()` but nothing disconnects nodes or closes the context on unmount, and every audio tool registers `timeupdate` listeners / leaves the karaoke sub-graph wired — these leak across every navigation between titles (and the source node permanently "claims" the element). Several **stream/proxy API routes lack `requireAuth()`** (`api/jellyfin/playback/[id]`, `sessions/playing|progress|stopped`, `subtitles/[itemId]/[streamIndex]`) — they proxy to Jellyfin with the server API key, so they are an unauthenticated SSRF/credentialed-proxy surface. The direct-stream route does **no validation on the HTTP `Range` header** (NaN/negative/overflow start). There are also real playback-state races: a seek during an in-progress linear transcode wedges the player on a 503-spinner; the audio-switch resume path and the resume-on-load path can both lose their seek; and `reportStop` is not fired on React unmount (only `beforeunload`), so SPA back-navigation drops the final progress write. Re-render pressure during playback is moderate-to-high: `onTimeUpdate` calls `setCurrentTime` (~4 Hz) on the top-level component, re-rendering the entire player tree including the party panels.

Overall: the engine works for the happy path (direct play and start-from-0 HLS) but has leak, security, and seek-race issues that bite on real usage (track switching, navigation between episodes, mid-file seeks on transcoded content).

## Counts

| Severity | Count |
|---|---|
| CRITICAL | 2 |
| HIGH | 6 |
| MEDIUM | 8 |
| LOW | 6 |
| **Total** | **22** |

---

## CRITICAL

### A4-C1 — Web Audio chain (AudioContext + nodes) never torn down; leaks on every navigation
**Severity:** CRITICAL
**File:** `src/components/player/useAudioChain.ts:16-91`; consumed in `src/components/media/VideoPlayer.tsx:126,1335`

**What's wrong:** `useAudioChain` creates `new AudioContext()` and `context.createMediaElementSource(video)` and caches the chain in `chainRef`, but the hook returns **no cleanup**. There is no `useEffect(() => () => { ... })` that calls `context.close()` or disconnects the nodes. When the user navigates `/play/A → /play/B` (or hits the next-episode autoplay `router.push('/watch/<id>')`), `VideoPlayer` unmounts and a new instance mounts, but the previous `AudioContext` stays open and keeps the old `<video>`/source node alive. Browsers hard-cap concurrent `AudioContext`s (~6 in Chrome); after a few episode hops, `initChain()` on the new player can throw and all audio tools silently stop working. The leak only manifests if an audio tool was opened (chain is lazy), but binge-watching with the EQ on will hit the cap.

**Why it matters:** Memory/handle leak plus a hard failure ceiling on a binge-watching app. This is the exact resource the code comments warn about ("`createMediaElementSource()` throws InvalidStateError if called twice") — the protection is per-mount but nothing reclaims the context across mounts.

**Suggested fix:** Add a cleanup effect in `useAudioChain` that, on unmount, disconnects every node and calls `chainRef.current.context.close()` then nulls `chainRef.current`. (Closing the context also implicitly stops the `timeupdate`-driven automation in A4-H2.)

### A4-C2 — Unauthenticated Jellyfin proxy/stream/session routes (credentialed SSRF surface)
**Severity:** CRITICAL
**Files:**
- `src/app/api/jellyfin/playback/[id]/route.ts` — no `requireAuth`/`getSession` (verified: grep finds none)
- `src/app/api/jellyfin/sessions/playing/route.ts`, `.../progress/route.ts`, `.../stopped/route.ts` — no auth; blindly forward the JSON body to Jellyfin
- `src/app/api/jellyfin/subtitles/[itemId]/[streamIndex]/route.ts:10-31` — no auth; builds `${JELLYFIN_URL}/Videos/${itemId}/Subtitles/${streamIndex}/Stream.vtt` from unsanitised params

**What's wrong:** These handlers call `jellyfinFetch(...)` / `fetch(...)` with the server-side `JELLYFIN_API_KEY` but never establish a session. Anyone who can reach the app (it is internet-exposed via Caddy/BunkerWeb with auth handled *inside* the app) can hit `/api/jellyfin/playback/<anything>`, `/api/jellyfin/sessions/*`, and `/api/jellyfin/subtitles/<itemId>/<idx>` without logging in. The session routes forward an attacker-controlled body to Jellyfin's `/Sessions/*` endpoints under the admin key; the subtitle route interpolates `itemId`/`streamIndex` straight into the Jellyfin URL. Contrast with `api/jellyfin/stream/[...path]` which *does* gate on `getSession()` (line 20-23) and `continue-watching` which uses `requireAuth()` — so the inconsistency is clearly an oversight.

**Why it matters:** CVE-2025-29927 is explicitly called out in CLAUDE.md as the reason auth must live in the route handler, not middleware. These routes violate that. It is a credentialed proxy to the media backend reachable pre-auth.

**Suggested fix:** Add `await requireAuth()` (or `const s = await getSession(); if (!s) return 401`) as the first line of each handler, matching `stream/[...path]/route.ts`. Validate `streamIndex` is a non-negative integer and `itemId` matches the Jellyfin GUID shape before interpolation.

---

## HIGH

### A4-H1 — `reportStop` not called on React unmount; final progress lost on SPA navigation
**Severity:** HIGH
**File:** `src/components/media/VideoPlayer.tsx:564-568` (only `beforeunload`), `781-796` (ended), `934-938` (handleBack)

**What's wrong:** Progress-on-stop is wired to (a) the `beforeunload` window event, (b) `handleEnded`, and (c) the back button (`handleBack`). It is **not** wired to component unmount. `beforeunload` only fires on full page unload/refresh — it does *not* fire on Next.js client navigation. So if the user leaves the player by any route other than the Back button or video-ended (e.g. clicking a browser-history gesture that triggers SPA nav, the autoplay `router.push`, a deep link, or the party teardown), the last position is never written. The 10 s interval (`handlePlay`, line 759) mitigates but still loses up to 10 s, and if the user pauses then navigates, the paused position past the last interval tick is lost.

**Why it matters:** Resume position is the headline feature ("Continue Watching"). Dropping the final write means resume lands 10 s+ stale or not at all.

**Suggested fix:** Add a dedicated unmount effect: `useEffect(() => () => reportStop(), [reportStop])`. Note `reportStop` already clears the interval, so it is idempotent enough; guard against double-send with the `didReportStart` ref if needed.

### A4-H2 — Audio-tool `timeupdate` listeners + karaoke graph leak across unmount (only cleaned within the mounted component)
**Severity:** HIGH
**File:** `src/components/player/MediaAudioTools.tsx:73-126,200-238`; `MediaFrameAdvance.tsx:36-42`; `MediaChapters.tsx:24-30`; `MediaBookmarks.tsx:35-41`; `MediaJumpToTime.tsx:37-43`

**What's wrong:** Two layers. (1) The normalizer/noise-gate attach `video.addEventListener('timeupdate', …)` and store a cleanup ref; the unmount effect (line 233-238) calls those refs — good *while the panel is open*. But `MediaToolsPanel` is conditionally rendered (`showToolsPanel`), so closing the panel unmounts these and runs cleanup, which is fine; the leak is that the **karaoke sub-graph is left connected** when the panel closes with karaoke active — `handleKaraokeToggle`'s teardown only runs on user toggle, never on unmount, so `panner → splitter → … → destination` stays wired against the (also-leaked, see A4-C1) context. (2) Each tool that subscribes to `timeupdate` (FrameAdvance, Chapters, Bookmarks, JumpToTime) adds its own listener; with the panel open these are ~5 extra `timeupdate` handlers firing 4 Hz, each calling `setState` on its component.

**Why it matters:** Compounds A4-C1 (the context never closes, so the dangling karaoke nodes never GC) and adds per-frame setState churn while the panel is open.

**Suggested fix:** In `MediaAudioTools` unmount, also tear down the karaoke graph if `karaoke` is true. Broadly, prefer reading `video.currentTime` on demand (e.g. in render via the parent's `currentTime` prop) instead of each tool maintaining its own `timeupdate` subscription.

### A4-H3 — Direct-stream route does not validate the `Range` header (NaN / negative / overflow)
**Severity:** HIGH
**File:** `src/app/api/media/stream/[id]/route.ts:49-78`

**What's wrong:** `Range` is parsed with `parseInt(startStr ?? '0', 10)` / `parseInt(endStr, 10)` and fed straight into `fs.createReadStream(filePath, { start, end })` and the `Content-Range`/`Content-Length` headers. No checks for: `start` NaN (malformed header → `parseInt('abc')` = NaN), `start < 0`, `start >= fileSize`, `end < start`, or `end >= fileSize`. A request like `Range: bytes=99999999999-` (start past EOF) yields `chunkSize = end - start + 1` negative and a `Content-Length` of a negative/garbage number with a 206; `fs.createReadStream` with `start > size` emits an error that the stream bridge surfaces as `controller.error`, aborting the response mid-flight. There is also no handling of multi-range (`bytes=0-99,200-299`) — it silently treats it as a single broken range. Per RFC 7233 an unsatisfiable range should return **416** with `Content-Range: bytes */<size>`.

**Why it matters:** Malformed/hostile range requests can produce inconsistent 206 responses or stream errors; correctness bug for any client that probes ranges, and a minor DoS/abuse vector.

**Suggested fix:** Clamp and validate: `if (isNaN(start) || start >= fileSize || start < 0) return 416`; `end = Math.min(end, fileSize - 1)`; `if (end < start) return 416`. Reject multi-range with 416 (or just serve the first range explicitly).

### A4-H4 — Seek during in-progress linear transcode wedges the player (no auto-recovery)
**Severity:** HIGH
**File:** `src/components/media/VideoPlayer.tsx:509-522` (frag 503 → error); `src/lib/media-server/transcode.ts:376-392` + route `hls/[id]/[...slug]/route.ts:112-126`

**What's wrong:** HLS transcode is linear-from-0 (documented v1 limitation). If the user drags the scrubber ahead of the transcoded point, hls.js requests a not-yet-generated segment, the route returns 503 after a 10 s poll, hls.js exhausts `fragLoadingMaxRetry: 3`, and the player sets a terminal error: *"Seek past the current transcode position. Seek backwards…"*. The only recovery is the global Try Again button (full re-init). There is no logic to clamp the seek bar to the transcoded high-water mark, and nothing seeks the user back automatically. On a 2-hour movie this is a near-guaranteed dead-end the first time someone scrubs forward.

**Why it matters:** A core interaction (seek) puts transcoded content into an unrecoverable error state for the most natural user action. The error text asks the user to do the player's job.

**Suggested fix:** Track the max generated segment time and constrain the seek-bar `max`/clamp forward seeks to it; or on `fragLoadError` 503, automatically `video.currentTime = <last buffered>` and resume instead of going to the error overlay. Longer-term, the deferred option-A input-seek transcode.

### A4-H5 — `reportProgress`/`reportStop` are unconditional and unthrottled per fire; redundant `played:false` spam and no de-dupe with the interval
**Severity:** HIGH (efficiency/correctness)
**File:** `src/components/media/VideoPlayer.tsx:335-365,754-764`

**What's wrong:** `handlePlay` starts a 10 s interval that posts `reportProgress` regardless of whether the position changed (paused video still posts every 10 s with the same ticks). `reportProgress` sends `played: isPaused ? undefined : false` — when paused it sends `played: undefined`, which `upsertWatchState` (library.ts:127, `played` defaults to `false`) treats as in-progress, doing a full upsert write every 10 s even while paused and stationary. Combined with `reportStop` on pause via Back/unload, the same position is written several times. The interval is never paused when the video is paused, so a paused tab keeps writing to SQLite (single-writer DB) every 10 s indefinitely.

**Why it matters:** Needless write amplification on the single SQLite writer that also serves auth/party; a backgrounded paused player writes forever.

**Suggested fix:** Skip the post when `video.paused` (or when `currentTime` is unchanged since last post). Stop the interval on `pause` and restart on `play`. Only send `played` when actually transitioning to played.

### A4-H6 — Full player tree (incl. party panels) re-renders ~4×/sec from `setCurrentTime`
**Severity:** HIGH (optimization — flagged as the biggest playback risk)
**File:** `src/components/media/VideoPlayer.tsx:768-771,108,1105-1114`

**What's wrong:** `handleTimeUpdate` calls `setCurrentTime(video.currentTime)` on every `timeupdate` (~4 Hz, up to 60 Hz in some browsers). `currentTime` lives in the top-level `VideoPlayer` component, so each tick re-renders the entire returned tree: the seek `<input>`, both control bars, the subtitle/audio/quality menus, the stats overlay, AND — when in a party — `PartyPanel`, `ChatPanel`, `ReactionOverlay`, `ReactionBar` (lines 1077-1325). None of those children are memoized. During playback this is continuous reconciliation of a large tree for a value only the seek bar and time label need.

**Why it matters:** Sustained main-thread work during playback; on lower-end devices (the stated "phone as remote" use case) this competes with HLS.js worker postMessage and decode.

**Suggested fix:** Isolate the time-driven UI: move the seek bar + time label into a small child that subscribes to `timeupdate` itself (or use a ref + `requestAnimationFrame` to update the input's value/`style` without React state). Memoize the party panels (`React.memo`) so they don't re-render on time ticks.

---

## MEDIUM

### A4-M1 — Resume seek lost when the file is HLS (MANIFEST_PARSED plays, loadedmetadata ordering)
**Severity:** MEDIUM
**File:** `src/components/media/VideoPlayer.tsx:485-489,720-735`

**What's wrong:** For HLS, `MANIFEST_PARSED` calls `video.play()` (line 488) and the resume seek is applied separately in `handleLoadedMetadata` (line 730-734, gated on `resumeSeconds > 30 && !resumeApplied`). The two are not ordered: with hls.js, `loadedmetadata` generally fires before `MANIFEST_PARSED`’s play, but it is not guaranteed across versions, and because the resume seek is keyed to a DOM event rather than to the manifest-parsed callback, a fast `play()` can begin from 0 before the seek lands, producing a visible jump from 0 to the resume point (and an extra progress post at ~0). The `resumePositionTicks` is also read from a closure captured at effect creation; on a quality switch (`retryCount` bump) the effect re-runs and `resumeApplied.current` is already true, so a switch mid-playback restarts the HLS stream from 0 with no resume (the `pendingSeekRef` path only covers audio switches, not quality switches).

**Why it matters:** Quality switch on transcoded content drops you to 0; resume can briefly flash from 0.

**Suggested fix:** Apply resume inside the `MANIFEST_PARSED` handler before `play()`, OR set `pendingSeekRef` on quality change too (mirror `handleAudioChange`) so the loadedmetadata path restores position for every source swap.

### A4-M2 — `probeFile` runs ffprobe on every HLS manifest + every embedded-subtitle request (no cache)
**Severity:** MEDIUM
**File:** `src/lib/media-server/probe.ts:23-74`; callers `hls/[id]/[...slug]/route.ts:76`, `subtitles/embedded/[id]/[streamIndex]/route.ts:44`, `playback.ts:81`

**What's wrong:** `probeFile` shells out to `ffprobe` with no memoization. It is called: once per `getNativePlaybackData` (page load), once per HLS manifest request, and once per embedded-subtitle fetch. Selecting a subtitle track or switching audio re-probes the same file; hls.js requesting the manifest after a reseek re-probes. ffprobe on a large MKV over the network mount is not free (hundreds of ms). No `Cache-Control` benefit because each call is a fresh spawn.

**Why it matters:** Repeated process spawns and disk/network reads for invariant file metadata; adds latency to track switching and manifest loads.

**Suggested fix:** Add a small in-process LRU keyed by `filePath`+`mtime` around `probeFile` (metadata is immutable for a given file version). Even a 60 s TTL eliminates the repeat-probe storm during a single session.

### A4-M3 — Seek bar fights live updates while dragging (no scrubbing state)
**Severity:** MEDIUM
**File:** `src/components/media/VideoPlayer.tsx:1105-1114,853-866`

**What's wrong:** The seek `<input type="range">` is a controlled component bound to `currentTime`, which is updated by `timeupdate` 4×/sec. While the user drags, `onChange` fires `handleSeek` which sets `video.currentTime` and `setCurrentTime` — but the in-flight `timeupdate` events from the still-playing video also call `setCurrentTime`, so the thumb can jump back to the playhead between drag events, making fine scrubbing jittery. There is no `onPointerDown`/`onPointerUp` "scrubbing" flag to suppress `timeupdate`-driven updates during a drag, and no commit-on-release (it seeks on every intermediate value, which on HLS triggers repeated segment fetches).

**Why it matters:** Janky scrubbing UX; on transcoded content, dragging spams seeks that can each trip the 503 wedge (A4-H4).

**Suggested fix:** Add an `isScrubbing` ref set on pointerdown/up; while scrubbing, ignore `timeupdate` setState and only commit `video.currentTime` on release.

### A4-M4 — A/B loop: B-point overshoot and one-shot seek can skip past A; no validation A<B
**Severity:** MEDIUM
**File:** `src/components/player/MediaABLoop.tsx:43-66`

**What's wrong:** The loop polls every 300 ms and on `currentTime >= b` sets `currentTime = a`. At higher `playbackRate` (up to 4×) the video can advance well past `b` within a 300 ms tick (4× = ~1.2 s of content), so the loop end is imprecise. More importantly there is no check that `a < b`: if the user sets B before A (or A after B), the condition `currentTime >= b` is immediately true and the loop yanks the playhead to `a` (which may be *after* `b`), producing an instant ping-pong / stuck frame. The Loop button is enabled as long as both points are non-null regardless of order.

**Why it matters:** A core tool ("AB-loop loops and clears") misbehaves on reversed points and at speed.

**Suggested fix:** Guard `handleToggleLoop` with `if (a >= b) return` (or swap). Consider using `timeupdate` plus a tighter check, or compute the loop using `seeked`/`ended` semantics.

### A4-M5 — Frame-advance forward step is not exactly one frame (no fps detection; `+=` without seeked await)
**Severity:** MEDIUM
**File:** `src/components/player/MediaFrameAdvance.tsx:11,44-59`

**What's wrong:** `FRAME_DURATION = 1/24` is hardcoded. For 25/30/50/60 fps content each "frame" step is wrong (e.g. on 60 fps it advances ~2.5 frames). The forward handler does `video.pause(); video.currentTime += FRAME_DURATION` — for a non-keyframe-seekable transcode/MKV, `currentTime` snaps to the nearest decodable sample, so repeated presses may not advance uniformly. The spec asks "frame-advance steps exactly one frame while paused" — this is approximate at best and only correct for true 24 fps. The keyboard `.`/`,` shortcuts (VideoPlayer:676-692) share the same 1/24 assumption.

**Why it matters:** Tool does not do what it claims for the majority of non-film content (most TV is 25/30 fps).

**Suggested fix:** Use `requestVideoFrameCallback` (where available) to step exactly one presented frame, or derive fps from the probe (`r_frame_rate`) and thread it into the player so the step matches the source.

### A4-M6 — Subtitle delay control is a no-op (UI only); user can set it and nothing happens
**Severity:** MEDIUM
**File:** `src/components/player/MediaSubtitles.tsx:55-58,91-97,110-128`

**What's wrong:** The Subtitle Delay +/- buttons mutate `delay` state and persist it, but the file comment (line 55-57) and the unused `_videoRef` confirm delay is **never applied** to cue timestamps. The control looks fully functional (shows `+100ms`, Reset, persists) but has zero effect on rendered subtitles. This is a button that mutates nothing on the media — failing the "verify every control actually mutates the element" requirement.

**Why it matters:** Silent dead control; users adjusting out-of-sync subs get no result and no indication it is unimplemented.

**Suggested fix:** Either implement by shifting `track.cues[i].startTime/endTime` (requires `track.mode='hidden'` re-add or live mutation), or hide the Delay section until implemented. At minimum label it as not-yet-functional.

### A4-M7 — `handleAudioChange` resume relies on `pendingSeekRef` but the resume-suppression in loadedmetadata can clear it for direct-play default
**Severity:** MEDIUM
**File:** `src/components/media/VideoPlayer.tsx:379-400,720-735`

**What's wrong:** On audio switch, `pendingSeekRef` is set to the current time and the source URL swaps. `handleLoadedMetadata` (line 725) consumes `pendingSeekRef` first and returns — correct for the HLS-target case. But switching *back to the server default* (line 387-390) sets the source to the original `streamUrl` with `isHls = isHls` — if the original is direct-play (not HLS), the new `<video>` load fires `loadedmetadata`, consumes `pendingSeekRef`, and seeks — fine. However if `resumePositionTicks > 30` and `resumeApplied.current` is still false at that point (e.g. user switched audio before the initial resume ever applied because the first track was HLS and seeked via pendingSeek, leaving `resumeApplied` false), the *next* natural load could re-apply the stale resume and jump the user backward. The two one-shot guards (`pendingSeekRef`, `resumeApplied`) are not coordinated, so ordering edge cases can double-seek or lose the position.

**Why it matters:** Audio switching is a v0.9.4 headline; position correctness across switch + resume is fragile.

**Suggested fix:** Unify into a single "desired start position" ref set by both the resume path and the switch path, applied exactly once per source load and then cleared; set `resumeApplied` when the pendingSeek consumes a position too.

### A4-M8 — `handleEnded` next-episode fetch has no abort/guard; can navigate after unmount or double-fire
**Severity:** MEDIUM
**File:** `src/components/media/VideoPlayer.tsx:781-822`

**What's wrong:** `handleEnded` fires a `fetch(.../next-episode)` then sets countdown state; a separate effect (`countdown === 0` → `router.push`) drives navigation. If the user clicks Back during the countdown, `cancelAutoplay` clears the timer but the `countdown===0` effect could still race if the timer already reached 0. The fetch has no AbortController, so an unmount mid-flight still resolves and calls `setNextEpisode` on an unmounted component (React warns / no-op). Also `handleEnded` can fire more than once on some browsers (ended → seek to near-end → ended again) re-triggering the fetch.

**Why it matters:** Edge-case navigation after the user has left; console warnings; possible duplicate next-episode fetches.

**Suggested fix:** Guard the navigation effect with the same `nextEpisode && countdownActive` condition, abort the fetch on unmount, and set a `didEnd` ref to make `handleEnded` idempotent.

---

## LOW

### A4-L1 — `MediaSnapshot` revokes the object URL immediately after `a.click()` — download can fail
**Severity:** LOW
**File:** `src/components/player/MediaSnapshot.tsx:32-45`

**What's wrong:** `a.click()` is synchronous-queued but `URL.revokeObjectURL(url)` is called on the very next line. For large PNGs (4K frame) some browsers have not finished reading the blob when the URL is revoked, aborting the save. Also `canvas.getContext('2d')!.drawImage` will throw a SecurityError (tainted canvas) for cross-origin streams without CORS — the native `/api/media/stream` is same-origin so OK, but the Jellyfin proxy path could taint it; the throw is uncaught (no try/catch around `drawImage`).

**Why it matters:** Occasional failed snapshot; uncaught exception on tainted canvas.

**Suggested fix:** Defer revoke (`setTimeout(() => URL.revokeObjectURL(url), 10_000)`); wrap `drawImage`/`toBlob` in try/catch and surface the `error` feedback state.

### A4-L2 — Jump-to-time rejects `0` length and uses `> duration` with possibly-zero duration
**Severity:** LOW
**File:** `src/components/player/MediaJumpToTime.tsx:45-60`

**What's wrong:** Validation `parsed < 0 || parsed > duration` rejects when `duration` is 0 (still loading) — every jump fails with "out of range" until metadata loads. Single-part raw-seconds input is intentionally excluded, which is fine, but there is no upper-bound clamp (it errors instead of clamping to the end). Minor.

**Why it matters:** Jump fails silently-ish during the brief loading window.

**Suggested fix:** Guard `duration > 0` before range-checking, and clamp to `[0, duration]` rather than erroring.

### A4-L3 — Equalizer "disable" resets gains to 0 but leaves the 10 biquads in the signal path
**Severity:** LOW
**File:** `src/components/player/MediaEqualizer.tsx:64-72`; `useAudioChain.ts:58-65`

**What's wrong:** Disabling the EQ sets every band gain to 0 dB rather than bypassing the filters (comment acknowledges this). 10 `peaking` biquads at 0 dB are mathematically near-transparent but still process every sample — there is no true bypass. The spec asks that "equalizer/audio-effects … can be bypassed"; this is a soft bypass, not a real one, and the whole chain is always engaged once any tool inits (source routes through eq→comp→gain→panner permanently).

**Why it matters:** Minor CPU cost and not a true bypass; compressor/pan also can't be removed from the graph, only neutralized.

**Suggested fix:** For true bypass, reconnect `source → destination` directly and disconnect the processing chain when all tools are off; or accept the soft-bypass and document it.

### A4-L4 — `togglePlay` on the `<video>` onClick conflicts with controls and double-toggles
**Severity:** LOW
**File:** `src/components/media/VideoPlayer.tsx:1053,832-840`

**What's wrong:** `onClick={togglePlay}` on the `<video>` toggles play/pause on any click in the video area. The bottom controls sit in a sibling absolutely-positioned div with higher z-index so clicks there don't reach the video — OK. But the Space/`k` keyboard handlers also call the same toggle; clicking a control button that then has focus + pressing Space can both activate the button and toggle play. Minor focus interaction.

**Why it matters:** Occasional double-action when keyboard and click overlap.

**Suggested fix:** Blur control buttons after click, or scope Space handling to when the container (not a button) has focus.

### A4-L5 — `reportStart` posts `positionTicks: 0` unconditionally, racing the resume seek
**Severity:** LOW
**File:** `src/components/media/VideoPlayer.tsx:323-333,754-758`

**What's wrong:** On first `play`, `reportStart` POSTs `{ positionTicks: 0, played: false }`. If the user is resuming at, say, 40 min, this writes 0 to the watch state momentarily before the next interval/seek corrects it. A crash or quick navigation in that window persists position 0, losing the resume. The resume seek and the start report are not ordered.

**Why it matters:** Small window where resume position is overwritten with 0.

**Suggested fix:** Send the actual `video.currentTime` in `reportStart`, or drop the explicit 0-position start ping (the interval covers it).

### A4-L6 — Stream route sets `Cache-Control: no-cache` and reads via per-chunk enqueue without backpressure
**Severity:** LOW
**File:** `src/app/api/media/stream/[id]/route.ts:56-67,81-91`

**What's wrong:** The Node→Web stream bridge enqueues every `data` chunk without respecting the controller's `desiredSize` (no `pull`-based backpressure). For a fast disk and a slow client this buffers chunks in memory. `cancel()` does destroy the read stream (good). Minor for LAN but unbounded buffering for a stalled client.

**Why it matters:** Potential memory growth on slow/stalled clients pulling large files.

**Suggested fix:** Use `stream.pause()`/`resume()` driven by the controller, or return the Node stream via `Readable.toWeb()` which handles backpressure.

---

## Verified-correct (notable positives)
- HLS.js is created once per source and **destroyed** in the init-effect cleanup (`VideoPlayer.tsx:548-556`); the `destroyed` flag guards setState after the async import resolves post-unmount.
- The `<video> onError` handler is wired (line 1045) and maps `error.code` — the documented infinite-spinner trap is handled.
- Resume seek is correctly deferred to `loadedmetadata` for the MKV-seek-index reason (line 720-735) for the direct-play path.
- Stream proxy (`jellyfin/stream/[...path]`) strips client `api_key` and injects server key (line 33-38), and rewrites manifest segment URLs through the proxy.
- `MediaQualitySelector` correctly hides when `<= 1` quality and closes on outside-click only while open.
- Subtitle `<track>` visibility is driven solely by `activeSubIndex` (no `default` attr), avoiding multi-default auto-show.
- `useAudioChain` correctly guards the single `createMediaElementSource` per element within a mount.
- Speed control syncs from the `ratechange` event so HLS reinit doesn't desync the UI.
