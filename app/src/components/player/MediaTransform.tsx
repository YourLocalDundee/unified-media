// Video geometric transform panel inside MediaToolsPanel's Video tab.
// Provides rotation (0/90/180/270°), horizontal/vertical flip, zoom presets, and
// a 3×3 alignment grid. All transforms are emitted as CSS strings via callbacks
// to the parent VideoPlayer, which applies them on the <video> element.
// Settings persist to localStorage and are restored on mount.
'use client'

import { useState, useEffect } from 'react'

interface MediaTransformProps {
  onTransformChange: (css: string) => void
  onAlignmentChange: (pos: string) => void
}

interface TransformState {
  rotate: 0 | 90 | 180 | 270
  flipH: boolean
  flipV: boolean
  zoom: number
  alignment: string
}

const STORAGE_KEY = 'unified-player-transform'

const DEFAULTS: TransformState = {
  rotate: 0,
  flipH: false,
  flipV: false,
  zoom: 1,
  alignment: 'center center',
}

const ZOOM_PRESETS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
  { label: '200%', value: 2 },
]

const ROTATION_PRESETS = [
  { label: '0°', value: 0 as const },
  { label: '90°', value: 90 as const },
  { label: '180°', value: 180 as const },
  { label: '270°', value: 270 as const },
]

const ALIGNMENT_GRID: { label: string; value: string }[][] = [
  [
    { label: '↖', value: 'top left' },
    { label: '↑', value: 'top center' },
    { label: '↗', value: 'top right' },
  ],
  [
    { label: '←', value: 'center left' },
    { label: '·', value: 'center center' },
    { label: '→', value: 'center right' },
  ],
  [
    { label: '↙', value: 'bottom left' },
    { label: '↓', value: 'bottom center' },
    { label: '↘', value: 'bottom right' },
  ],
]

// Returns an empty string when all transforms are at their identity values so the
// parent can set style.transform = '' and not create a stacking context unnecessarily.
function buildTransform(state: TransformState): string {
  const parts: string[] = []
  if (state.rotate !== 0) parts.push(`rotate(${state.rotate}deg)`)
  if (state.flipH) parts.push('scaleX(-1)')
  if (state.flipV) parts.push('scaleY(-1)')
  if (state.zoom !== 1) parts.push(`scale(${state.zoom})`)
  return parts.join(' ')
}

export default function MediaTransform({ onTransformChange, onAlignmentChange }: MediaTransformProps) {
  const [state, setState] = useState<TransformState>(DEFAULTS)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        // Spread over DEFAULTS so newly added fields don't break old stored objects.
        const parsed = { ...DEFAULTS, ...JSON.parse(saved) } as TransformState
        setState(parsed)
        // Apply immediately so the video loads with saved rotation/zoom — avoids a visible jump.
        onTransformChange(buildTransform(parsed))
        onAlignmentChange(parsed.alignment)
      }
    } catch {
      // ignore malformed storage
    }
  // Callbacks are excluded to match the MediaVideoEffects pattern — see its comment.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyAndSave(next: TransformState) {
    setState(next)
    onTransformChange(buildTransform(next))
    onAlignmentChange(next.alignment)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }

  function handleReset() {
    setState(DEFAULTS)
    onTransformChange('')
    onAlignmentChange(DEFAULTS.alignment)
    localStorage.removeItem(STORAGE_KEY)
  }

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2 block">
          Rotate
        </span>
        <div className="flex gap-2">
          {ROTATION_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => applyAndSave({ ...state, rotate: preset.value })}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                state.rotate === preset.value
                  ? 'bg-white text-black'
                  : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2 block">
          Flip
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => applyAndSave({ ...state, flipH: !state.flipH })}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              state.flipH
                ? 'bg-white text-black'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            Flip H
          </button>
          <button
            type="button"
            onClick={() => applyAndSave({ ...state, flipV: !state.flipV })}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              state.flipV
                ? 'bg-white text-black'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            Flip V
          </button>
        </div>
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2 block">
          Zoom
        </span>
        <div className="flex gap-2 flex-wrap">
          {ZOOM_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => applyAndSave({ ...state, zoom: preset.value })}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                state.zoom === preset.value
                  ? 'bg-white text-black'
                  : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2 block">
          Video Alignment
        </span>
        <div className="inline-grid grid-cols-3 gap-1">
          {ALIGNMENT_GRID.map((row, ri) =>
            row.map((cell) => (
              <button
                key={cell.value}
                type="button"
                onClick={() => applyAndSave({ ...state, alignment: cell.value })}
                className={`w-9 h-9 rounded text-sm font-medium transition-colors ${
                  state.alignment === cell.value
                    ? 'bg-white text-black'
                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                }`}
                aria-label={cell.value}
              >
                {cell.label}
              </button>
            ))
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleReset}
        className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white transition-colors self-start"
      >
        Reset
      </button>
    </div>
  )
}
