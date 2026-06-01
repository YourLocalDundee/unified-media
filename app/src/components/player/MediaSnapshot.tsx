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

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)

    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const timestamp = Date.now()
      a.href = url
      a.download = `${title}-${timestamp}.png`
      a.click()
      URL.revokeObjectURL(url)
      setFeedback('saved')
      setTimeout(() => setFeedback('idle'), 2000)
    }, 'image/png')
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
