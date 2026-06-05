// Web Audio chain hook for the video player.
// Manages the full signal chain: MediaElementSource → 10×BiquadFilter (EQ) →
// DynamicsCompressor → GainNode (volume boost) → StereoPanner → destination.
// The chain is created lazily on first call to initChain() and then cached in a
// useRef — createMediaElementSource() throws InvalidStateError if called twice on
// the same element, so we must never re-create the chain for the same video element.
'use client'
import { useRef, useCallback } from 'react'
import type { AudioChainNodes } from './types'
import { EQ_FREQUENCIES } from './types'

export function useAudioChain(videoRef: React.RefObject<HTMLVideoElement | null>) {
  // Persists the chain across renders without triggering re-renders.
  const chainRef = useRef<AudioChainNodes | null>(null)

  const initChain = useCallback((): AudioChainNodes | null => {
    // Guard: return existing chain — createMediaElementSource() can only be called once per element.
    if (chainRef.current) return chainRef.current
    const video = videoRef.current
    if (!video) return null

    const context = new AudioContext()
    // This call permanently "claims" the video element into the Web Audio graph.
    // Any subsequent call on the same element throws InvalidStateError.
    const source = context.createMediaElementSource(video)

    // 'peaking' type allows both boost and cut around the center frequency.
    // Q=1.0 gives roughly a one-octave bandwidth per band — wide enough for a graphic EQ.
    // Gain starts at 0 dB (unity); MediaEqualizer drives gain.value at runtime.
    const eqFilters = EQ_FREQUENCIES.map((freq) => {
      const filter = context.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = freq
      filter.Q.value = 1.0
      filter.gain.value = 0
      return filter
    })

    // Default compressor settings match a moderate broadcast-style limiter.
    // ratio=12 means loud transients above -24dB are compressed 12:1.
    // MediaAudioTools bypasses this effect by setting ratio=1 when "Off".
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -24
    compressor.knee.value = 30
    compressor.ratio.value = 12
    compressor.attack.value = 0.003
    compressor.release.value = 0.25

    // Volume boost gain; 1.0 = unity. MediaAudioTools drives this up to 2× (200%).
    const gainNode = context.createGain()
    gainNode.gain.value = 1

    // Stereo pan; 0.0 = center. MediaAudioTools drives this -1 (L) to +1 (R).
    const panner = context.createStereoPanner()
    panner.pan.value = 0

    // Wire the main signal path in series: source → eq chain → compressor → gain → panner → out.
    source.connect(eqFilters[0])
    for (let i = 0; i < eqFilters.length - 1; i++) {
      eqFilters[i].connect(eqFilters[i + 1])
    }
    eqFilters[eqFilters.length - 1].connect(compressor)
    compressor.connect(gainNode)
    gainNode.connect(panner)
    panner.connect(context.destination)

    // Analyser is a passive tap off the panner — does not alter the signal.
    // fftSize=256 gives 128 frequency bins, enough for the normalizer's RMS calculation.
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    panner.connect(analyser)

    // Karaoke nodes are created now but NOT connected — they are wired/unwired
    // dynamically by handleKaraokeToggle() in MediaAudioTools.
    const splitter = context.createChannelSplitter(2)
    const merger = context.createChannelMerger(2)

    // Phase cancellation: L=+1 and R=-1 sum to zero for center-panned audio (vocals).
    // Instruments that are hard-panned survive because only one channel contributes.
    const karaokeGainL = context.createGain()
    karaokeGainL.gain.value = 1
    const karaokeGainR = context.createGain()
    karaokeGainR.gain.value = -1

    chainRef.current = { context, source, gainNode, compressor, panner, eqFilters, analyser, splitter, merger, karaokeGainL, karaokeGainR }
    return chainRef.current
  }, [videoRef])

  return { chainRef, initChain }
}
