// A/B loop panel: lets the user mark two points in time and loop between them.
// The loop is implemented with a setInterval poll rather than the 'timeupdate'
// event because 'timeupdate' fires only 4× per second in most browsers, which
// is too coarse for sub-second B-point precision at normal speeds.
'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
  duration: number
}

function formatTime(s: number): string {
  return Math.floor(s / 60) + ':' + String(Math.floor(s) % 60).padStart(2, '0')
}

export default function MediaABLoop({ videoRef }: Props) {
  const [pointA, setPointA] = useState<number | null>(null)
  const [pointB, setPointB] = useState<number | null>(null)
  const [active, setActive] = useState(false)
  const loopIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Ensure the interval is cleared when the component unmounts (e.g. panel closed while looping).
  useEffect(() => {
    return () => {
      if (loopIntervalRef.current !== null) {
        clearInterval(loopIntervalRef.current)
      }
    }
  }, [])

  const handleSetA = () => {
    if (!videoRef.current) return
    setPointA(videoRef.current.currentTime)
  }

  const handleSetB = () => {
    if (!videoRef.current) return
    setPointB(videoRef.current.currentTime)
  }

  const handleToggleLoop = () => {
    if (!videoRef.current || pointA === null || pointB === null) return
    if (active) {
      if (loopIntervalRef.current !== null) {
        clearInterval(loopIntervalRef.current)
        loopIntervalRef.current = null
      }
      setActive(false)
    } else {
      // Capture A/B into closure locals so the interval callback is not
      // affected if the user updates pointA/pointB while the loop is active.
      const a = pointA
      const b = pointB
      // Poll at 300ms — fine enough for practical loop accuracy without taxing the main thread.
      loopIntervalRef.current = setInterval(() => {
        const video = videoRef.current
        if (!video) return
        if (video.currentTime >= b) {
          video.currentTime = a
        }
      }, 300)
      setActive(true)
    }
  }

  const handleClear = () => {
    if (loopIntervalRef.current !== null) {
      clearInterval(loopIntervalRef.current)
      loopIntervalRef.current = null
    }
    setPointA(null)
    setPointB(null)
    setActive(false)
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">A/B Loop</p>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-zinc-300 text-sm">A: {pointA !== null ? formatTime(pointA) : '--:--'}</span>
        <button
          onClick={handleSetA}
          className="bg-zinc-700 text-zinc-300 hover:bg-zinc-600 rounded px-3 py-1.5 text-sm"
        >
          Set A
        </button>
        <span className="text-zinc-300 text-sm">B: {pointB !== null ? formatTime(pointB) : '--:--'}</span>
        <button
          onClick={handleSetB}
          className="bg-zinc-700 text-zinc-300 hover:bg-zinc-600 rounded px-3 py-1.5 text-sm"
        >
          Set B
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleToggleLoop}
          disabled={pointA === null || pointB === null}
          className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed ${
            active ? 'bg-green-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
          }`}
        >
          Loop
        </button>
        <button
          onClick={handleClear}
          className="bg-zinc-700 text-zinc-300 hover:bg-zinc-600 rounded px-3 py-1.5 text-sm"
        >
          Clear
        </button>
      </div>
    </div>
  )
}
