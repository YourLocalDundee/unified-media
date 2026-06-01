'use client'

import { useEffect, useState } from 'react'

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4]

interface Props {
  videoRef: React.RefObject<HTMLVideoElement>
}

export default function MediaSpeedControl({ videoRef }: Props) {
  const [currentRate, setCurrentRate] = useState(1)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const stored = localStorage.getItem('unified-player-speed')
    if (stored) {
      const rate = parseFloat(stored)
      if (PLAYBACK_RATES.includes(rate)) {
        video.playbackRate = rate
      }
    }
    const handleRateChange = () => setCurrentRate(video.playbackRate)
    video.addEventListener('ratechange', handleRateChange)
    return () => video.removeEventListener('ratechange', handleRateChange)
  }, [videoRef])

  const handleRateClick = (rate: number) => {
    if (!videoRef.current) return
    videoRef.current.playbackRate = rate
    localStorage.setItem('unified-player-speed', String(rate))
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">Playback Speed</p>
      <div className="flex flex-wrap gap-2">
        {PLAYBACK_RATES.map((rate) => (
          <button
            key={rate}
            onClick={() => handleRateClick(rate)}
            className={`rounded px-3 py-1.5 text-sm ${
              currentRate === rate
                ? 'bg-white text-black font-semibold'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {rate === 1 ? 'Normal' : `${rate}×`}
          </button>
        ))}
      </div>
    </div>
  )
}
