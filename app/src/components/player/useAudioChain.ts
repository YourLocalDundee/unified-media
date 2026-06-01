'use client'
import { useRef, useCallback } from 'react'
import type { AudioChainNodes } from './types'
import { EQ_FREQUENCIES } from './types'

export function useAudioChain(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const chainRef = useRef<AudioChainNodes | null>(null)

  const initChain = useCallback((): AudioChainNodes | null => {
    if (chainRef.current) return chainRef.current
    const video = videoRef.current
    if (!video) return null

    const context = new AudioContext()
    const source = context.createMediaElementSource(video)

    const eqFilters = EQ_FREQUENCIES.map((freq) => {
      const filter = context.createBiquadFilter()
      filter.type = 'peaking'
      filter.frequency.value = freq
      filter.Q.value = 1.0
      filter.gain.value = 0
      return filter
    })

    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -24
    compressor.knee.value = 30
    compressor.ratio.value = 12
    compressor.attack.value = 0.003
    compressor.release.value = 0.25

    const gainNode = context.createGain()
    gainNode.gain.value = 1

    const panner = context.createStereoPanner()
    panner.pan.value = 0

    source.connect(eqFilters[0])
    for (let i = 0; i < eqFilters.length - 1; i++) {
      eqFilters[i].connect(eqFilters[i + 1])
    }
    eqFilters[eqFilters.length - 1].connect(compressor)
    compressor.connect(gainNode)
    gainNode.connect(panner)
    panner.connect(context.destination)

    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8
    panner.connect(analyser)

    const splitter = context.createChannelSplitter(2)
    const merger = context.createChannelMerger(2)

    const karaokeGainL = context.createGain()
    karaokeGainL.gain.value = 1
    const karaokeGainR = context.createGain()
    karaokeGainR.gain.value = -1

    chainRef.current = { context, source, gainNode, compressor, panner, eqFilters, analyser, splitter, merger, karaokeGainL, karaokeGainR }
    return chainRef.current
  }, [videoRef])

  return { chainRef, initChain }
}
