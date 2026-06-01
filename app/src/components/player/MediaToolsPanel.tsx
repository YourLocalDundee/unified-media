'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import type { MediaChapter, AspectRatioMode, AudioChainNodes } from './types'
import MediaSpeedControl from './MediaSpeedControl'
import MediaABLoop from './MediaABLoop'
import MediaFrameAdvance from './MediaFrameAdvance'
import MediaAspectRatio from './MediaAspectRatio'
import MediaJumpToTime from './MediaJumpToTime'
import MediaVideoEffects from './MediaVideoEffects'
import MediaEqualizer from './MediaEqualizer'
import MediaAudioTools from './MediaAudioTools'
import MediaBookmarks from './MediaBookmarks'
import MediaChapters from './MediaChapters'
import MediaSnapshot from './MediaSnapshot'
import MediaSubtitles from './MediaSubtitles'
import MediaTransform from './MediaTransform'

type Tab = 'playback' | 'video' | 'subtitles' | 'audio' | 'info'

const TABS: { id: Tab; label: string }[] = [
  { id: 'playback', label: 'Playback' },
  { id: 'video', label: 'Video' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'audio', label: 'Audio' },
  { id: 'info', label: 'Info' },
]

interface MediaToolsPanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  duration: number
  itemId: string
  itemTitle: string
  chapters: MediaChapter[]
  initAudioChain: () => AudioChainNodes | null
  currentAspectRatio: AspectRatioMode
  onAspectRatioChange: (mode: AspectRatioMode) => void
  onVideoFilterChange: (cssFilter: string) => void
  onVideoTransformChange: (css: string) => void
  onVideoAlignmentChange: (pos: string) => void
  onClose: () => void
}

export function MediaToolsPanel({
  videoRef: videoRefProp,
  duration,
  itemId,
  itemTitle,
  chapters,
  initAudioChain,
  currentAspectRatio,
  onAspectRatioChange,
  onVideoFilterChange,
  onVideoTransformChange,
  onVideoAlignmentChange,
  onClose,
}: MediaToolsPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('playback')
  const videoRef = videoRefProp as React.RefObject<HTMLVideoElement>

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 bg-zinc-900 border-t border-zinc-700 flex flex-col"
      style={{ maxHeight: '60vh' }}
    >
      <div className="flex items-center bg-zinc-800 shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-white text-white'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="p-3 text-zinc-400 hover:text-white transition-colors"
          aria-label="Close tools panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-y-auto flex-1">
        {activeTab === 'playback' && (
          <div className="flex flex-col gap-6 p-4">
            <MediaSpeedControl videoRef={videoRef} />
            <hr className="border-zinc-700" />
            <MediaABLoop videoRef={videoRef} duration={duration} />
            <hr className="border-zinc-700" />
            <MediaFrameAdvance videoRef={videoRef} />
            <hr className="border-zinc-700" />
            <MediaAspectRatio
              currentMode={currentAspectRatio}
              onAspectRatioChange={onAspectRatioChange}
            />
            <hr className="border-zinc-700" />
            <MediaJumpToTime videoRef={videoRef} duration={duration} />
          </div>
        )}

        {activeTab === 'video' && (
          <div className="p-4 flex flex-col gap-4">
            <MediaVideoEffects onFilterChange={onVideoFilterChange} />
            <hr className="border-zinc-700" />
            <MediaTransform
              onTransformChange={onVideoTransformChange}
              onAlignmentChange={onVideoAlignmentChange}
            />
          </div>
        )}

        {activeTab === 'subtitles' && (
          <div className="p-4">
            <MediaSubtitles videoRef={videoRef} />
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="flex flex-col gap-6 p-4">
            <MediaEqualizer initAudioChain={initAudioChain} />
            <hr className="border-zinc-700" />
            <MediaAudioTools initAudioChain={initAudioChain} videoRef={videoRef} />
          </div>
        )}

        {activeTab === 'info' && (
          <div className="flex flex-col gap-6 p-4">
            <MediaBookmarks
              videoRef={videoRef}
              storageKey={`bookmarks-${itemId}`}
            />
            <hr className="border-zinc-700" />
            <MediaChapters
              videoRef={videoRef}
              chapters={chapters}
              duration={duration}
            />
            <hr className="border-zinc-700" />
            <MediaSnapshot videoRef={videoRef} title={itemTitle} />
          </div>
        )}
      </div>
    </div>
  )
}
