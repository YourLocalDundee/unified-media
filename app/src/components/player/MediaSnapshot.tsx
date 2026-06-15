// Snapshot panel inside MediaToolsPanel's Info tab.
// Draws the current video frame onto an off-screen canvas and triggers a PNG
// download. The canvas approach is required because <video> elements cannot be
// right-click-saved when CORS headers are absent on the stream URL.
'use client'

import { useState } from 'react'
import { Camera } from 'lucide-react'

interface MediaSnapshotProps {
  videoRef: React.RefObject<HTMLVideoElement>
  title: string
}

export default function MediaSnapshot({ videoRef, title }: MediaSnapshotProps) {
  const [feedback, setFeedback] = useState<'idle' | 'saved' | 'error'>('idle')

  const handleSnapshot = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setFeedback('error')
      setTimeout(() => setFeedback('idle'), 2000)
      return
    }

    // Canvas is sized to the video's intrinsic resolution, not the rendered size.
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    // drawImage/toBlob throw a SecurityError on a tainted canvas (cross-origin stream
    // without CORS). The native /api/media/stream is same-origin, but the Jellyfin
    // proxy path could taint it — catch so it surfaces as feedback, not an uncaught
    // exception (A4-L1).
    try {
      canvas.getContext('2d')!.drawImage(video, 0, 0)
      canvas.toBlob((blob) => {
        if (!blob) { setFeedback('error'); setTimeout(() => setFeedback('idle'), 2000); return }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const timestamp = Date.now()
        a.href = url
        a.download = `${title}-${timestamp}.png`
        // Programmatic click triggers the browser's save dialog without a user gesture on the link.
        a.click()
        // Defer the revoke — a large (4K) PNG may still be reading when the URL is
        // revoked on the next line, aborting the save.
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        setFeedback('saved')
        setTimeout(() => setFeedback('idle'), 2000)
      }, 'image/png')
    } catch {
      setFeedback('error')
      setTimeout(() => setFeedback('idle'), 2000)
    }
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">Snapshot</p>
      <button
        onClick={handleSnapshot}
        className="flex items-center gap-2 bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded text-sm text-white"
      >
        <Camera size={16} />
        Take Snapshot
      </button>
      {feedback === 'saved' && (
        <p className="text-green-400 text-sm mt-2">Saved!</p>
      )}
      {feedback === 'error' && (
        <p className="text-red-400 text-sm mt-2">No video loaded</p>
      )}
    </div>
  )
}
