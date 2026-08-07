'use client'

/**
 * CountdownOverlay — the full-screen pre-play countdown (feature: ready-check lobby).
 *
 * Shown while a host-triggered start countdown is in flight. Renders a large
 * 5 → 4 → 3 → 2 → 1 number computed live from the shared `endsAt` wall-clock target
 * (adjusted by nothing here — the parent hook already schedules the actual play at
 * endsAt; this is purely the visual). The remaining seconds are recomputed on an
 * interval; `prefers-reduced-motion` suppresses the per-number pop animation.
 *
 * The number is derived from Date.now() inside an effect/interval (never during
 * render — react-hooks/purity), so the initial render shows a neutral placeholder
 * until the first tick lands (which fires immediately).
 */

import { useEffect, useState, useSyncExternalStore } from 'react'

interface Props {
  /** Shared server wall-clock target (ms) when playback starts. */
  endsAt: number
}

function computeRemaining(endsAt: number): number {
  const msLeft = endsAt - Date.now()
  if (msLeft <= 0) return 0
  return Math.ceil(msLeft / 1000)
}

// prefers-reduced-motion via useSyncExternalStore — the §7-compliant pattern for a
// media-query (no setState synchronously inside an effect body). Server snapshot is
// `false` so SSR renders the animated variant, corrected on hydration if needed.
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
function subscribeReducedMotion(cb: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

export function CountdownOverlay({ endsAt }: Props) {
  // Remaining whole seconds. Initialised to null so we never read the clock during
  // render; the mount effect below sets it on the first tick (fires immediately).
  const [remaining, setRemaining] = useState<number | null>(null)
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false)

  useEffect(() => {
    // Tick every 100ms so the displayed number flips promptly at each second boundary.
    // The first paint is deferred a tick (setTimeout 0) rather than set synchronously in
    // the effect body — §7 set-state-in-effect. Both callbacks run outside the effect body.
    const tick = () => setRemaining(computeRemaining(endsAt))
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 100)
    return () => {
      clearTimeout(first)
      clearInterval(id)
    }
  }, [endsAt])

  const label = remaining == null ? '' : remaining > 0 ? String(remaining) : 'Go!'

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/70 backdrop-blur-sm">
      <style>{`
        @keyframes party-countdown-pop {
          0%   { opacity: 0; transform: scale(0.6); }
          25%  { opacity: 1; transform: scale(1.15); }
          60%  { opacity: 1; transform: scale(1); }
          100% { opacity: 0.85; transform: scale(0.95); }
        }
      `}</style>
      <p className="mb-4 text-sm font-medium uppercase tracking-widest text-zinc-300">
        Starting together…
      </p>
      <div
        // Re-key on the number so the pop animation restarts each second.
        key={label}
        className="select-none text-[8rem] font-bold leading-none text-white drop-shadow-2xl tabular-nums sm:text-[12rem]"
        style={
          reducedMotion
            ? undefined
            : { animation: 'party-countdown-pop 1000ms ease-out forwards' }
        }
        aria-live="assertive"
      >
        {label}
      </div>
    </div>
  )
}
