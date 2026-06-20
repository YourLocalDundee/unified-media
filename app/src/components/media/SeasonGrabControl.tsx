'use client'

/**
 * SeasonGrabControl — admin-only "grab this season" control on a discover detail
 * season card (Part B). Opens a modal to pick language + quality profile, then:
 *   1. tries a season pack (POST /api/grab/season mode:auto)
 *   2. if no pack exists for that season+language, offers an episode-by-episode grab
 *      (mode:episodes) — one wanted item per episode, which the 15-min grab cron then
 *      finds until the season is complete.
 *
 * Rendered only when the viewer is an admin (the parent gates on session.role).
 */

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, X, Check } from 'lucide-react'
import { ModalPortal } from '@/components/ui/ModalPortal'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { LANGUAGE_OPTIONS } from './RequestOptions'

interface Props {
  tmdbId: number
  title: string
  year: number | null
  seasonNumber: number
  seasonName: string
  episodeCount: number | null
}

interface QualityProfile {
  id: number
  name: string
}

type UIState = 'idle' | 'searching' | 'no_pack' | 'grabbed' | 'queuing' | 'queued' | 'error'

interface AutoResult {
  result: 'pack_grabbed' | 'no_pack'
  episodeCount?: number
  release?: { title: string; indexer: string }
  error?: string
}

export function SeasonGrabControl({ tmdbId, title, year, seasonNumber, seasonName, episodeCount }: Props) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState('en')
  const [profiles, setProfiles] = useState<QualityProfile[]>([])
  const [profileId, setProfileId] = useState<number>(1)
  const [ui, setUi] = useState<UIState>('idle')
  const [msg, setMsg] = useState('')
  const [foundEpisodeCount, setFoundEpisodeCount] = useState<number>(episodeCount ?? 0)

  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, open, () => setOpen(false))

  // Load quality profiles when the modal opens.
  useEffect(() => {
    if (!open || profiles.length > 0) return
    fetch('/api/quality-profiles')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { profiles?: QualityProfile[] }) => {
        const list = data.profiles ?? []
        setProfiles(list)
        if (list.length > 0) setProfileId(list[0].id)
      })
      .catch(() => setProfiles([]))
  }, [open, profiles.length])

  function reset() {
    setUi('idle')
    setMsg('')
  }

  async function post(mode: 'auto' | 'episodes') {
    const res = await fetch('/api/grab/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdbId, title, year, seasonNumber, language, qualityProfileId: profileId, mode }),
    })
    const data = await res.json().catch(() => ({})) as AutoResult & { result?: string; count?: number }
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    return data
  }

  async function grabAuto() {
    setUi('searching')
    setMsg('')
    try {
      const data = await post('auto')
      if (data.result === 'pack_grabbed') {
        setUi('grabbed')
        setMsg(data.release ? `${data.release.title} · ${data.release.indexer}` : 'Season pack sent to downloads.')
      } else {
        setFoundEpisodeCount(data.episodeCount ?? episodeCount ?? 0)
        setUi('no_pack')
      }
    } catch (err) {
      setUi('error')
      setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  async function grabEpisodes() {
    setUi('queuing')
    try {
      const data = await post('episodes')
      setUi('queued')
      setMsg(`Queued ${data.count ?? foundEpisodeCount} episodes — they'll grab in the background until the season is full.`)
    } catch (err) {
      setUi('error')
      setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = ui === 'searching' || ui === 'queuing'

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true) }}
        className="mt-1 inline-flex w-full items-center justify-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700 transition-colors"
      >
        <Download className="h-3 w-3" /> Grab
      </button>

      {open && (
        <ModalPortal>
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="season-grab-title"
              className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
            >
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 id="season-grab-title" className="text-base font-semibold text-zinc-100">Grab season</h2>
                  <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">{title} — {seasonName}</p>
                </div>
                <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Pickers */}
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Language
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    disabled={busy}
                    className="rounded-md bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-600"
                  >
                    {LANGUAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs text-zinc-400">
                  Quality profile
                  <select
                    value={profileId}
                    onChange={(e) => setProfileId(Number(e.target.value))}
                    disabled={busy || profiles.length === 0}
                    className="rounded-md bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-600"
                  >
                    {profiles.length === 0 && <option value={1}>Any</option>}
                    {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              </div>

              {/* Result / action */}
              <div className="mt-4">
                {ui === 'grabbed' && (
                  <p className="flex items-start gap-1.5 rounded-md bg-green-900/40 px-3 py-2 text-xs text-green-300">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Season pack grabbed. {msg}
                  </p>
                )}
                {ui === 'queued' && (
                  <p className="rounded-md bg-sky-900/40 px-3 py-2 text-xs text-sky-300">{msg}</p>
                )}
                {ui === 'error' && (
                  <p className="rounded-md bg-red-900/40 px-3 py-2 text-xs text-red-300">{msg || 'Something went wrong.'}</p>
                )}
                {ui === 'no_pack' && (
                  <div className="flex flex-col gap-2">
                    <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
                      No season pack found in {LANGUAGE_OPTIONS.find((l) => l.value === language)?.label ?? language}.
                      {foundEpisodeCount > 0 && ` Grab the ${foundEpisodeCount} episodes individually?`} They'll keep
                      searching until the season is complete.
                    </p>
                    <button
                      onClick={grabEpisodes}
                      className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600"
                    >
                      Grab episode by episode
                    </button>
                  </div>
                )}

                {(ui === 'idle' || ui === 'searching' || ui === 'queuing') && (
                  <button
                    onClick={grabAuto}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-60"
                  >
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                    {ui === 'searching' ? 'Searching for season pack…' : ui === 'queuing' ? 'Queuing episodes…' : 'Grab season pack'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  )
}
