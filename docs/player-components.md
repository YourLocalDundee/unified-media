# Player Components — Technical Reference

## Overview

The player tools system is a collection of React components and a Web Audio API hook that together provide VLC-style playback controls embedded inside the unified-frontend video player. All components live in `src/components/player/`. They are surfaced through `MediaToolsPanel`, which is rendered by `VideoPlayer` when the user clicks the Sliders button in the playback controls. `MediaToolsPanel` organises the components into four tabs — Playback, Video, Audio, and Info — and owns the panel's open/close lifecycle. Individual tool components are deliberately stateless with respect to each other: they receive a `videoRef` (or a callback such as `initAudioChain`) and drive the native `HTMLVideoElement` or Web Audio graph directly, with no shared store.

---

## Shared Types (`types.ts`)

All shared types and constants are exported from `src/components/player/types.ts`.

### `PlaybackRate`

```typescript
export type PlaybackRate = 0.25 | 0.5 | 0.75 | 1 | 1.25 | 1.5 | 1.75 | 2 | 3 | 4
```

Discriminated union of the supported playback rate values. Matches the button set rendered by `MediaSpeedControl`.

### `ABLoopState`

```typescript
export interface ABLoopState {
  pointA: number | null
  pointB: number | null
  active: boolean
}
```

Snapshot of an A/B loop's state. `pointA` and `pointB` are timestamps in seconds; `active` is true while the polling interval is running. Not currently consumed externally but exported for potential parent state lifting.

### `Bookmark`

```typescript
export interface Bookmark {
  id: string
  label: string
  time: number
}
```

A single user-created bookmark. `id` is a `crypto.randomUUID()` value. `time` is seconds into the video. `label` defaults to a `MM:SS` string but is user-editable in place.

### `VideoFilterState`

```typescript
export interface VideoFilterState {
  brightness: number
  contrast: number
  saturation: number
  hue: number
}
```

Numeric CSS filter parameters. `brightness`, `contrast`, and `saturation` are percentages (0–200; default 100). `hue` is degrees (-180–180; default 0). The component serialises these into a CSS `filter` string via `buildCssFilter`.

### `EQ_FREQUENCIES`

```typescript
export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const
```

The ten centre frequencies (Hz) for the equalizer bands, in ascending order. Index position in this tuple corresponds directly to index position in `AudioChainNodes.eqFilters`.

### `EQ_PRESETS`

```typescript
export const EQ_PRESETS: Record<string, number[]> = {
  Flat:      [0,    0,    0,    0,    0,    0,    0,    0,    0,    0  ],
  Rock:      [4.5,  3,   -2,   -4,   -2,   2,    5,    6,    6,    6  ],
  Pop:       [-1.5, 4.5,  7,    8,    6.5,  3,   -1.5, -2.5, -2.5, -3 ],
  Jazz:      [4,    3,    1,    2,   -2,   -2,    0,    1,    3,    4  ],
  Classical: [5,    4,    3,    2,   -2,   -2,    0,    2,    3,    4  ],
  Bass:      [5,    4,    3,    2,    1,    0,    0,    0,    0,    0  ],
  Treble:    [0,    0,    0,    0,    0,    1,    2,    3,    4,    5  ],
  Vocal:     [-2,   0,    3,    5,    5,    5,    3,    2,    0,   -2  ],
}
```

Named gain presets (dB) for each of the ten EQ bands. Values align positionally with `EQ_FREQUENCIES`. A `Custom` entry is synthesised at runtime by `MediaEqualizer` when a band is manually adjusted; it is not stored here.

### `AspectRatioMode`

```typescript
export type AspectRatioMode = 'auto' | '16:9' | '4:3' | '21:9' | '1:1' | '9:16' | '2.35:1'
```

All supported aspect ratio override modes. `auto` means no CSS override is applied.

### `MediaChapter`

```typescript
export interface MediaChapter {
  name: string
  startPositionTicks: number
}
```

A chapter descriptor. `startPositionTicks` is in 100-nanosecond ticks (divide by `10_000_000` to get seconds). Passed through from `PlaybackData.chapters`.

### `AudioChainNodes`

```typescript
export interface AudioChainNodes {
  context: AudioContext
  source: MediaElementAudioSourceNode
  gainNode: GainNode
  compressor: DynamicsCompressorNode
  panner: StereoPannerNode
  eqFilters: BiquadFilterNode[]
}
```

The live Web Audio graph built by `useAudioChain`. Passed to `MediaEqualizer` and `MediaAudioTools` via the `initAudioChain` callback so both components can mutate the same graph nodes without re-initialising the chain.

### `QualityOption`

```typescript
export interface QualityOption {
  label: string
  maxHeight: number
  maxWidth: number
  bitrate: number
  isDirect: boolean
  streamUrl: string
  isHls: boolean
}
```

A single quality tier for `MediaQualitySelector`. `isDirect` signals that the stream is a direct play (no server-side transcode). `isHls` indicates an HLS manifest URL rather than a progressive MP4 stream.

---

## VideoPlayer (`VideoPlayer.tsx`)

`VideoPlayer` is the top-level player component. It is a default export rendered at `/watch/[id]`. It receives a `PlaybackData` object spread as props (defined in `src/lib/media-server/types.ts`).

### Props (`PlaybackData`)

All fields come from `PlaybackData`. Three fields are optional and gate specific runtime features — if absent, the associated feature is silently skipped with a one-time `console.warn`:

| Field | Type | Behaviour when absent |
|---|---|---|
| `progressApiUrl` | `string \| undefined` | `reportStart`, `reportProgress`, and `reportStop` all no-op with a warning logged on the first `reportStart` call. |
| `nextEpisodeApiBase` | `string \| undefined` | Next-episode autoplay is disabled. A warning is logged in `handleEnded` if `seriesId` is set but this field is not. |
| `subtitleApiBase` | `string \| undefined` | `subtitleTracks` is an empty array — no `<track>` elements are injected. A warning is logged once on mount (inside a `[]`-dep `useEffect`) if `subtitleStreams` is non-empty but this field is absent. |

`getNativePlaybackData()` in `src/lib/media-server/playback.ts` always sets all three fields (`progressApiUrl: '/api/media/progress'`, `nextEpisodeApiBase: '/api/media/series'`, `subtitleApiBase: '/api/media/subtitles'`). Any consumer that manually constructs a `PlaybackData` object and omits these will silently lose those features.

### Reporting callbacks

`reportStart`, `reportProgress`, and `reportStop` are `useCallback`s. Their dependency arrays include only `itemId` and `progressApiUrl` — the fields `mediaSourceId`, `playSessionId`, and `isHls` are present on `PlaybackData` but are not referenced inside the callback logic and are therefore excluded from the dep arrays.

`reportProgress(isPaused: boolean)` sends `{ mediaId, positionTicks, played: isPaused ? undefined : false }`. When the player is paused the `played` field is omitted (`undefined`); when playing it is explicitly `false`. (`reportStop` sets `played: remaining < 0.05`, marking the item as played when less than 5% of runtime remains.)

### Subtitle track injection

The `subtitleTracks` array is derived synchronously from `subtitleStreams` and `subtitleApiBase`. Each track URL is `${subtitleApiBase}/${itemId}/${stream.index}`. The active track is toggled via `videoRef.current.textTracks[i].mode` rather than DOM manipulation, allowing the `<track>` elements to load all subtitles upfront while only one is shown at a time.

### Next-episode autoplay

On `handleEnded`, if `seriesId` and `nextEpisodeApiBase` are both set, a fetch is made to `${nextEpisodeApiBase}/${seriesId}/next-episode`. If an episode is returned, a 10-second countdown overlay appears. The user can click "Play Now" to navigate immediately or the countdown button to cancel. When the countdown reaches 0 the router pushes `/watch/${nextEpisode.id}`.

---

## Components

### `MediaToolsPanel`

**Exported as:** `MediaToolsPanel` (named export)

**Props interface:**

```typescript
interface MediaToolsPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  duration: number
  itemId: string
  itemTitle: string
  chapters: MediaChapter[]
  initAudioChain: () => AudioChainNodes | null
  currentAspectRatio: AspectRatioMode
  onAspectRatioChange: (mode: AspectRatioMode) => void
  onVideoFilterChange: (cssFilter: string) => void
  onClose: () => void
}
```

`MediaToolsPanel` is the top-level container for all player tools. It renders a fixed panel anchored to the bottom of the viewport (max 60 vh) with a tab bar — Playback, Video, Audio, Info — and a close button. Playback tab hosts `MediaSpeedControl`, `MediaABLoop`, `MediaFrameAdvance`, `MediaAspectRatio`, and `MediaJumpToTime`. Video tab hosts `MediaVideoEffects`. Audio tab hosts `MediaEqualizer` and `MediaAudioTools`. Info tab hosts `MediaBookmarks`, `MediaChapters`, and `MediaSnapshot`. The panel passes `videoRef` directly to most children; `initAudioChain` is passed to the two audio components so they can lazily initialise the Web Audio chain on first interaction. `itemId` is used to namespace the bookmark `localStorage` key (`bookmarks-${itemId}`). There is no VLC analogue — this panel is the unified equivalent of VLC's Tools menu, Audio Effects dialog, Video Effects dialog, and Bookmarks dialog combined into a single in-player tray.

**Implementation notes:**
- `videoRef` is re-cast from `RefObject<HTMLVideoElement | null>` to `RefObject<HTMLVideoElement>` before being passed to children that expect the non-nullable form.
- The `activeTab` state is local and resets to `'playback'` each time the panel is unmounted and remounted.

---

### `MediaSpeedControl`

**Exported as:** default export

**Props interface:**

```typescript
interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
}
```

`MediaSpeedControl` renders a row of fixed-rate buttons (0.25x through 4x, labelled "Normal" at 1x) and synchronises with the native `ratechange` event so external speed changes (e.g. keyboard shortcuts) are reflected. Clicking a button sets `videoRef.current.playbackRate` directly. This is the equivalent of VLC's Playback > Speed menu. The available rates mirror the `PlaybackRate` type from `types.ts`, though the component reads from a local `PLAYBACK_RATES` array rather than the type directly.

**Implementation notes:**
- Listens to `ratechange` on the video element to keep `currentRate` state in sync with any out-of-band changes.
- No persistence — speed resets when the video element is replaced.

---

### `MediaABLoop`

**Exported as:** default export

**Props interface:**

```typescript
interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
  duration: number
}
```

`MediaABLoop` implements A/B repeat: the user marks a start point (A) and end point (B) at arbitrary timestamps, then activates looping. While active, a `setInterval` at 300 ms polls `currentTime` and seeks back to point A whenever `currentTime >= pointB`. Clearing the loop stops the interval and nulls both points. This is equivalent to VLC's Playback > A-B Loop feature.

**Implementation notes:**
- The loop is implemented with `setInterval` (300 ms polling) rather than a `timeupdate` event listener, which means there can be up to ~300 ms of overshoot past point B before the seek fires.
- The interval ref is cleaned up in a `useEffect` return to prevent leaks when the component unmounts.
- `duration` is accepted as a prop but not used in the current implementation (reserved for future range validation).
- Both point A and point B must be set before the Loop button is enabled.

---

### `MediaFrameAdvance`

**Exported as:** default export

**Props interface:**

```typescript
interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
}
```

`MediaFrameAdvance` provides single-frame stepping forward and backward, assuming a fixed 24 fps frame duration (`1 / 24` seconds). Pressing either direction pauses the video first, then adjusts `currentTime` by one frame. The current position is displayed in `HH:MM:SS.mmm` format along with a computed frame number (`Math.floor(currentTime * 24)`). This is the equivalent of VLC's Frame by Frame button (the `e` key shortcut).

**Implementation notes:**
- Frame duration is hardcoded to `1/24` seconds. For content at other frame rates (23.976, 25, 29.97, 60) the step will be slightly off.
- Backward step clamps to `Math.max(0, currentTime - FRAME_DURATION)` to avoid negative timestamps.
- The display frame number is a best-effort approximation derived from wall-clock time, not from a decoded frame counter.

---

### `MediaAspectRatio`

**Exported as:** default export

**Props interface:**

```typescript
interface Props {
  currentMode: AspectRatioMode
  onAspectRatioChange: (mode: AspectRatioMode) => void
}
```

`MediaAspectRatio` renders a grid of seven aspect ratio preset buttons. It is a pure controlled component — it holds no local state and fires `onAspectRatioChange` on each click. The parent (`VideoPlayer`) is responsible for applying the selected mode as CSS to the `<video>` element. The available modes are `auto`, `16:9`, `4:3`, `21:9`, `2.35:1`, `1:1`, and `9:16`. This is equivalent to VLC's Video > Aspect Ratio submenu.

**Implementation notes:**
- `auto` mode is intended to let the browser use the video's native dimensions; the parent should apply no override CSS in that case.
- `9:16` (portrait) is included for vertical content.

---

### `MediaJumpToTime`

**Exported as:** default export

**Props interface:**

```typescript
interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
  duration: number
}
```

`MediaJumpToTime` provides a text input that accepts timestamps in `MM:SS` or `HH:MM:SS` format and seeks the video to that position on form submission. It validates that the parsed time falls within `[0, duration]` and surfaces inline errors for bad input. The current position and total duration are shown above the input. This is equivalent to VLC's Playback > Go to Specific Time dialog (`Ctrl+T`).

**Implementation notes:**
- Parsing rejects inputs with fewer than 2 or more than 3 colon-separated segments.
- On a successful seek the input field is cleared and the error message is dismissed.
- Listens to `timeupdate` to keep the displayed current time live.

---

### `MediaVideoEffects`

**Exported as:** default export

**Props interface:**

```typescript
interface MediaVideoEffectsProps {
  onFilterChange: (cssFilter: string) => void
}
```

`MediaVideoEffects` exposes four CSS filter sliders — Brightness (0–200%), Contrast (0–200%), Saturation (0–200%), and Hue (-180°–180°) — with a Reset button that returns all values to defaults (100/100/100/0). On each slider change it serialises all four values into a single CSS `filter` string and calls `onFilterChange`. The parent applies this string directly to the video element's style. This is equivalent to VLC's Tools > Effects and Filters > Video Effects > Essential tab.

**Implementation notes:**
- State is kept entirely within the component. The parent only receives the computed CSS string, not the individual filter values.
- Reset calls `onFilterChange('')` (empty string) so the parent can remove the `style.filter` attribute entirely rather than setting it to the verbose default string.
- Does not interact with the Web Audio chain — purely CSS-based.

---

### `MediaEqualizer`

**Exported as:** default export

**Props interface:**

```typescript
interface Props {
  initAudioChain: () => AudioChainNodes | null
}
```

`MediaEqualizer` is a 10-band parametric equalizer with preset selection and per-band gain sliders. Bands correspond to the ten frequencies in `EQ_FREQUENCIES` (60 Hz – 16 kHz). Each band is a `BiquadFilterNode` with `type = 'peaking'` and `Q = 1.0`. The EQ is inactive by default; clicking "Enable EQ" calls `initAudioChain()`, applies the current gains to the audio chain, and marks the EQ as on. While active, slider changes are applied to the live `eqFilters` nodes in real time. Disabling the EQ resets all filter gains to 0 dB. Preset selection updates all sliders simultaneously and, if the EQ is active, applies the preset gains immediately. Manually adjusting any band sets the selected preset label to `Custom`. This is equivalent to VLC's Tools > Effects and Filters > Audio Effects > Equalizer tab.

**Implementation notes:**
- The component holds a local `chainRef` that caches the `AudioChainNodes` reference after first init, avoiding repeated `initAudioChain()` calls.
- Gains are stored in component state as a `number[]` indexed by band position. Preset values come from `EQ_PRESETS` in `types.ts`.
- Band gain range is -12 dB to +12 dB in 0.5 dB steps.
- Disabling the EQ zeros the BiquadFilter gains but does not disconnect the nodes — the chain remains wired, just transparent.

---

### `MediaAudioTools`

**Exported as:** default export

**Props interface:**

```typescript
interface Props {
  initAudioChain: () => AudioChainNodes | null
}
```

`MediaAudioTools` exposes three audio processing controls that operate directly on the Web Audio chain. Volume Boost is a gain slider (0–200%, step 0.05) that sets `gainNode.gain.value`; it allows boosting quiet content above the system volume ceiling. The Compressor toggle activates the `DynamicsCompressorNode` with preset parameters (threshold -24 dB, knee 30 dB, ratio 12:1, attack 3 ms, release 250 ms); disabling it sets `ratio = 1` to effectively bypass without rewiring the graph. Stereo Pan is a slider from -1 (full left) to +1 (full right) that sets `panner.pan.value`, with a Reset to Center button. Collectively this is equivalent to VLC's Tools > Effects and Filters > Audio Effects > Compressor and Spatializer tabs, plus the audio boost option in extended settings.

**Implementation notes:**
- Each control lazily calls `initAudioChain()` on first interaction; if the chain cannot be initialised (e.g. the video element is not yet mounted) the handler returns early without updating Web Audio state, though local React state is still updated.
- Volume Boost state is independent of the HTML `<video>` volume attribute — it operates post-decode in the Web Audio graph.
- The compressor is not truly bypassed when disabled; ratio is set to 1:1 so the node passes signal without meaningful compression. This avoids the graph rewiring required for true bypass.
- Pan display reads "Center" when `pan === 0`, and "L n%" or "R n%" otherwise.

---

### `MediaBookmarks`

**Exported as:** default export

**Props interface:**

```typescript
interface MediaBookmarksProps {
  videoRef: React.RefObject<HTMLVideoElement>
  storageKey: string
}
```

`MediaBookmarks` provides a persistent bookmark list for the current media item. Clicking "Add Bookmark" records the current `currentTime` with a default `MM:SS` label and a `crypto.randomUUID()` id, then persists the sorted list to `localStorage` under `storageKey`. Bookmarks are sorted by time on insert. Each bookmark shows its timestamp, an editable label (click to enter inline edit mode; confirm with Enter or blur, cancel with Escape), a Go button that seeks to the bookmark's time, and a delete button. This is equivalent to VLC's Playback > Bookmarks dialog.

**Implementation notes:**
- `storageKey` is passed as `bookmarks-${itemId}` by `MediaToolsPanel`, scoping bookmarks per media item.
- The bookmark list is initialised from `localStorage` in the `useState` initialiser (lazy init). Parse failures fall back to an empty array.
- Changes to the bookmark list are written back to `localStorage` in a `useEffect` keyed on `[bookmarks, storageKey]`.
- Inline edit input is auto-focused when `editingId` is set, via a separate `useEffect`.
- There is no cap on bookmark count.

---

### `MediaChapters`

**Exported as:** default export

**Props interface:**

```typescript
interface MediaChaptersProps {
  videoRef: React.RefObject<HTMLVideoElement>
  chapters: MediaChapter[]
  duration: number
}
```

`MediaChapters` renders the chapter list sourced from the `MediaChapter[]` passed down from the player via `PlaybackData.chapters`. It converts `startPositionTicks` (100 ns ticks) to seconds by dividing by `10_000_000`. The active chapter is determined by finding the last chapter whose start time is at or before `currentTime`. Clicking any chapter row seeks to its start time. Prev/Next buttons navigate between chapters sequentially; both are disabled at the respective boundaries. If the `chapters` array is empty the component renders a "No chapters available" message. This is equivalent to VLC's Playback > Chapter navigation.

**Implementation notes:**
- `duration` is accepted as a prop but is currently unused (the `_duration` parameter name signals this); it is present for potential future use such as rendering a progress bar per chapter.
- Chapter index calculation is a linear scan — O(n) per render — which is acceptable for typical chapter counts (< 100).
- The component listens to `timeupdate` to keep `currentTime` state live, which drives the active chapter highlight.

---

### `MediaSnapshot`

**Exported as:** default export

**Props interface:**

```typescript
interface MediaSnapshotProps {
  videoRef: React.RefObject<HTMLVideoElement>
  title: string
}
```

`MediaSnapshot` captures the current video frame as a PNG and triggers a browser download. On click it creates an off-screen `<canvas>` sized to the video's native resolution, draws the current frame with `drawImage`, converts to a Blob via `canvas.toBlob`, and downloads it as `${title}-${Date.now()}.png`. If the video has no decoded dimensions (`videoWidth === 0`) it shows an error message for 2 seconds. On success it shows "Saved!" for 2 seconds. This is equivalent to VLC's Video > Take Snapshot (`Shift+S`).

**Implementation notes:**
- Uses `canvas.toBlob` with `'image/png'` — lossless output at native video resolution.
- The object URL is revoked immediately after the anchor click to free memory.
- The snapshot captures the raw decoded frame, not the CSS-filtered view. CSS `filter` effects applied to the `<video>` element do not appear in the canvas output.
- Will fail silently if the browser blocks cross-origin canvas reads on the video source.

---

### `MediaQualitySelector`

**Exported as:** `MediaQualitySelector` (named export)

**Props interface:**

```typescript
interface MediaQualitySelectorProps {
  qualities: QualityOption[]
  currentQuality: QualityOption | null
  onQualityChange: (quality: QualityOption) => void
}
```

See dedicated section below.

---

## Audio Chain (`useAudioChain.ts`)

### Hook signature

```typescript
export function useAudioChain(
  videoRef: React.RefObject<HTMLVideoElement | null>
): {
  chainRef: React.RefObject<AudioChainNodes | null>
  initChain: () => AudioChainNodes | null
}
```

`useAudioChain` is a React hook that lazily constructs a Web Audio processing graph wired to the provided `<video>` element. It returns `chainRef` (the live graph nodes, or `null` before init) and `initChain` (the idempotent initialiser). Callers invoke `initChain()` at the point of first user interaction with any audio tool; subsequent calls return the cached chain.

### Chain topology

```
MediaElementAudioSourceNode (source)
  → BiquadFilterNode[0]  (60 Hz,  peaking, Q=1.0)
  → BiquadFilterNode[1]  (170 Hz, peaking, Q=1.0)
  → BiquadFilterNode[2]  (310 Hz, peaking, Q=1.0)
  → BiquadFilterNode[3]  (600 Hz, peaking, Q=1.0)
  → BiquadFilterNode[4]  (1 kHz,  peaking, Q=1.0)
  → BiquadFilterNode[5]  (3 kHz,  peaking, Q=1.0)
  → BiquadFilterNode[6]  (6 kHz,  peaking, Q=1.0)
  → BiquadFilterNode[7]  (12 kHz, peaking, Q=1.0)
  → BiquadFilterNode[8]  (14 kHz, peaking, Q=1.0)
  → BiquadFilterNode[9]  (16 kHz, peaking, Q=1.0)
  → DynamicsCompressorNode  (threshold=-24, knee=30, ratio=12, attack=0.003, release=0.25)
  → GainNode               (default gain=1.0)
  → StereoPannerNode        (default pan=0.0)
  → AudioContext.destination
```

All ten EQ filters are initialised with `gain.value = 0` (transparent). The compressor is always in the graph; `MediaAudioTools` bypasses it by setting `ratio = 1` rather than disconnecting.

### Constraint: one-time initialisation per video element

`createMediaElementSource(video)` can only be called once per `HTMLVideoElement`. Calling it a second time on the same element throws a `DOMException`. `useAudioChain` guards against this with the `chainRef` early-return at the top of `initChain`. As a consequence:

- The hook must not be used with multiple `videoRef` values over its lifetime. If the video element is replaced (e.g. quality change via src swap), the existing `AudioContext` and its nodes become orphaned. The component tree must be remounted to get a fresh chain.
- Audio tools that call `initAudioChain()` must be rendered under the same component instance that owns the hook. `MediaToolsPanel` satisfies this by receiving `initAudioChain` as a prop from `VideoPlayer`, which owns the `useAudioChain` call.
- The `AudioContext` is created with no explicit `sampleRate` — it defaults to the device's preferred rate.

---

## Quality System (`MediaQualitySelector.tsx`)

### Component: `MediaQualitySelector`

**Exported as:** named export

**Props interface:**

```typescript
interface MediaQualitySelectorProps {
  qualities: QualityOption[]
  currentQuality: QualityOption | null
  onQualityChange: (quality: QualityOption) => void
}
```

`MediaQualitySelector` renders a compact quality picker in the player controls bar (not inside `MediaToolsPanel`). It displays a Settings icon button alongside the current quality label; clicking it opens a dropdown anchored above the button. Each option in `qualities` shows its label and, if `isDirect === true`, a "Direct" badge. The active option shows a checkmark (unless it is a direct-play option, where the badge serves as the indicator). Clicking an option calls `onQualityChange` with the selected `QualityOption` and closes the dropdown.

**Behaviour:**

- The component renders `null` if `qualities.length <= 1`, hiding itself when only one stream option exists.
- The displayed label falls back through: `currentQuality.label` → `qualities[0].label` → `'—'`.
- The dropdown closes on outside click via a `mousedown` listener added to `document` whenever `open === true`, cleaned up on close or unmount.
- The dropdown opens upward (`bottom-full`) and is right-aligned (`right-0`), suitable for placement near the right edge of a player controls bar.
- `QualityOption.streamUrl` and `QualityOption.isHls` are consumed by the parent (`VideoPlayer`) when `onQualityChange` fires — the selector itself does not perform any stream switching.

**Integration note:** The `QualityOption[]` list is built server-side by `getNativePlaybackData()` and surfaced via `PlaybackData.availableQualities`. `isDirect` is set when the stream is a direct play (no server-side transcode). `isHls` is set when the selected stream URL is a `.m3u8` manifest, requiring an HLS player (e.g. `hls.js`) rather than a plain `<video src>` assignment.
