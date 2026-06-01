'use client'

import { useEffect, useState } from 'react'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
}

type FontSize = '80%' | '100%' | '130%' | '160%'
type FontColor = '#ffffff' | '#ffff00' | '#00ffff'
type Background = 'transparent' | 'rgba(0,0,0,0.5)' | 'rgba(0,0,0,0.8)'
type TextAlign = 'left' | 'center' | 'right'
type Shadow = 'none' | 'outline' | 'drop' | 'glow'

const STORAGE_KEY = 'unified-player-subtitles'

const DELAY_STEP = 100
const DELAY_MIN = -5000
const DELAY_MAX = 5000

const SHADOW_MAP: Record<Shadow, string> = {
  none: 'none',
  outline: '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000',
  drop: '2px 2px 4px rgba(0,0,0,0.9)',
  glow: '0 0 8px rgba(0,0,0,1), 0 0 4px rgba(0,0,0,1)',
}

function buildCueStyle(
  fontSize: FontSize,
  color: FontColor,
  background: Background,
  align: TextAlign,
  shadow: Shadow,
  opacity: number,
): string {
  return `::cue { font-size: ${fontSize}; color: ${color}; background-color: ${background}; text-align: ${align}; text-shadow: ${SHADOW_MAP[shadow]}; opacity: ${opacity / 100}; }`
}

function injectStyle(css: string) {
  let el = document.getElementById('unified-subtitle-cue') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'unified-subtitle-cue'
    document.head.appendChild(el)
  }
  el.textContent = css
}

export default function MediaSubtitles({ videoRef: _videoRef }: Props) {
  const [delay, setDelay] = useState(0)
  const [fontSize, setFontSize] = useState<FontSize>('100%')
  const [color, setColor] = useState<FontColor>('#ffffff')
  const [background, setBackground] = useState<Background>('transparent')
  const [align, setAlign] = useState<TextAlign>('center')
  const [shadow, setShadow] = useState<Shadow>('outline')
  const [opacity, setOpacity] = useState(100)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const stored = JSON.parse(raw)
        if (stored.delay !== undefined) setDelay(stored.delay)
        if (stored.fontSize) setFontSize(stored.fontSize)
        if (stored.color) setColor(stored.color)
        if (stored.background !== undefined) setBackground(stored.background)
        if (stored.align) setAlign(stored.align)
        if (stored.shadow) setShadow(stored.shadow)
        if (stored.opacity !== undefined) setOpacity(stored.opacity)
      }
    } catch {}
  }, [])

  useEffect(() => {
    injectStyle(buildCueStyle(fontSize, color, background, align, shadow, opacity))
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ delay, fontSize, color, background, align, shadow, opacity }),
    )
  }, [delay, fontSize, color, background, align, shadow, opacity])

  function adjustDelay(delta: number) {
    setDelay((prev) => Math.max(DELAY_MIN, Math.min(DELAY_MAX, prev + delta)))
  }

  function formatDelay(ms: number): string {
    return ms >= 0 ? `+${ms}ms` : `${ms}ms`
  }

  const selectClass =
    'rounded bg-zinc-700 border border-zinc-600 px-2 py-1 text-sm text-zinc-100'
  const btnClass =
    'px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm'

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          Subtitle Delay
        </p>
        <div className="flex items-center gap-3">
          <button className={btnClass} onClick={() => adjustDelay(-DELAY_STEP)}>
            -100ms
          </button>
          <span className="text-sm text-zinc-300 w-20 text-center tabular-nums">
            {formatDelay(delay)}
          </span>
          <button className={btnClass} onClick={() => adjustDelay(DELAY_STEP)}>
            +100ms
          </button>
          {delay !== 0 && (
            <button
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              onClick={() => setDelay(0)}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          Font Size
        </p>
        <select
          className={selectClass}
          value={fontSize}
          onChange={(e) => setFontSize(e.target.value as FontSize)}
        >
          <option value="80%">Small (80%)</option>
          <option value="100%">Normal (100%)</option>
          <option value="130%">Large (130%)</option>
          <option value="160%">X-Large (160%)</option>
        </select>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          Font Color
        </p>
        <select
          className={selectClass}
          value={color}
          onChange={(e) => setColor(e.target.value as FontColor)}
        >
          <option value="#ffffff">White</option>
          <option value="#ffff00">Yellow</option>
          <option value="#00ffff">Cyan</option>
        </select>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          Background
        </p>
        <select
          className={selectClass}
          value={background}
          onChange={(e) => setBackground(e.target.value as Background)}
        >
          <option value="transparent">None</option>
          <option value="rgba(0,0,0,0.5)">Dim</option>
          <option value="rgba(0,0,0,0.8)">Dark</option>
        </select>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          Text Alignment
        </p>
        <select
          className={selectClass}
          value={align}
          onChange={(e) => setAlign(e.target.value as TextAlign)}
        >
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          Text Shadow
        </p>
        <select
          className={selectClass}
          value={shadow}
          onChange={(e) => setShadow(e.target.value as Shadow)}
        >
          <option value="none">None</option>
          <option value="outline">Outline</option>
          <option value="drop">Drop Shadow</option>
          <option value="glow">Glow</option>
        </select>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">
          Opacity — {opacity}%
        </p>
        <input
          type="range"
          min={20}
          max={100}
          step={5}
          value={opacity}
          onChange={(e) => setOpacity(Number(e.target.value))}
          className="w-full accent-zinc-400"
        />
      </div>
    </div>
  )
}
