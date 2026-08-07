// Video color/filter adjustment panel inside MediaToolsPanel's Video tab.
// All effects are applied as a CSS filter string via the onFilterChange callback —
// the parent VideoPlayer sets it on the <video> element's style.filter property.
// Settings are persisted to localStorage so they survive panel close/reopen.
'use client'

import { useState, useEffect } from 'react'
import { RotateCcw } from 'lucide-react'
import { VideoFilterState } from './types'

interface ExtendedFilterState extends VideoFilterState {
  blur: number
  grayscale: boolean
  invert: boolean
  sepia: boolean
}

interface MediaVideoEffectsProps {
  onFilterChange: (cssFilter: string) => void
}

const STORAGE_KEY = 'unified-player-video-effects'

const DEFAULTS: ExtendedFilterState = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  blur: 0,
  grayscale: false,
  invert: false,
  sepia: false,
}

// Continuous filters (brightness, contrast, saturation, hue, blur) are always
// included because omitting them from the CSS filter string would reset them to
// browser defaults. Toggle filters (grayscale, invert, sepia) are only appended
// when active to keep the string short.
function buildCssFilter(state: ExtendedFilterState): string {
  const parts: string[] = [
    `brightness(${state.brightness}%)`,
    `contrast(${state.contrast}%)`,
    `saturate(${state.saturation}%)`,
    `hue-rotate(${state.hue}deg)`,
  ]
  if (state.blur > 0) parts.push(`blur(${state.blur}px)`)
  if (state.grayscale) parts.push('grayscale(100%)')
  if (state.invert) parts.push('invert(100%)')
  if (state.sepia) parts.push('sepia(100%)')
  return parts.join(' ')
}

export default function MediaVideoEffects({ onFilterChange }: MediaVideoEffectsProps) {
  const [filters, setFilters] = useState<ExtendedFilterState>(DEFAULTS)

  // Deferred a tick so the restore setState runs outside the effect's synchronous
  // commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const tid = setTimeout(() => {
      try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
          // Spread over DEFAULTS so any new keys added in future code don't break old stored state.
          const parsed = { ...DEFAULTS, ...JSON.parse(saved) } as ExtendedFilterState
          setFilters(parsed)
          // Apply immediately so the video loads with the user's saved settings.
          onFilterChange(buildCssFilter(parsed))
        }
      } catch {
        // ignore malformed storage
      }
    }, 0)
    return () => clearTimeout(tid)
  // onFilterChange is intentionally excluded — including it would cause this to
  // re-fire whenever the parent re-renders, clobbering mid-session changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyAndSave(next: ExtendedFilterState) {
    setFilters(next)
    onFilterChange(buildCssFilter(next))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function handleRange(key: keyof ExtendedFilterState, value: number) {
    applyAndSave({ ...filters, [key]: value })
  }

  function handleToggle(key: 'grayscale' | 'invert' | 'sepia') {
    applyAndSave({ ...filters, [key]: !filters[key] })
  }

  function handleReset() {
    setFilters(DEFAULTS)
    onFilterChange('')
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
        Video Adjustments
      </span>

      <div className="flex items-center gap-3">
        <span className="w-24 text-sm text-zinc-300">Brightness</span>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={filters.brightness}
          onChange={(e) => handleRange('brightness', e.target.valueAsNumber)}
          className="flex-1 accent-white"
        />
        <span className="w-12 text-right text-sm text-zinc-400 tabular-nums">
          {filters.brightness}%
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-24 text-sm text-zinc-300">Contrast</span>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={filters.contrast}
          onChange={(e) => handleRange('contrast', e.target.valueAsNumber)}
          className="flex-1 accent-white"
        />
        <span className="w-12 text-right text-sm text-zinc-400 tabular-nums">
          {filters.contrast}%
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-24 text-sm text-zinc-300">Saturation</span>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={filters.saturation}
          onChange={(e) => handleRange('saturation', e.target.valueAsNumber)}
          className="flex-1 accent-white"
        />
        <span className="w-12 text-right text-sm text-zinc-400 tabular-nums">
          {filters.saturation}%
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-24 text-sm text-zinc-300">Hue</span>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={filters.hue}
          onChange={(e) => handleRange('hue', e.target.valueAsNumber)}
          className="flex-1 accent-white"
        />
        <span className="w-12 text-right text-sm text-zinc-400 tabular-nums">
          {filters.hue}&deg;
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-24 text-sm text-zinc-300">Blur</span>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={filters.blur}
          onChange={(e) => handleRange('blur', e.target.valueAsNumber)}
          className="flex-1 accent-white"
        />
        <span className="w-12 text-right text-sm text-zinc-400 tabular-nums">
          {filters.blur}px
        </span>
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {(['grayscale', 'invert', 'sepia'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => handleToggle(key)}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors capitalize ${
              filters[key]
                ? 'bg-white text-black'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={handleReset}
        className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white transition-colors mt-3 self-start"
      >
        <RotateCcw size={14} />
        Reset
      </button>
    </div>
  )
}
