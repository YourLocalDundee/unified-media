'use client'

import { AspectRatioMode } from './types'

interface Props {
  currentMode: AspectRatioMode
  onAspectRatioChange: (mode: AspectRatioMode) => void
}

const MODES: { value: AspectRatioMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: '16:9', label: '16:9' },
  { value: '4:3', label: '4:3' },
  { value: '21:9', label: '21:9' },
  { value: '2.35:1', label: '2.35:1' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' },
]

export default function MediaAspectRatio({ currentMode, onAspectRatioChange }: Props) {
  return (
    <div>
      <p className="text-zinc-400 text-xs uppercase mb-2">Aspect Ratio</p>
      <div className="grid grid-cols-4 gap-2">
        {MODES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onAspectRatioChange(value)}
            className={`rounded px-2 py-1.5 text-sm ${
              currentMode === value
                ? 'bg-white text-black font-semibold'
                : 'bg-zinc-700 text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
