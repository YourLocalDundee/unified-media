# Video Player — Player Tools

All player tool components live in `src/components/player/`. They are composed inside
`MediaToolsPanel`, which `VideoPlayer` renders when the Sliders button is clicked.

## Component map

| File | VLC analogue | Description |
| ---- | ------------ | ----------- |
| `types.ts` | — | Shared interfaces: `PlaybackRate`, `ABLoopState`, `Bookmark`, `VideoFilterState`, `QualityOption`, `AspectRatioMode`, `MediaChapter`, `AudioChainNodes`, EQ presets |
| `MediaSpeedControl` | `rate` Q_PROPERTY | 0.25×–4× speed buttons; syncs from `ratechange` event |
| `MediaABLoop` | `ABLoopA/B`, `toggleABloopState()` | Set A/B points, loop at 300ms poll; clears on unmount |
| `MediaFrameAdvance` | `frameNext()` | Step ±1 frame (1/24s); pauses before stepping |
| `MediaAspectRatio` | `aspectRatio`, `crop`, `fit` | 7 modes; callback to parent to apply CSS |
| `MediaJumpToTime` | Go to Time dialog | MM:SS or HH:MM:SS input, range-validated |
| `MediaVideoEffects` | Extended video effects | CSS `filter` for brightness/contrast/saturation/hue; callback to parent |
| `useAudioChain` | — | Web Audio hook; creates chain lazily, cached in ref — `createMediaElementSource()` can only be called once per element |
| `MediaEqualizer` | `Equalizer`, `equalizer.c` | 10-band EQ via BiquadFilterNodes; 8 presets |
| `MediaAudioTools` | `Compressor`, `gain.c`, `stereo_pan.c` | Volume boost (GainNode), compressor toggle (DynamicsCompressor), stereo pan (StereoPannerNode) |
| `MediaBookmarks` | Bookmarks dialog | localStorage per `storageKey` prop; editable labels |
| `MediaChapters` | chapter TrackListModel | Chapter list from `PlaybackData.chapters`; prev/next nav |
| `MediaSnapshot` | `snapshot()` | Canvas → PNG download |
| `MediaToolsPanel` | Extended panels dialog | 4-tab overlay (Playback / Video / Audio / Info) |
| `MediaQualitySelector` | — | Gear dropdown in controls bar; hidden when only 1 quality available |
| `MediaTransform` | — | Rotation (0/90/180/270°), H/V flip, zoom presets, 3×3 alignment grid; emits CSS transform + alignment strings to VideoPlayer via callbacks; persists to localStorage |

## Web Audio chain constraint

The chain
(`MediaElementSource → 10×BiquadFilter → DynamicsCompressor → GainNode → StereoPanner → destination`)
is created by `useAudioChain(videoRef)` and cached in a `useRef`. Calling
`context.createMediaElementSource(video)` a second time on the same element throws `InvalidStateError`.
The hook guards against this. The chain initializes lazily on first user interaction with an audio
tool (browser autoplay policy).

See `docs/audio-chain.md` for the full chain diagram and per-node parameters.

> Audit note (2026-06-13, A4): the AudioContext was previously never torn down, and browsers cap ~6
> contexts — long sessions broke all audio tools. Teardown is part of the P2 remediation.
