// Shared types and constants for the video player tool components.
// Centralised here so MediaToolsPanel and each sub-tool import from one place
// instead of duplicating declarations.

export type PlaybackRate = 0.25 | 0.5 | 0.75 | 1 | 1.25 | 1.5 | 1.75 | 2 | 3 | 4

// Used to pass A/B loop state up to a parent if needed; the component manages
// it internally via useState, so this type exists for potential future lifting.
export interface ABLoopState {
  pointA: number | null
  pointB: number | null
  active: boolean
}

export interface Bookmark {
  id: string
  label: string
  time: number
}

export interface VideoFilterState {
  brightness: number
  contrast: number
  saturation: number
  hue: number
}

// Standard 10-band graphic EQ center frequencies (Hz). Order must match the
// BiquadFilterNode array in useAudioChain — both are indexed in lock-step.
export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const

// Gain values in dB for each of the 10 EQ bands above.
// 'Flat' (all zeros) is the identity — disabling EQ should reset to these values.
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

export type AspectRatioMode = 'auto' | '16:9' | '4:3' | '21:9' | '1:1' | '9:16' | '2.35:1'

// Jellyfin chapter shape. startPositionTicks is in 100-nanosecond ticks;
// divide by 10,000,000 to get seconds.
export interface MediaChapter {
  name: string
  startPositionTicks: number
}

// All nodes that make up the Web Audio processing chain.
// Chain topology: source → eqFilters[0..9] → compressor → gainNode → panner → destination
// The analyser taps off panner for metering (not in the main signal path).
// splitter/merger/karaokeGainL/R are wired dynamically when karaoke mode is activated.
export interface AudioChainNodes {
  context: AudioContext
  source: MediaElementAudioSourceNode
  gainNode: GainNode
  compressor: DynamicsCompressorNode
  panner: StereoPannerNode
  eqFilters: BiquadFilterNode[]
  analyser?: AnalyserNode
  splitter?: ChannelSplitterNode
  merger?: ChannelMergerNode
  karaokeGainL?: GainNode
  karaokeGainR?: GainNode
}

// Built server-side by getPlaybackData() in lib/jellyfin/playback.ts.
// isDirect=true means the original stream URL (no transcoding), which is offered first.
// Lower-quality entries use HLS transcode URLs with MaxHeight/MaxWidth/VideoBitrate params.
export interface QualityOption {
  label: string
  maxHeight: number
  maxWidth: number
  bitrate: number
  isDirect: boolean
  streamUrl: string
  isHls: boolean
}
