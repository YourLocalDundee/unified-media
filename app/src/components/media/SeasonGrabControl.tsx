'use client'

/**
 * SeasonGrabControl — admin-only direct-grab control on a discover detail page. Grabs either a
 * plain TV season OR a TMDB story arc (Bug 7), depending on which props are passed.
 *
 * Three actions in the modal:
 *   1. "Grab pack"      — POST /api/grab/season mode:auto → creates the 'wanted' item and opens
 *      GrabConfirmModal(itemId), which does the actual pack search and lets the admin confirm,
 *      walk to the next best, or drop to the interactive picker. Nothing is grabbed by this click
 *      alone — see the route's doc comment.
 *   2. "Choose release" — admin interactive pick: searches /api/torrent-search (FULL candidate set,
 *      zero hard rejects) and grabs the chosen release via the SAME enqueue path (override mode).
 *   3. "Grab episode by episode" — mode:episodes fans out one wanted item per episode for the
 *      5-min grab cron. These are SCHEDULED for search, not downloading yet (covering packs found
 *      for this scope ARE grabbed immediately — a bulk fan-out action, no single release to
 *      confirm, so it's untouched by grab-confirmation).
 *
 * Rendered only when the viewer is an admin (the parent gates on session.role).
 */

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, X, Check, Search } from 'lucide-react'
import { ModalPortal } from '@/components/ui/ModalPortal'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { LANGUAGE_OPTIONS, AUDIO_MODE_OPTIONS } from './RequestOptions'
import { useGrabConfirm } from './GrabConfirmModal'
import { formatBytes } from '@/lib/utils'

interface ArcScope {
  name: string
  episodes: { s: number; e: number }[]
}

interface Props {
  tmdbId: number
  title: string
  year: number | null
  seasonNumber?: number          // plain-season grab
  seasonName: string             // display label ("Season 13" or arc name)
  episodeCount: number | null
  arc?: ArcScope                 // when set, this is an arc grab (overrides seasonNumber)
}

interface QualityProfile {
  id: number
  name: string
}

interface Candidate {
  title: string
  infoHash: string
  magnetUrl: string
  downloadUrl: string
  size: number
  seeders: number
  indexerName: string
  score: number
  // Hard-gate failures from the search API (feature 1). Shown as badges; the row stays grab-able
  // because this is the override surface.
  gates?: string[]
  // Detected dub/sub tag (null/undefined = untagged) — server-computed, see torrent-search/route.ts.
  audioMode?: 'dub' | 'sub' | null
}

// Client-side labels for gate reasons (mirrors GATE_REASON_LABELS in lib/automation/gates.ts;
// that module is server-only, so the strings are duplicated here for the badge display).
const GATE_LABELS: Record<string, string> = {
  blocklisted: 'blocklisted',
  dead: 'no seeders',
  sample: 'sample',
  oversize: 'oversize',
}

type UIState = 'idle' | 'searching' | 'grabbed' | 'queuing' | 'queued' | 'choosing' | 'error'

// Live releases first, then by score. Everything is shown (dead included) and every row is grab-able.
function sortCandidates(list: Candidate[]): Candidate[] {
  return [...list].sort(
    (a, b) => (b.seeders > 0 ? 1 : 0) - (a.seeders > 0 ? 1 : 0) || b.score - a.score,
  )
}

// Indexers return the same release from multiple trackers, so collapse by infoHash and keep the
// highest-seeded copy. Releases with no infoHash can't be matched and are left untouched.
function dedupeByInfoHash(list: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>()
  const noHash: Candidate[] = []
  for (const c of list) {
    if (!c.infoHash) { noHash.push(c); continue }
    const existing = best.get(c.infoHash)
    if (!existing || c.seeders > existing.seeders) best.set(c.infoHash, c)
  }
  return [...best.values(), ...noHash]
}

export function SeasonGrabControl({ tmdbId, title, year, seasonNumber, seasonName, episodeCount, arc }: Props) {
  const [open, setOpen] = useState(false)
  const [language, setLanguage] = useState('en')
  const [audioMode, setAudioMode] = useState('any')
  const [profiles, setProfiles] = useState<QualityProfile[]>([])
  const [profileId, setProfileId] = useState<number>(1)
  const [ui, setUi] = useState<UIState>('idle')
  const [msg, setMsg] = useState('')
  const foundEpisodeCount = episodeCount ?? arc?.episodes.length ?? 0
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [grabbingKey, setGrabbingKey] = useState<string | null>(null)
  // Manual override search inside the chooser: a second, user-typed query against the same indexer path.
  const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('auto')
  const [manualQuery, setManualQuery] = useState('')
  const [manualCandidates, setManualCandidates] = useState<Candidate[]>([])
  const [manualSearching, setManualSearching] = useState(false)
  const [manualSearched, setManualSearched] = useState(false)
  const [manualError, setManualError] = useState('')

  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, open, () => setOpen(false))

  const { openGrabConfirm, grabConfirmModal } = useGrabConfirm()

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
    setCandidates([])
    setManualCandidates([])
    setManualSearched(false)
    setManualError('')
    setActiveTab('auto')
    setManualQuery(title)   // seed the manual box with the show title; editable and clearable
  }

  // Scope payload shared by every grab call: arc takes precedence over seasonNumber.
  function scopeBody(): Record<string, unknown> {
    return arc ? { arc } : { seasonNumber }
  }

  // Interactive search query: arc → absolute range "Title 422-456"; season → "Title S13".
  function searchQuery(): string {
    if (arc) {
      const nums = arc.episodes.map((e) => e.e).filter((n) => n > 0).sort((a, b) => a - b)
      if (nums.length === 0) return title
      const start = nums[0], end = nums[nums.length - 1]
      return start === end ? `${title} ${start}` : `${title} ${start}-${end}`
    }
    return `${title} S${String(seasonNumber ?? 1).padStart(2, '0')}`
  }

  async function postGrab(extra: Record<string, unknown>) {
    const res = await fetch('/api/grab/season', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tmdbId, title, year, language, audioMode, qualityProfileId: profileId, ...scopeBody(), ...extra }),
    })
    const data = await res.json().catch(() => ({})) as {
      result?: string; error?: string; episodeCount?: number
      queued?: number; failed?: number; total?: number
      packsGrabbed?: number; coveredByPacks?: number
      release?: { title: string; indexer: string }
      itemId?: number
    }
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
    return data
  }

  async function grabAuto() {
    setUi('searching'); setMsg('')
    try {
      const data = await postGrab({ mode: 'auto' })
      // 'auto' no longer grabs directly — it creates the 'wanted' item and hands off to the
      // confirmation modal, which does the actual pack search.
      if (data.result === 'pending_confirm' && data.itemId != null) {
        setOpen(false)
        openGrabConfirm({ itemId: data.itemId, tmdbId, type: 'tv', title, year })
      } else {
        throw new Error(data.error ?? 'Unexpected response')
      }
    } catch (err) {
      setUi('error'); setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  async function grabEpisodes() {
    setUi('queuing')
    try {
      const data = await postGrab({ mode: 'episodes' })
      const queued = data.queued ?? data.total ?? foundEpisodeCount
      const failed = data.failed ?? 0
      const packs = data.packsGrabbed ?? 0
      const coveredByPacks = data.coveredByPacks ?? 0
      setUi('queued')
      // Prefer-pack fan-out: report what's downloading now (packs) vs queued for search (gaps).
      const packLine = packs > 0
        ? `Grabbed ${packs} pack${packs === 1 ? '' : 's'} covering ${coveredByPacks} episode${coveredByPacks === 1 ? '' : 's'} (downloading now). `
        : ''
      setMsg(
        packLine +
        `Scheduled ${queued} gap episode search${queued === 1 ? '' : 'es'}` +
        (failed > 0 ? ` (${failed} could not be queued)` : '') +
        ` — these are queued for the grab cron (runs every 5 min) and are NOT downloading yet. ` +
        `Track progress in Admin → Automation.`,
      )
    } catch (err) {
      setUi('error'); setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  // Interactive: pull the full candidate set (no hard rejects) for the admin to choose from.
  async function openChooser() {
    setUi('choosing'); setMsg(''); setCandidates([]); setActiveTab('auto')
    try {
      const res = await fetch(`/api/torrent-search?q=${encodeURIComponent(searchQuery())}&type=tv`)
      const data = await res.json().catch(() => ({})) as { results?: Candidate[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setCandidates(sortCandidates(data.results ?? []))
    } catch (err) {
      setUi('error'); setMsg(err instanceof Error ? err.message : String(err))
    }
  }

  // Manual override search: hits the SAME indexer path as the auto chooser with the admin's typed
  // query, so any found release grabs through the identical enqueue path. Results are scored and
  // 0-seed-flagged exactly like the auto list. Errors render inline and never tear down the chooser.
  async function runManualSearch() {
    const q = manualQuery.trim()
    if (!q || manualSearching) return
    setManualSearching(true); setManualSearched(true); setManualError('')
    try {
      const res = await fetch(`/api/torrent-search?q=${encodeURIComponent(q)}&type=tv`)
      const data = await res.json().catch(() => ({})) as { results?: Candidate[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setManualCandidates(sortCandidates(dedupeByInfoHash(data.results ?? [])))
    } catch (err) {
      setManualCandidates([])
      setManualError(err instanceof Error ? err.message : String(err))
    } finally {
      setManualSearching(false)
    }
  }

  async function grabChosen(c: Candidate) {
    setGrabbingKey(c.infoHash || c.title)
    try {
      const data = await postGrab({
        override: { magnetUrl: c.magnetUrl, downloadUrl: c.downloadUrl, title: c.title, indexerName: c.indexerName, infoHash: c.infoHash },
      })
      setUi('grabbed')
      setMsg(data.release ? `${data.release.title} · ${data.release.indexer}` : 'Sent to your download client.')
    } catch (err) {
      setUi('error'); setMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setGrabbingKey(null)
    }
  }

  // Shared candidate table for both the auto list and manual results, so a manually found release
  // renders identically and grabs through the same path. markAuto tags any row whose infoHash is
  // already in the auto list (orientation only; the row stays fully grab-able).
  function renderCandidateTable(list: Candidate[], markAuto: boolean) {
    const autoHashes = markAuto ? new Set(candidates.map((c) => c.infoHash).filter(Boolean)) : null
    return (
      <div className="max-h-72 overflow-y-auto rounded border border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-900">
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-1.5 px-2 font-medium">Release</th>
              <th className="py-1.5 px-2 font-medium text-right">Seeds</th>
              <th className="py-1.5 px-2 font-medium text-right">Size</th>
              <th className="py-1.5 px-2 font-medium text-right">Score</th>
              <th className="py-1.5 px-2 font-medium text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c, i) => {
              const key = c.infoHash || c.title + i
              const grabbing = grabbingKey === (c.infoHash || c.title)
              const inAuto = !!(autoHashes && c.infoHash && autoHashes.has(c.infoHash))
              return (
                <tr key={key} className="border-b border-zinc-800/60 hover:bg-zinc-800/40">
                  <td className="py-1.5 px-2 text-zinc-300 max-w-sm">
                    <span className="line-clamp-2">{c.title}</span>
                    {inAuto && (
                      <span className="ml-1 align-middle rounded bg-zinc-800 px-1 py-0.5 text-[10px] text-zinc-500" title="Also in the auto candidate list">
                        in Auto
                      </span>
                    )}
                    {c.gates?.map((g) => (
                      <span
                        key={g}
                        className="ml-1 align-middle rounded bg-amber-900/50 px-1 py-0.5 text-[10px] text-amber-300"
                        title="Auto-pick would skip this release for this reason; you can still grab it manually."
                      >
                        {GATE_LABELS[g] ?? g}
                      </span>
                    ))}
                    {c.audioMode && (
                      <span
                        className={`ml-1 align-middle rounded px-1 py-0.5 text-[10px] ${c.audioMode === 'dub' ? 'bg-sky-900/60 text-sky-300' : 'bg-amber-900/50 text-amber-300'}`}
                      >
                        {c.audioMode === 'dub' ? 'Dub' : 'Sub'}
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    {c.seeders > 0 ? <span className="text-zinc-400">{c.seeders}</span> : <span className="text-red-400" title="0 seeds — dead">0 ⚠</span>}
                  </td>
                  <td className="py-1.5 px-2 text-right text-zinc-500">{formatBytes(c.size)}</td>
                  <td className="py-1.5 px-2 text-right text-zinc-400">{Math.round(c.score)}</td>
                  <td className="py-1.5 px-2 text-right">
                    <button
                      onClick={() => grabChosen(c)}
                      disabled={grabbing}
                      className="rounded bg-sky-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                    >
                      {grabbing ? '…' : 'Grab'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const busy = ui === 'searching' || ui === 'queuing'
  const kind = arc ? 'arc' : 'season'

  return (
    <>
      {grabConfirmModal}
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
              className={`w-full ${ui === 'choosing' ? 'max-w-2xl' : 'max-w-sm'} rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl`}
            >
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <h2 id="season-grab-title" className="text-base font-semibold text-zinc-100">Grab {kind}</h2>
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
                  Audio
                  <select
                    value={audioMode}
                    onChange={(e) => setAudioMode(e.target.value)}
                    disabled={busy}
                    className="rounded-md bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-600"
                  >
                    {AUDIO_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Sent to your download client — downloading now. {msg}
                  </p>
                )}
                {ui === 'queued' && (
                  <p className="rounded-md bg-sky-900/40 px-3 py-2 text-xs text-sky-300">{msg}</p>
                )}
                {ui === 'error' && (
                  <p className="rounded-md bg-red-900/40 px-3 py-2 text-xs text-red-300">{msg || 'Something went wrong.'}</p>
                )}

                {/* Interactive candidate list — full set, zero hard rejects, every row grab-able.
                    Two tabs: the scored auto candidates, and a manual override search. */}
                {ui === 'choosing' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-1 rounded-md bg-zinc-800 p-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setActiveTab('auto')}
                        className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${activeTab === 'auto' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                      >
                        Auto candidates{candidates.length > 0 ? ` (${candidates.length})` : ''}
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('manual')}
                        className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${activeTab === 'manual' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}
                      >
                        Manual search{manualSearched ? ` (${manualCandidates.length})` : ''}
                      </button>
                    </div>

                    {activeTab === 'auto' && (
                      candidates.length === 0
                        ? <p className="rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-400">Searching indexers…</p>
                        : renderCandidateTable(candidates, false)
                    )}

                    {activeTab === 'manual' && (
                      <div className="flex flex-col gap-2">
                        <form onSubmit={(e) => { e.preventDefault(); runManualSearch() }} className="flex gap-2">
                          <input
                            type="text"
                            value={manualQuery}
                            onChange={(e) => setManualQuery(e.target.value)}
                            placeholder="Search indexers (release group, uploader, batch name…)"
                            className="flex-1 rounded-md bg-zinc-800 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-sky-600"
                          />
                          <button
                            type="submit"
                            disabled={manualSearching || !manualQuery.trim()}
                            className="inline-flex items-center gap-1 rounded-md bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                          >
                            {manualSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                            Search
                          </button>
                        </form>
                        {manualError && <p className="rounded-md bg-red-900/40 px-3 py-2 text-xs text-red-300">{manualError}</p>}
                        {manualSearching ? (
                          <p className="rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-400">Searching indexers…</p>
                        ) : manualSearched ? (
                          manualCandidates.length > 0
                            ? renderCandidateTable(manualCandidates, true)
                            : <p className="rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-400">No releases found for “{manualQuery}”.</p>
                        ) : (
                          <p className="rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-400">Type a query and search to find releases the auto list missed.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {(ui === 'idle' || ui === 'searching' || ui === 'queuing') && (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={grabAuto}
                      disabled={busy}
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-60"
                    >
                      {ui === 'searching' && <Loader2 className="h-4 w-4 animate-spin" />}
                      {ui === 'searching' ? 'Preparing…' : `Grab ${kind} pack`}
                    </button>
                    <button
                      onClick={openChooser}
                      disabled={busy}
                      className="w-full rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600 disabled:opacity-60"
                    >
                      Choose release (interactive)
                    </button>
                    <button
                      onClick={grabEpisodes}
                      disabled={busy}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-60"
                    >
                      {ui === 'queuing' && <Loader2 className="h-4 w-4 animate-spin" />}
                      {ui === 'queuing' ? 'Queuing episodes…' : 'Grab episode by episode'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  )
}
