# Web Audio API Chain

Technical reference for the audio processing pipeline used in the unified-frontend media player.

---

## 1. Architecture

Every audio frame decoded from the video element passes through a fixed sequence of Web Audio API nodes before reaching the speakers. The chain is constructed once per `HTMLVideoElement` instance and lives for the lifetime of that element.

```
HTMLVideoElement
    |
    v
MediaElementAudioSourceNode  (createMediaElementSource — once per element)
    |
    v
BiquadFilterNode[0]   (60 Hz,    peaking, Q=1.0)
    |
    v
BiquadFilterNode[1]   (170 Hz,   peaking, Q=1.0)
    |
    v
BiquadFilterNode[2]   (310 Hz,   peaking, Q=1.0)
    |
    v
BiquadFilterNode[3]   (600 Hz,   peaking, Q=1.0)
    |
    v
BiquadFilterNode[4]   (1000 Hz,  peaking, Q=1.0)
    |
    v
BiquadFilterNode[5]   (3000 Hz,  peaking, Q=1.0)
    |
    v
BiquadFilterNode[6]   (6000 Hz,  peaking, Q=1.0)
    |
    v
BiquadFilterNode[7]   (12000 Hz, peaking, Q=1.0)
    |
    v
BiquadFilterNode[8]   (14000 Hz, peaking, Q=1.0)
    |
    v
BiquadFilterNode[9]   (16000 Hz, peaking, Q=1.0)
    |
    v
DynamicsCompressorNode
    |
    v
GainNode
    |
    v
StereoPannerNode
    |
    v
AudioContext.destination
```

Relevant source files:

- `app/src/components/player/useAudioChain.ts` — chain construction and caching
- `app/src/components/player/types.ts` — `AudioChainNodes`, `EQ_FREQUENCIES`, `EQ_PRESETS`
- `app/src/components/player/MediaEqualizer.tsx` — equalizer UI, reads and writes `eqFilters[i].gain`
- `app/src/components/player/MediaAudioTools.tsx` — compressor, volume boost, and panner UI

---

## 2. Initialization Constraint

`AudioContext.createMediaElementSource()` can only be called once per `HTMLVideoElement`. Calling it a second time on the same element throws `InvalidStateError: Failed to execute 'createMediaElementSource' on 'AudioContext': HTMLMediaElement already connected previously to a different MediaElementSourceNode`.

The `useAudioChain` hook guards against this with a `useRef`:

```ts
const chainRef = useRef<AudioChainNodes | null>(null)

const initChain = useCallback((): AudioChainNodes | null => {
  if (chainRef.current) return chainRef.current   // return cached chain on repeat calls
  // ... build chain ...
  chainRef.current = { context, source, gainNode, compressor, panner, eqFilters }
  return chainRef.current
}, [videoRef])
```

On the first call, `initChain` allocates an `AudioContext`, calls `createMediaElementSource`, wires all nodes, and stores the result in `chainRef`. Every subsequent call returns the cached `AudioChainNodes` object without touching the element again.

**Browser autoplay policy:** `AudioContext` starts in the `suspended` state until a user gesture occurs (click, keypress, touch). `initChain` must be called from within a user interaction handler — the player does this by triggering it on the first play action. Attempting to build the chain before a gesture will result in silence even though the chain is wired correctly.

---

## 3. Hook API

```ts
function useAudioChain(
  videoRef: React.RefObject<HTMLVideoElement | null>
): {
  chainRef: React.RefObject<AudioChainNodes | null>
  initChain: () => AudioChainNodes | null
}
```

**Parameters**

- `videoRef` — a ref pointing to the `HTMLVideoElement` that is the audio source. Must be populated before `initChain` is called.

**Return value**

| Property | Type | Description |
|---|---|---|
| `chainRef` | `RefObject<AudioChainNodes \| null>` | Direct ref to the cached chain. `null` until `initChain` is called at least once. Use this to read current node state without triggering initialization. |
| `initChain` | `() => AudioChainNodes \| null` | Initializes the chain on first call, returns the cached chain on subsequent calls. Returns `null` if `videoRef.current` is not yet set. Safe to call multiple times. |

**`AudioChainNodes` shape** (from `types.ts`):

```ts
interface AudioChainNodes {
  context: AudioContext
  source: MediaElementAudioSourceNode
  gainNode: GainNode
  compressor: DynamicsCompressorNode
  panner: StereoPannerNode
  eqFilters: BiquadFilterNode[]    // length 10, ordered by EQ_FREQUENCIES
}
```

---

## 4. Equalizer

Modeled after VLC's `equalizer.c`. Implemented as 10 `BiquadFilterNode` instances wired in series.

**Node configuration (per band)**

| Parameter | Value |
|---|---|
| `type` | `'peaking'` |
| `Q` | `1.0` |
| `gain` (default) | `0 dB` |
| Gain range | `-12 dB` to `+12 dB` |

**Band frequencies** (defined in `EQ_FREQUENCIES` in `types.ts`):

| Index | Frequency |
|---|---|
| 0 | 60 Hz |
| 1 | 170 Hz |
| 2 | 310 Hz |
| 3 | 600 Hz |
| 4 | 1000 Hz |
| 5 | 3000 Hz |
| 6 | 6000 Hz |
| 7 | 12000 Hz |
| 8 | 14000 Hz |
| 9 | 16000 Hz |

**Presets** (defined in `EQ_PRESETS` in `types.ts`, values in dB per band, index 0–9):

| Preset | 60 | 170 | 310 | 600 | 1k | 3k | 6k | 12k | 14k | 16k |
|---|---|---|---|---|---|---|---|---|---|---|
| Flat | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Rock | +4.5 | +3 | -2 | -4 | -2 | +2 | +5 | +6 | +6 | +6 |
| Pop | -1.5 | +4.5 | +7 | +8 | +6.5 | +3 | -1.5 | -2.5 | -2.5 | -3 |
| Jazz | +4 | +3 | +1 | +2 | -2 | -2 | 0 | +1 | +3 | +4 |
| Classical | +5 | +4 | +3 | +2 | -2 | -2 | 0 | +2 | +3 | +4 |
| Bass | +5 | +4 | +3 | +2 | +1 | 0 | 0 | 0 | 0 | 0 |
| Treble | 0 | 0 | 0 | 0 | 0 | +1 | +2 | +3 | +4 | +5 |
| Vocal | -2 | 0 | +3 | +5 | +5 | +5 | +3 | +2 | 0 | -2 |

**Enable/disable behavior:** When the EQ is disabled, `MediaEqualizer` resets all `eqFilters[i].gain.value` to `0` rather than disconnecting the nodes. The nodes remain in the chain at all times; zero gain on a peaking filter is a passthrough.

---

## 5. Compressor

Modeled after VLC's `compressor.c`. Uses a single `DynamicsCompressorNode` positioned after the EQ band and before the gain node.

**Enabled preset values:**

| Parameter | Value |
|---|---|
| `threshold` | -24 dB |
| `knee` | 30 dB |
| `ratio` | 12:1 |
| `attack` | 3 ms (0.003 s) |
| `release` | 250 ms (0.25 s) |

**Bypass behavior:** The `DynamicsCompressorNode` cannot be disconnected from the chain without rebuilding it (there is no insert/remove API for Web Audio graphs). Bypass is achieved by setting `ratio` to `1`, which makes the compressor transparent (1:1 gain reduction has no effect on any signal level). All other parameters are left unchanged when bypassed.

```ts
// enabled
chain.compressor.ratio.value = 12

// bypassed
chain.compressor.ratio.value = 1
```

---

## 6. Gain / Volume Boost

Modeled after VLC's `gain.c`. Implemented as a `GainNode` positioned after the compressor.

| Parameter | Value |
|---|---|
| Node type | `GainNode` |
| Default | `1.0` (100%) |
| Range | `0.0` to `2.0` |
| UI display | 0% to 200% |

Values above `1.0` amplify the signal beyond its original level. Signals that are already near full scale will clip at the `AudioContext.destination` if gain pushes them above 0 dBFS. The compressor upstream reduces peaks, which provides some headroom for boosted gain, but clipping is still possible with loud source material and high gain settings.

---

## 7. Stereo Panner

Modeled after VLC's `stereo_pan.c`. Implemented as a `StereoPannerNode` positioned at the end of the chain, just before `AudioContext.destination`.

| Parameter | Value |
|---|---|
| Node type | `StereoPannerNode` |
| Default | `0` (center) |
| Range | `-1.0` (full left) to `1.0` (full right) |
| UI step | `0.05` |

The `StereoPannerNode` uses the equal-power panning algorithm defined in the Web Audio API spec. At `pan = 0`, both channels receive equal gain. At `pan = -1` or `pan = 1`, all audio is routed to the respective channel only.

The UI in `MediaAudioTools` displays the position as `L N%` or `R N%` and provides a reset button that sets `pan` back to `0` (center).
