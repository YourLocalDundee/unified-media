// Frame-by-frame advance/rewind panel.
// Assumes 24 fps — the most common film frame rate. The browser has no API to
// query the actual frame rate of the loaded video, so 1/24 s is a reasonable
// constant. Users can nudge manually if the content is 25/30/60 fps.
'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

// Step size in seconds. 1/24 ≈ 41.67ms per frame.
const FRAME_DURATION = 1 / 24

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
}

function formatTimeDetailed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 1000)
  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(s).padStart(2, '0') +
    '.' +
    String(ms).padStart(3, '0')
  )
}

export default function MediaFrameAdvance({ videoRef }: Props) {
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [videoRef])

  const handleForward = () => {
    const video = videoRef.current
    if (!video) return
    // Must pause before seeking; seeking a playing video causes the browser to
    // resume from the new position, making the step invisible to the user.
    video.pause()
    video.currentTime += FRAME_DURATION
  }

  const handleBack = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    // Clamp to 0 to avoid negative currentTime which some browsers reject.
    video.currentTime = Math.max(0, video.currentTime - FRAME_DURATION)
  }

  // Approximate frame counter, assuming 24 fps.
  const frameNumber = Math.floor(currentTime * 24)

  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">Frame Step</p>
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={handleBack}
          className="bg-zinc-700 text-zinc-300 hover:bg-zinc-600 rounded p-1.5"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={handleForward}
          className="bg-zinc-700 text-zinc-300 hover:bg-zinc-600 rounded p-1.5"
        >
          <ChevronRight size={18} />
        </button>
        <span className="text-zinc-300 text-sm">Frame {frameNumber}</span>
      </div>
      <p className="text-zinc-400 text-xs">{formatTimeDetailed(currentTime)}</p>
    </div>
  )
}
