// Jump-to-time panel inside MediaToolsPanel's Playback tab.
// Accepts freeform text in MM:SS or HH:MM:SS format and seeks the video directly.
'use client'

import { useEffect, useState } from 'react'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
  duration: number
}

function formatTime(s: number): string {
  return Math.floor(s / 60) + ':' + String(Math.floor(s) % 60).padStart(2, '0')
}

// Returns total seconds, or null if the format is unrecognised.
// Only two-part (MM:SS) and three-part (HH:MM:SS) are accepted; single-part
// (raw seconds) is intentionally excluded to avoid ambiguity.
function parseTimeInput(input: string): number | null {
  const parts = input.trim().split(':')
  if (parts.length < 2 || parts.length > 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => isNaN(n))) return null
  if (parts.length === 2) {
    const [m, s] = nums
    return m * 60 + s
  }
  const [h, m, s] = nums
  return h * 3600 + m * 60 + s
}

export default function MediaJumpToTime({ videoRef, duration }: Props) {
  const [currentTime, setCurrentTime] = useState(0)
  const [input, setInput] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [videoRef])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const parsed = parseTimeInput(input)
    if (parsed === null) {
      setError('Invalid format. Use MM:SS or HH:MM:SS.')
      return
    }
    if (parsed < 0 || parsed > duration) {
      setError('Time is out of range.')
      return
    }
    if (!videoRef.current) return
    videoRef.current.currentTime = parsed
    setError('')
    setInput('')
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">Jump to Time</p>
      <p className="text-zinc-400 text-xs mb-2">
        Current: {formatTime(currentTime)} / {formatTime(duration)}
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="MM:SS or HH:MM:SS"
          className="bg-zinc-700 text-white rounded px-3 py-2 text-sm w-full outline-none focus:ring-1 ring-white"
        />
        <button
          type="submit"
          className="bg-white text-black px-4 py-2 rounded text-sm font-medium"
        >
          Go
        </button>
      </form>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}
