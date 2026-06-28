// Chapter navigation panel inside MediaToolsPanel's Info tab.
// Chapter data is a MediaChapter[] with startPositionTicks in 100ns ticks.
// The current chapter is determined by scanning the list for the last chapter whose
// start time is <= the current playback position.
'use client'

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { MediaChapter } from './types'

interface MediaChaptersProps {
  videoRef: React.RefObject<HTMLVideoElement>
  chapters: MediaChapter[]
  duration: number
}

function formatTime(s: number): string {
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0')
}

export default function MediaChapters({ videoRef, chapters, duration: _duration }: MediaChaptersProps) {
  const [currentTime, setCurrentTime] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [videoRef])

  // Convert 100-nanosecond ticks to seconds: 10,000,000 ticks = 1 second.
  const chapterTimes = chapters.map((c) => c.startPositionTicks / 10_000_000)

  const currentIndex = (() => {
    let idx = -1
    for (let i = 0; i < chapterTimes.length; i++) {
      if (chapterTimes[i] <= currentTime) idx = i
    }
    return idx
  })()

  const handleSeek = (time: number) => {
    if (!videoRef.current) return
    videoRef.current.currentTime = time
  }

  const handlePrev = () => {
    if (currentIndex <= 0) return
    handleSeek(chapterTimes[currentIndex - 1])
  }

  const handleNext = () => {
    if (currentIndex >= chapters.length - 1) return
    handleSeek(chapterTimes[currentIndex + 1])
  }

  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">Chapters</p>
      {chapters.length === 0 ? (
        <p className="text-zinc-500 text-sm">No chapters available</p>
      ) : (
        <>
          <div className="flex gap-2 mb-3">
            <button
              onClick={handlePrev}
              disabled={currentIndex <= 0}
              className="flex items-center gap-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={14} />
              Prev
            </button>
            <button
              onClick={handleNext}
              disabled={currentIndex >= chapters.length - 1}
              className="flex items-center gap-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
          <ul className="flex flex-col gap-0.5">
            {chapters.map((chapter, i) => {
              const startSecs = chapterTimes[i]
              const isCurrent = i === currentIndex
              return (
                <li
                  key={i}
                  onClick={() => handleSeek(startSecs)}
                  className={`py-2 px-3 rounded cursor-pointer flex justify-between ${
                    isCurrent
                      ? 'bg-zinc-700 text-white'
                      : 'text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  <span className="text-sm truncate">{chapter.name}</span>
                  <span className="text-xs text-zinc-400 shrink-0 ml-2 font-mono">
                    {formatTime(startSecs)}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
