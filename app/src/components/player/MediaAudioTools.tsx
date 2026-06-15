// Audio processing tools panel inside MediaToolsPanel's Audio tab.
// Controls: volume boost (GainNode), dynamics compressor (DynamicsCompressorNode),
// stereo pan (StereoPannerNode), volume normalizer (RMS-based gain automation),
// noise gate (RMS threshold gating), and karaoke/vocal remover (phase cancellation).
// All tools share the single Web Audio chain from useAudioChain() via initAudioChain().
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { RotateCcw } from 'lucide-react'
import type { AudioChainNodes } from './types'

interface Props {
  initAudioChain: () => AudioChainNodes | null
  videoRef: React.RefObject<HTMLVideoElement>
}

// Disconnect the karaoke sub-graph and restore panner → destination. Module-level
// so it is stable for both the toggle-off path and the unmount cleanup (A4-H2).
function teardownKaraokeGraph(chain: AudioChainNodes) {
  const { panner, splitter, merger, karaokeGainL, karaokeGainR, context } = chain
  // The karaoke nodes are optional on the type; if the sub-graph was never built
  // there is nothing to tear down — just make sure panner reaches the destination.
  // disconnect() throws if the connection doesn't exist — guard each so a partial
  // teardown still completes rather than aborting mid-way.
  if (splitter && merger && karaokeGainL && karaokeGainR) {
    try { panner.disconnect(splitter) } catch {}
    try { splitter.disconnect(karaokeGainL, 0) } catch {}
    try { splitter.disconnect(karaokeGainR, 1) } catch {}
    try { karaokeGainL.disconnect(merger, 0, 0) } catch {}
    try { karaokeGainR.disconnect(merger, 0, 0) } catch {}
    try { merger.disconnect(context.destination) } catch {}
  }
  try { panner.connect(context.destination) } catch {}
}

export default function MediaAudioTools({ initAudioChain, videoRef }: Props) {
  const [volumeGain, setVolumeGain] = useState(1)
  const [compressorEnabled, setCompressorEnabled] = useState(false)
  const [pan, setPan] = useState(0)
  const [normalizer, setNormalizer] = useState(false)
  const [noiseGate, setNoiseGate] = useState(false)
  const [noiseGateThreshold, setNoiseGateThreshold] = useState(0.05)
  const [karaoke, setKaraoke] = useState(false)

  const normalizerCleanupRef = useRef<(() => void) | null>(null)
  const noiseGateCleanupRef = useRef<(() => void) | null>(null)
  // Refs mirror state so that the normalizer/noise-gate interval callbacks can
  // read the current value without being re-created every time the user moves a slider.
  const volumeGainRef = useRef(volumeGain)
  useEffect(() => { volumeGainRef.current = volumeGain }, [volumeGain])
  const noiseGateThresholdRef = useRef(noiseGateThreshold)
  useEffect(() => { noiseGateThresholdRef.current = noiseGateThreshold }, [noiseGateThreshold])
  // Mirror karaoke state so the empty-dep unmount effect can read its CURRENT value.
  const karaokeRef = useRef(karaoke)
  useEffect(() => { karaokeRef.current = karaoke }, [karaoke])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('unified-player-audio')
      if (raw) {
        const stored = JSON.parse(raw)
        if (stored.gain !== undefined) setVolumeGain(stored.gain)
        if (stored.compressorOn !== undefined) setCompressorEnabled(stored.compressorOn)
        if (stored.pan !== undefined) setPan(stored.pan)
        if (stored.normalizer !== undefined) setNormalizer(stored.normalizer)
        if (stored.noiseGate !== undefined) setNoiseGate(stored.noiseGate)
        if (stored.noiseGateThreshold !== undefined) setNoiseGateThreshold(stored.noiseGateThreshold)
        if (stored.karaoke !== undefined) setKaraoke(stored.karaoke)
      }
    } catch {}
  }, [])

  function saveAudio(patch: Record<string, unknown>) {
    try {
      const raw = localStorage.getItem('unified-player-audio')
      const existing = raw ? JSON.parse(raw) : {}
      localStorage.setItem('unified-player-audio', JSON.stringify({ ...existing, ...patch }))
    } catch {}
  }

  // Returns RMS amplitude in the range 0–1.
  // getByteTimeDomainData returns values 0–255 where 128 = silence, so we
  // re-center by dividing by 128 and subtracting 1 before squaring.
  function sampleRms(analyser: AnalyserNode): number {
    const buffer = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(buffer)
    let sum = 0
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i] / 128 - 1
      sum += v * v
    }
    return Math.sqrt(sum / buffer.length)
  }

  const startNormalizer = useCallback(() => {
    const video = videoRef.current
    const chain = initAudioChain()
    if (!video || !chain?.analyser) return
    const { analyser, gainNode } = chain
    // TARGET_RMS of 0.2 is ~-14 dBFS, roughly "conversational" loudness.
    const TARGET_RMS = 0.2
    function onTimeUpdate() {
      const rms = sampleRms(analyser)
      if (rms > 0) {
        // Clamp gain: floor 0.5 prevents over-amplifying quiet moments; ceil 3.0
        // prevents blowing out transients in near-silent passages.
        gainNode.gain.value = Math.min(3.0, Math.max(0.5, TARGET_RMS / rms))
      }
    }
    // 'timeupdate' fires ~4×/s — cheap enough for gain automation without an interval.
    video.addEventListener('timeupdate', onTimeUpdate)
    normalizerCleanupRef.current = () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [initAudioChain, videoRef])

  const stopNormalizer = useCallback(() => {
    normalizerCleanupRef.current?.()
    normalizerCleanupRef.current = null
    const chain = initAudioChain()
    if (chain) chain.gainNode.gain.value = volumeGainRef.current
  }, [initAudioChain])

  const startNoiseGate = useCallback(() => {
    const video = videoRef.current
    const chain = initAudioChain()
    if (!video || !chain?.analyser) return
    const { analyser, gainNode } = chain
    function onTimeUpdate() {
      const rms = sampleRms(analyser)
      if (rms < noiseGateThresholdRef.current) {
        gainNode.gain.value = 0.01
      } else {
        gainNode.gain.value = volumeGainRef.current
      }
    }
    video.addEventListener('timeupdate', onTimeUpdate)
    noiseGateCleanupRef.current = () => {
      video.removeEventListener('timeupdate', onTimeUpdate)
    }
  }, [initAudioChain, videoRef])

  const stopNoiseGate = useCallback(() => {
    noiseGateCleanupRef.current?.()
    noiseGateCleanupRef.current = null
    const chain = initAudioChain()
    if (chain) chain.gainNode.gain.value = volumeGainRef.current
  }, [initAudioChain])

  function handleVolumeChange(value: number) {
    setVolumeGain(value)
    saveAudio({ gain: value })
    const chain = initAudioChain()
    if (chain && !normalizer && !noiseGate) {
      chain.gainNode.gain.value = value
    }
  }

  function handleCompressorToggle() {
    const next = !compressorEnabled
    setCompressorEnabled(next)
    saveAudio({ compressorOn: next })
    const chain = initAudioChain()
    if (!chain) return
    if (next) {
      // Restore the same default settings set during chain init in useAudioChain.
      chain.compressor.threshold.value = -24
      chain.compressor.knee.value = 30
      chain.compressor.ratio.value = 12
      chain.compressor.attack.value = 0.003
      chain.compressor.release.value = 0.25
    } else {
      // ratio=1 is unity (no compression) — the node stays in the graph but passes through.
      chain.compressor.ratio.value = 1
    }
  }

  function handlePanChange(value: number) {
    setPan(value)
    saveAudio({ pan: value })
    const chain = initAudioChain()
    if (chain) chain.panner.pan.value = value
  }

  function handlePanReset() {
    setPan(0)
    saveAudio({ pan: 0 })
    const chain = initAudioChain()
    if (chain) chain.panner.pan.value = 0
  }

  function handleNormalizerToggle() {
    const next = !normalizer
    setNormalizer(next)
    saveAudio({ normalizer: next })
    if (next) {
      // Normalizer and noise gate both write to gainNode.gain, so they conflict.
      // Enabling normalizer forces noise gate off.
      stopNoiseGate()
      startNormalizer()
    } else {
      stopNormalizer()
    }
  }

  function handleNoiseGateToggle() {
    const next = !noiseGate
    setNoiseGate(next)
    saveAudio({ noiseGate: next })
    if (next) {
      startNoiseGate()
    } else {
      stopNoiseGate()
    }
  }

  function handleNoiseGateThresholdChange(value: number) {
    setNoiseGateThreshold(value)
    saveAudio({ noiseGateThreshold: value })
  }

  function handleKaraokeToggle() {
    const next = !karaoke
    setKaraoke(next)
    saveAudio({ karaoke: next })
    const chain = initAudioChain()
    if (!chain?.splitter || !chain.merger || !chain.karaokeGainL || !chain.karaokeGainR) return
    const { panner, splitter, merger, karaokeGainL, karaokeGainR, context } = chain
    if (next) {
      // Insert the karaoke sub-graph between panner and destination:
      // panner → splitter → karaokeGainL (×+1) ──→ merger → destination
      //                   → karaokeGainR (×-1) ──↗
      // L channel is added as-is; R channel is phase-inverted. Center-panned
      // audio (e.g. lead vocals) cancels out; hard-panned content survives.
      panner.disconnect(context.destination)
      panner.connect(splitter)
      splitter.connect(karaokeGainL, 0)
      splitter.connect(karaokeGainR, 1)
      karaokeGainL.connect(merger, 0, 0)
      karaokeGainR.connect(merger, 0, 0)
      merger.connect(context.destination)
    } else {
      teardownKaraokeGraph(chain)
    }
  }

  useEffect(() => {
    return () => {
      normalizerCleanupRef.current?.()
      noiseGateCleanupRef.current?.()
      // Tear down the karaoke sub-graph if it was left wired when the panel closed,
      // so it doesn't dangle off the (closing) AudioContext on unmount (A4-H2).
      if (karaokeRef.current) {
        const chain = initAudioChain()
        if (chain) teardownKaraokeGraph(chain)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2">
        <span className="text-zinc-400 text-xs uppercase tracking-wide">Volume Boost</span>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={volumeGain}
            onChange={(e) => handleVolumeChange(e.target.valueAsNumber)}
            className="flex-1 accent-white"
          />
          <span className="w-12 text-right text-sm text-zinc-400 tabular-nums">
            {Math.round(volumeGain * 100)}%
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-zinc-400 text-xs uppercase tracking-wide">Compressor</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCompressorToggle}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              compressorEnabled
                ? 'bg-green-600 text-white hover:bg-green-500'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {compressorEnabled ? 'Active' : 'Off'}
          </button>
          <span className="text-sm text-zinc-400">
            Compressor: {compressorEnabled ? 'Active' : 'Off'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-zinc-400 text-xs uppercase tracking-wide">Stereo Pan</span>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 w-4">L</span>
          <input
            type="range"
            min={-1}
            max={1}
            step={0.05}
            value={pan}
            onChange={(e) => handlePanChange(e.target.valueAsNumber)}
            className="flex-1 accent-white"
          />
          <span className="text-xs text-zinc-400 w-4 text-right">R</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 tabular-nums">
            {pan === 0 ? 'Center' : pan < 0 ? `L ${Math.abs(Math.round(pan * 100))}%` : `R ${Math.round(pan * 100)}%`}
          </span>
          <button
            type="button"
            onClick={handlePanReset}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-white transition-colors"
          >
            <RotateCcw size={12} />
            Center
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-zinc-400 text-xs uppercase tracking-wide">Volume Normalizer</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleNormalizerToggle}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              normalizer
                ? 'bg-blue-600 text-white hover:bg-blue-500'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {normalizer ? 'Active' : 'Off'}
          </button>
          <span className="text-xs text-zinc-500">
            Auto-adjusts gain to target consistent loudness
          </span>
        </div>
        {normalizer && noiseGate && (
          <span className="text-xs text-amber-400">Normalizer takes priority over Noise Gate when both are on</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-zinc-400 text-xs uppercase tracking-wide">Noise Gate</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleNoiseGateToggle}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              noiseGate
                ? 'bg-orange-600 text-white hover:bg-orange-500'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {noiseGate ? 'Active' : 'Off'}
          </button>
          <span className="text-xs text-zinc-500">Mute below threshold</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400 w-16">Threshold</span>
          <input
            type="range"
            min={0.01}
            max={0.3}
            step={0.01}
            value={noiseGateThreshold}
            onChange={(e) => handleNoiseGateThresholdChange(e.target.valueAsNumber)}
            className="flex-1 accent-white"
          />
          <span className="w-10 text-right text-xs text-zinc-400 tabular-nums">
            {noiseGateThreshold.toFixed(2)}
          </span>
        </div>
        {normalizer && noiseGate && (
          <span className="text-xs text-amber-400">Noise Gate inactive while Normalizer is on</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-zinc-400 text-xs uppercase tracking-wide">Karaoke / Vocal Remover</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleKaraokeToggle}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              karaoke
                ? 'bg-purple-600 text-white hover:bg-purple-500'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {karaoke ? 'Active' : 'Off'}
          </button>
          <span className="text-xs text-zinc-500">
            Phase-cancels center-panned audio (vocals)
          </span>
        </div>
      </div>
    </div>
  )
}
