// Quality selector dropdown rendered in the player controls bar (not inside MediaToolsPanel).
// Calls onQualityChange with the selected QualityOption; VideoPlayer handles swapping the
// stream URL and triggering HLS reinitialisation. Hidden entirely when only one quality is
// available to avoid showing a non-functional control.
'use client'

import { useState, useRef, useEffect } from 'react'
import { Settings, ChevronUp, ChevronDown, Check } from 'lucide-react'
import type { QualityOption } from './types'

interface MediaQualitySelectorProps {
  qualities: QualityOption[]
  currentQuality: QualityOption | null
  onQualityChange: (quality: QualityOption) => void
}

export function MediaQualitySelector({
  qualities,
  currentQuality,
  onQualityChange,
}: MediaQualitySelectorProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close the dropdown on any click outside the component.
  // Listener is only attached while the dropdown is open to avoid an always-on global listener.
  useEffect(() => {
    if (!open) return
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [open])

  if (qualities.length <= 1) return null

  const label = currentQuality?.label ?? qualities[0]?.label ?? '—'

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors p-1"
        aria-label="Quality settings"
      >
        <Settings className="h-4 w-4" />
        <span className="text-xs tabular-nums hidden sm:inline">{label}</span>
        {open ? (
          <ChevronDown className="h-3 w-3 hidden sm:inline" />
        ) : (
          <ChevronUp className="h-3 w-3 hidden sm:inline" />
        )}
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 right-0 min-w-[150px] bg-zinc-800 rounded-lg border border-zinc-600 shadow-xl overflow-hidden z-50">
          {qualities.map((q) => {
            const isActive = currentQuality?.label === q.label
            return (
              <button
                key={q.label}
                onClick={() => {
                  onQualityChange(q)
                  setOpen(false)
                }}
                className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors text-left ${
                  isActive
                    ? 'text-white font-semibold bg-zinc-700'
                    : 'text-zinc-300 hover:text-white hover:bg-zinc-700'
                }`}
              >
                <span className="flex-1">{q.label}</span>
                {q.isDirect && (
                  <span className="bg-zinc-600 text-zinc-200 text-xs px-1.5 py-0.5 rounded shrink-0">
                    Direct
                  </span>
                )}
                {isActive && !q.isDirect && (
                  <Check className="h-3 w-3 shrink-0" />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
