// Subtitle appearance settings panel inside MediaToolsPanel's Subtitles tab.
// Styles are applied by injecting a <style> tag with ::cue pseudo-element rules —
// the only CSS mechanism for styling HTML5 native subtitle tracks (WebVTT cues).
// Settings are persisted to localStorage and restored on mount.
'use client'

import { useEffect, useRef, useState } from 'react'

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

// Upsert a single <style> tag with a stable ID so repeated calls replace the
// previous rules rather than accumulating duplicate stylesheet elements.
function injectStyle(css: string) {
  let el = document.getElementById('unified-subtitle-cue') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'unified-subtitle-cue'
    document.head.appendChild(el)
  }
  el.textContent = css
}

export default function MediaSubtitles({ videoRef }: Props) {
  const [delay, setDelay] = useState(0)
  // Each cue's TRUE (unshifted) start/end, captured the first time we touch it, so
  // re-applying a new delay offsets from the original rather than compounding.
  const originalCueTimes = useRef(new WeakMap<TextTrackCue, { start: number; end: number }>())
  const [fontSize, setFontSize] = useState<FontSize>('100%')
  const [color, setColor] = useState<FontColor>('#ffffff')
  const [background, setBackground] = useState<Background>('transparent')
  const [align, setAlign] = useState<TextAlign>('center')
  const [shadow, setShadow] = useState<Shadow>('outline')
  const [opacity, setOpacity] = useState(100)

  // Deferred a tick so the restore setStates run outside the effect's synchronous
  // commit path (react-hooks/set-state-in-effect).
  useEffect(() => {
    const tid = setTimeout(() => {
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
    }, 0)
    return () => clearTimeout(tid)
  }, [])

  useEffect(() => {
    injectStyle(buildCueStyle(fontSize, color, background, align, shadow, opacity))
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ delay, fontSize, color, background, align, shadow, opacity }),
    )
  }, [delay, fontSize, color, background, align, shadow, opacity])

  // Apply the delay to the actual subtitle cue timestamps (A4-M6). Previously this
  // control mutated nothing — it shifted only its own state. We offset every loaded
  // cue's start/end by delay seconds from its captured original, and re-apply when a
  // track is added (VideoPlayer mounts one <track> per stream) so a freshly loaded
  // track also picks up the current offset.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const shiftSec = delay / 1000
    const applyShift = () => {
      for (const track of Array.from(video.textTracks)) {
        const cues = track.cues
        if (!cues) continue
        for (let i = 0; i < cues.length; i++) {
          const cue = cues[i]
          let orig = originalCueTimes.current.get(cue)
          if (!orig) {
            orig = { start: cue.startTime, end: cue.endTime }
            originalCueTimes.current.set(cue, orig)
          }
          cue.startTime = Math.max(0, orig.start + shiftSec)
          cue.endTime = Math.max(0, orig.end + shiftSec)
        }
      }
    }
    applyShift()
    video.textTracks.addEventListener('addtrack', applyShift)
    return () => video.textTracks.removeEventListener('addtrack', applyShift)
  }, [delay, videoRef])

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
