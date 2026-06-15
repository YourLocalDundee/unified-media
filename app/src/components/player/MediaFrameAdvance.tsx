// Frame-by-frame advance/rewind panel.
// The frame rate is measured from the video itself via requestVideoFrameCallback
// (A4-M5) rather than assuming 24 fps — so the step size and frame counter are
// correct for 25/30/50/60 fps content too. Falls back to 24 fps when rVFC is
// unavailable or the video hasn't presented enough frames yet to measure.
'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const DEFAULT_FPS = 24

interface FrameMeta {
  mediaTime: number
  presentedFrames: number
}
type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, metadata: FrameMeta) => void) => number
}

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
  const [fps, setFps] = useState(DEFAULT_FPS)
  const fpsRef = useRef(DEFAULT_FPS)
  useEffect(() => { fpsRef.current = fps }, [fps])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [videoRef])

  // Measure fps over a short window of presented frames (requires playback — paused
  // video presents no frames, so it stays at the default until the user plays once).
  useEffect(() => {
    const video = videoRef.current as VideoWithRVFC | null
    if (!video || typeof video.requestVideoFrameCallback !== 'function') return
    let cancelled = false
    let first: FrameMeta | null = null
    const onFrame = (_now: number, md: FrameMeta) => {
      if (cancelled) return
      if (!first) {
        first = { mediaTime: md.mediaTime, presentedFrames: md.presentedFrames }
      } else {
        const dt = md.mediaTime - first.mediaTime
        const df = md.presentedFrames - first.presentedFrames
        if (dt > 0.25 && df > 0) {
          const measured = df / dt
          if (measured >= 10 && measured <= 121) setFps(Math.round(measured))
          return // stable estimate captured — stop sampling
        }
      }
      video.requestVideoFrameCallback?.(onFrame)
    }
    video.requestVideoFrameCallback(onFrame)
    return () => { cancelled = true }
  }, [videoRef])

  const handleForward = () => {
    const video = videoRef.current
    if (!video) return
    // Must pause before seeking; seeking a playing video causes the browser to
    // resume from the new position, making the step invisible to the user.
    video.pause()
    video.currentTime += 1 / fpsRef.current
  }

  const handleBack = () => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    // Clamp to 0 to avoid negative currentTime which some browsers reject.
    video.currentTime = Math.max(0, video.currentTime - 1 / fpsRef.current)
  }

  const frameNumber = Math.floor(currentTime * fps)

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
      <p className="text-zinc-400 text-xs">{formatTimeDetailed(currentTime)} · {fps} fps</p>
    </div>
  )
}
