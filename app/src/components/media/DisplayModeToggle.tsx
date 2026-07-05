'use client'

/**
 * DisplayModeToggle — admin-only override of the discover-page Arcs/Seasons display for a show
 * that has TMDB story-arc grouping data (shows without it never render this — plain seasons is
 * the only option there). Persists per tmdb_id via show_display_prefs; router.refresh() re-runs
 * the server component so the section below switches immediately.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type DisplayMode = 'arcs' | 'seasons'

interface Props {
  tmdbId: number
  mode: DisplayMode
}

export function DisplayModeToggle({ tmdbId, mode }: Props) {
  const router = useRouter()
  const [current, setCurrent] = useState(mode)
  const [saving, setSaving] = useState(false)

  async function choose(next: DisplayMode) {
    if (next === current || saving) return
    setSaving(true)
    setCurrent(next)
    try {
      await fetch(`/api/media/display-mode/${tmdbId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      router.refresh()
    } catch {
      setCurrent(mode) // revert on failure
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Display:</span>
      <div className="inline-flex rounded-md bg-zinc-900 p-0.5 ring-1 ring-white/5">
        {(['arcs', 'seasons'] as DisplayMode[]).map((m) => (
          <button
            key={m}
            type="button"
            disabled={saving}
            onClick={() => void choose(m)}
            className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${
              current === m ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  )
}
