export type PlaybackRate = 0.25 | 0.5 | 0.75 | 1 | 1.25 | 1.5 | 1.75 | 2 | 3 | 4

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

export const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000] as const

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

export interface MediaChapter {
  name: string
  startPositionTicks: number
}

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

export interface QualityOption {
  label: string
  maxHeight: number
  maxWidth: number
  bitrate: number
  isDirect: boolean
  streamUrl: string
  isHls: boolean
}
