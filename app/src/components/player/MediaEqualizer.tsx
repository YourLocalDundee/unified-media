// 10-band graphic equalizer panel inside MediaToolsPanel's Audio tab.
// The EQ is off by default; enabling it triggers lazy audio chain creation via
// initAudioChain(). Gain values are persisted to localStorage so the curve
// survives panel close/reopen, but they are not applied to the chain until the
// EQ is explicitly enabled to avoid unnecessary audio processing overhead.
'use client'

import { useState, useRef, useEffect } from 'react'
import type { AudioChainNodes } from './types'
import { EQ_FREQUENCIES, EQ_PRESETS } from './types'

interface Props {
  initAudioChain: () => AudioChainNodes | null
}

const DEFAULT_GAINS = Array(EQ_FREQUENCIES.length).fill(0) as number[]

export default function MediaEqualizer({ initAudioChain }: Props) {
  const [enabled, setEnabled] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState('Flat')
  const [gains, setGains] = useState<number[]>(DEFAULT_GAINS)
  const chainRef = useRef<AudioChainNodes | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem('unified-player-eq')
      if (raw) {
        const stored = JSON.parse(raw) as number[]
        // Length check ensures we don't apply a partially-saved array if the
        // EQ_FREQUENCIES list is ever extended.
        if (Array.isArray(stored) && stored.length === EQ_FREQUENCIES.length) {
          setGains(stored)
          // Chain may already exist if another audio tool was opened first.
          if (chainRef.current) {
            applyGainsToChain(chainRef.current, stored)
          }
        }
      }
    } catch {}
  }, [])

  function applyGainsToChain(chain: AudioChainNodes, values: number[]) {
    values.forEach((g, i) => {
      if (chain.eqFilters[i]) {
        chain.eqFilters[i].gain.value = g
      }
    })
  }

  // True bypass (A4-L3): lift the 10 biquads out of the signal path entirely so the
  // disabled EQ processes no samples — `source → compressor` directly — rather than the
  // old soft-bypass that left all 10 filters in-path at 0 dB. The compressor/gain/panner
  // (and karaoke, which taps the panner) are downstream and untouched, so other audio
  // tools keep working. disconnect() throws when the edge doesn't exist — guard each.
  function engageEq(chain: AudioChainNodes) {
    const eq = chain.eqFilters
    if (eq.length === 0) return
    try { chain.source.disconnect(chain.compressor) } catch {}
    try { chain.source.connect(eq[0]) } catch {}
    try { eq[eq.length - 1].connect(chain.compressor) } catch {}
  }

  function bypassEq(chain: AudioChainNodes) {
    const eq = chain.eqFilters
    if (eq.length === 0) return
    try { chain.source.disconnect(eq[0]) } catch {}
    try { eq[eq.length - 1].disconnect(chain.compressor) } catch {}
    try { chain.source.connect(chain.compressor) } catch {}
  }

  function handleToggle() {
    if (!enabled) {
      // First enable: lazy-init the audio chain (no-op if already created by another tool).
      const chain = initAudioChain()
      if (!chain) return
      chainRef.current = chain
      engageEq(chain)
      applyGainsToChain(chain, gains)
      setEnabled(true)
    } else {
      // Disabling: truly bypass the EQ band (remove the biquads from the path) rather
      // than destroying the shared chain, which other audio tools may still be using.
      if (chainRef.current) {
        bypassEq(chainRef.current)
      }
      setEnabled(false)
    }
  }

  function handlePresetChange(preset: string) {
    setSelectedPreset(preset)
    const presetGains = EQ_PRESETS[preset]
    if (!presetGains) return
    setGains(presetGains)
    localStorage.setItem('unified-player-eq', JSON.stringify(presetGains))
    if (enabled && chainRef.current) {
      applyGainsToChain(chainRef.current, presetGains)
    }
  }

  function handleBandChange(index: number, value: number) {
    const next = gains.map((g, i) => (i === index ? value : g))
    setGains(next)
    setSelectedPreset('Custom')
    localStorage.setItem('unified-player-eq', JSON.stringify(next))
    if (enabled && chainRef.current) {
      if (chainRef.current.eqFilters[index]) {
        chainRef.current.eqFilters[index].gain.value = value
      }
    }
  }

  function formatFreq(freq: number): string {
    return freq < 1000 ? `${freq}Hz` : `${freq / 1000}k`
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <span className="text-zinc-400 text-xs uppercase tracking-wide">Equalizer</span>

      <button
        type="button"
        onClick={handleToggle}
        className={`self-start rounded px-3 py-1.5 text-sm font-medium transition-colors ${
          enabled ? 'bg-green-600 text-white hover:bg-green-500' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
        }`}
      >
        {enabled ? 'EQ On' : 'Enable EQ'}
      </button>

      <div className="flex flex-wrap gap-1">
        {Object.keys(EQ_PRESETS).map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => handlePresetChange(preset)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              selectedPreset === preset
                ? 'bg-white text-black font-semibold'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {preset}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {EQ_FREQUENCIES.map((freq, i) => (
          <div key={freq} className="flex items-center gap-3">
            <span className="w-12 text-xs text-zinc-400 text-right">{formatFreq(freq)}</span>
            <input
              type="range"
              min={-12}
              max={12}
              step={0.5}
              value={gains[i] ?? 0}
              onChange={(e) => handleBandChange(i, e.target.valueAsNumber)}
              className="flex-1 accent-white"
            />
            <span className="w-10 text-right text-xs text-zinc-400 tabular-nums">
              {(gains[i] ?? 0) > 0 ? '+' : ''}{(gains[i] ?? 0).toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
