'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

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
    video.pause()
    video.currentTime += FRAME_DURATION
  }

  const handleBack = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    video.currentTime = Math.max(0, video.currentTime - FRAME_DURATION)
  }

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
