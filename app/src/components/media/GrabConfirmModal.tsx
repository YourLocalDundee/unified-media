'use client'

/**
 * GrabConfirmModal — intercepts every user-initiated auto-grab entry point. Shows the release
 * that would be grabbed (or the next-best one) and lets the user Grab it, walk to the next best,
 * drop to the interactive picker, or Cancel. Reuses the existing scoring/gating/search pipeline
 * entirely via GET /api/grab/candidates + POST /api/grab/confirm — no scoring logic lives here.
 *
 * Two-tier walk: Tier 1 (gate-passing + live, autoPickScore order) is always shown first. Tier 2
 * (gated and/or dead) is revealed only after an explicit opt-in once Tier 1 is exhausted, and
 * grabbing a Tier-2 release requires a second explicit confirm (it's an override).
 *
 * Cancel leaves the underlying monitored_item untouched ('wanted') — the 5-minute cron will pick
 * it up automatically later, same as any other auto-pick attempt that doesn't find anything.
 */

import { useEffect, useState, useCallback } from 'react'
import { ModalPortal } from '@/components/ui/ModalPortal'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useRef } from 'react'
import { TorrentPickModal } from './TorrentPickModal'
import type { ScoredCandidate } from '@/lib/automation/grab-results'
import type { TorznabResult } from '@/lib/indexer/types'
import type { TorrentSearchResult } from '@/app/api/torrent-search/route'

// ---------------------------------------------------------------------------
// Small client-side helpers (display only) — same convention as the tiny detector copies already
// duplicated across TorrentPickModal.tsx / SeasonGrabControl.tsx in this codebase.
// ---------------------------------------------------------------------------

function formatBytes(bytes: number) {
  if (!bytes) return '—'
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(2)} TB`
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e3).toFixed(0)} KB`
}

function formatAge(dateStr: string) {
  if (!dateStr) return '—'
  const ms = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(ms / 86400000)
  if (d < 1) return 'today'
  if (d < 30) return `${d}d`
  if (d < 365) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}

function qualityLabel(title: string): string {
  const t = title.toUpperCase()
  if (t.includes('2160P') || t.includes('4K') || t.includes('UHD')) return '4K'
  if (t.includes('1080P')) return '1080p'
  if (t.includes('720P')) return '720p'
  if (t.includes('480P')) return '480p'
  return ''
}

const QUALITY_COLORS: Record<string, string> = {
  '4K': 'bg-purple-900/50 text-purple-300',
  '1080p': 'bg-blue-900/50 text-blue-300',
  '720p': 'bg-green-900/40 text-green-300',
  '480p': 'bg-zinc-700 text-zinc-400',
}

const GATE_LABELS: Record<string, string> = {
  blocklisted: 'blocklisted',
  dead: 'no seeders',
  sample: 'sample',
  oversize: 'oversize',
}

// ISO-639-1 detector — mirrors parser.ts LANGUAGE_PATTERNS (a subset; display-only "matches your
// language" tick, not a scoring input).
const LANG_ISO_PATTERNS: Array<[RegExp, string]> = [
  [/\b(English|ENG)\b/i, 'en'],
  [/\b(French|VF|VOSTFR|TRUEFRENCH)\b/i, 'fr'],
  [/\b(German|Deutsch)\b/i, 'de'],
  [/\b(Spanish|Español|ESP)\b/i, 'es'],
  [/\b(Italian|Italiano)\b/i, 'it'],
  [/\b(Portuguese|Portugues)\b/i, 'pt'],
  [/\b(Dutch|NL)\b/i, 'nl'],
  [/\b(Japanese|JPN)\b/i, 'ja'],
  [/\b(Chinese|CHI)\b/i, 'zh'],
  [/\b(Korean|KOR)\b/i, 'ko'],
  [/\b(Russian|RUS)\b/i, 'ru'],
]
function detectLangIso(title: string): string | null {
  for (const [re, code] of LANG_ISO_PATTERNS) if (re.test(title)) return code
  return null
}
const DUB_PATTERNS = [/\bDub(bed)?\b/i, /\bDual[ ._-]?Audio\b/i, /\bMulti[ ._-]?Audio\b/i, /\bMULTI\b/]
const SUB_PATTERNS = [/\bSub(bed|s)?\b/i, /\bESub\b/i, /\bVOSTFR\b/i, /\bSoftsubs?\b/i]
function detectAudio(title: string): 'dub' | 'sub' | null {
  if (DUB_PATTERNS.some((re) => re.test(title))) return 'dub'
  if (SUB_PATTERNS.some((re) => re.test(title))) return 'sub'
  return null
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GrabConfirmTarget {
  itemId?: number
  tmdbId: number
  type: 'movie' | 'tv'
  title: string
  year: number | null
  posterPath?: string | null
  overview?: string | null
}

interface CandidatesResponse {
  itemId: number
  language: string
  audioMode: string
  profileId: number
  tier1: ScoredCandidate[]
  tier2: ScoredCandidate[]
  needsSearch: boolean
  selectedHash?: string | null
  skipReason?: string | null
  error?: string
}

interface Props {
  target: GrabConfirmTarget
  onClose: () => void
  onGrabbed?: () => void
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function GrabConfirmModal({ target, onClose, onGrabbed }: Props) {
  const [data, setData] = useState<CandidatesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const [pointer, setPointer] = useState(0)
  const [revealedTier2, setRevealedTier2] = useState(false)
  const [pendingOverride, setPendingOverride] = useState(false)

  const [grabbing, setGrabbing] = useState(false)
  const [grabError, setGrabError] = useState('')
  const [grabbedTitle, setGrabbedTitle] = useState<string | null>(null)
  const [showManualPicker, setShowManualPicker] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, onClose)

  const targetQuery = target.itemId
    ? `itemId=${target.itemId}`
    : `tmdbId=${target.tmdbId}&type=${target.type}`

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true); else setLoading(true)
    setLoadError('')
    try {
      const res = await fetch(`/api/grab/candidates?${targetQuery}${refresh ? '&refresh=true' : ''}`)
      const json = await res.json().catch(() => ({})) as CandidatesResponse
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setData(json)
      setPointer(0)
      setRevealedTier2(false)
      setPendingOverride(false)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [targetQuery])

  useEffect(() => {
    // Deferred a tick so the effect's setState runs outside the synchronous commit path
    // (react-hooks/set-state-in-effect), same pattern used by TorrentPickModal's auto-search.
    const id = setTimeout(() => void load(false), 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const tier1 = data?.tier1 ?? []
  const tier2 = data?.tier2 ?? []
  const activeList = revealedTier2 ? [...tier1, ...tier2] : tier1
  const current: ScoredCandidate | undefined = activeList[pointer]
  const inTier2 = pointer >= tier1.length

  async function commitGrab(candidate: ScoredCandidate, override: boolean) {
    if (!data) return
    setGrabbing(true)
    setGrabError('')
    try {
      const res = await fetch('/api/grab/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: data.itemId,
          release: candidate.result,
          override,
        }),
      })
      const json = await res.json().catch(() => ({})) as { grabbed?: boolean; title?: string; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setGrabbedTitle(json.title ?? candidate.result.title)
      onGrabbed?.()
    } catch (e) {
      setGrabError(e instanceof Error ? e.message : String(e))
    } finally {
      setGrabbing(false)
      setPendingOverride(false)
    }
  }

  function handleGrabClick() {
    if (!current) return
    if (inTier2) { setPendingOverride(true); return }
    void commitGrab(current, false)
  }

  function handleNextBest() {
    setPointer((p) => p + 1)
    setPendingOverride(false)
  }

  // "Search manually" hands off to the SAME interactive picker used everywhere else in the app —
  // not a second picker. onSubmitOverride routes the pick through POST /api/grab/confirm instead
  // of TorrentPickModal's own POST /api/requests (which would 409 here — the request/item already
  // exists by the time this modal is reachable).
  async function handleManualPick(
    picked: TorrentSearchResult,
  ): Promise<void> {
    if (!data) throw new Error('Candidates not loaded yet')
    const res = await fetch('/api/grab/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: data.itemId, release: picked, override: true }),
    })
    const json = await res.json().catch(() => ({})) as { grabbed?: boolean; title?: string; error?: string }
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
    setGrabbedTitle(json.title ?? picked.title)
    onGrabbed?.()
  }

  if (showManualPicker) {
    return (
      <TorrentPickModal
        title={target.title}
        year={target.year}
        tmdbId={target.tmdbId}
        mediaType={target.type}
        posterPath={target.posterPath ?? null}
        overview={target.overview ?? null}
        isOldContent={target.year != null && target.year < new Date().getFullYear()}
        defaultLanguage={data?.language}
        defaultAudioMode={data?.audioMode}
        onClose={onClose}
        onPicked={() => {}}
        onSubmitOverride={handleManualPick}
      />
    )
  }

  const headerState = grabbedTitle
    ? 'Grabbed'
    : !data || loading
      ? 'Loading…'
      : current
        ? `${inTier2 ? 'Gated/dead release' : 'Best match'} (${pointer + 1} of ${activeList.length}${!revealedTier2 && tier2.length > 0 ? ` · ${tier2.length} more hidden` : ''})`
        : 'No more releases'

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="grab-confirm-title"
          className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        >
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h2 id="grab-confirm-title" className="text-base font-semibold text-zinc-100">Confirm grab</h2>
              <p className="mt-0.5 text-xs text-zinc-400 line-clamp-1">{target.title}{target.year ? ` (${target.year})` : ''} — {headerState}</p>
            </div>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">✕</button>
          </div>

          {grabbedTitle && (
            <div className="flex flex-col gap-3">
              <p className="rounded-md bg-green-900/40 px-3 py-2 text-xs text-green-300">
                Sent to your download client — downloading now. {grabbedTitle}
              </p>
              <button onClick={onClose} className="rounded-md bg-zinc-700 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-600">
                Close
              </button>
            </div>
          )}

          {!grabbedTitle && (loading || refreshing) && (
            <p className="rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-400">
              {refreshing ? 'Refreshing…' : 'Loading candidates…'}
            </p>
          )}

          {!grabbedTitle && !loading && !refreshing && loadError && (
            <div className="flex flex-col gap-2">
              <p className="rounded-md bg-red-900/40 px-3 py-2 text-xs text-red-300">{loadError}</p>
              <button onClick={() => void load(false)} className="rounded-md bg-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-600">
                Try again
              </button>
            </div>
          )}

          {!grabbedTitle && !loading && !refreshing && !loadError && data?.needsSearch && (
            <div className="flex flex-col gap-2">
              <p className="rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-400">
                No cached search yet for this item — click Refresh to search indexers now.
              </p>
              <div className="flex gap-2">
                <button onClick={() => void load(true)} className="flex-1 rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600">
                  Refresh
                </button>
                <button onClick={() => setShowManualPicker(true)} className="flex-1 rounded-md bg-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-600">
                  Search manually
                </button>
              </div>
              <button onClick={onClose} className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancel
              </button>
            </div>
          )}

          {!grabbedTitle && !loading && !refreshing && !loadError && data && !data.needsSearch && current && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg bg-zinc-950/60 p-3 ring-1 ring-white/5">
                <div className="flex items-start gap-1.5">
                  {qualityLabel(current.result.title) && (
                    <span className={`shrink-0 mt-0.5 rounded px-1 py-0 text-[10px] font-semibold ${QUALITY_COLORS[qualityLabel(current.result.title)] ?? 'bg-zinc-700 text-zinc-400'}`}>
                      {qualityLabel(current.result.title)}
                    </span>
                  )}
                  <span className="text-xs leading-tight text-zinc-200 line-clamp-3">{current.result.title}</span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className={current.result.seeders > 0 ? 'text-zinc-400' : 'text-red-400'}>
                    {current.result.seeders} seed{current.result.seeders === 1 ? '' : 's'}
                  </span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500">{formatBytes(current.result.size)}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500">{formatAge(current.result.publishDate)}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500">{current.result.indexerName}</span>
                  <span className="text-zinc-600">·</span>
                  <span className="text-zinc-500">score {Math.round(current.score)}</span>

                  {data.language !== 'any' && detectLangIso(current.result.title) === data.language && (
                    <span className="rounded bg-emerald-900/50 px-1 py-0.5 text-emerald-300">✓ your language</span>
                  )}
                  {data.audioMode !== 'any' && detectAudio(current.result.title) === data.audioMode && (
                    <span className="rounded bg-emerald-900/50 px-1 py-0.5 text-emerald-300">✓ your audio</span>
                  )}
                  {current.gates?.map((g) => (
                    <span key={g} className="rounded bg-amber-900/50 px-1 py-0.5 text-amber-300">
                      {GATE_LABELS[g] ?? g}
                    </span>
                  ))}
                  {current.result.seeders <= 0 && (
                    <span className="rounded bg-red-900/50 px-1 py-0.5 text-red-300">0 seeders</span>
                  )}
                </div>
              </div>

              {pendingOverride ? (
                <div className="flex flex-col gap-2 rounded-md bg-amber-900/20 p-3 ring-1 ring-amber-700/40">
                  <p className="text-xs text-amber-200">
                    This release is gated or has no seeders — auto-pick would have skipped it. Grab it anyway?
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={grabbing}
                      onClick={() => void commitGrab(current, true)}
                      className="flex-1 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      {grabbing ? 'Grabbing…' : 'Yes, grab anyway'}
                    </button>
                    <button
                      disabled={grabbing}
                      onClick={() => setPendingOverride(false)}
                      className="flex-1 rounded-md bg-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-600"
                    >
                      Back
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {grabError && <p className="rounded-md bg-red-900/40 px-3 py-2 text-xs text-red-300">{grabError}</p>}
                  <div className="flex gap-2">
                    <button
                      disabled={grabbing}
                      onClick={handleGrabClick}
                      className="flex-1 rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
                    >
                      {grabbing ? 'Grabbing…' : 'Grab this'}
                    </button>
                    <button
                      disabled={grabbing}
                      onClick={handleNextBest}
                      className="flex-1 rounded-md bg-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-600 disabled:opacity-50"
                    >
                      Next best
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => void load(true)} disabled={grabbing} className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                      Refresh
                    </button>
                    <button onClick={() => setShowManualPicker(true)} disabled={grabbing} className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                      Search manually
                    </button>
                    <button onClick={onClose} disabled={grabbing} className="flex-1 rounded-md border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tier 1 exhausted, Tier 2 not yet revealed — explicit opt-in gate. */}
          {!grabbedTitle && !loading && !refreshing && !loadError && data && !data.needsSearch && !current && !revealedTier2 && tier2.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="rounded-md bg-amber-900/30 px-3 py-2 text-xs text-amber-200">
                No more clean, seeded releases. Remaining options failed a gate or have no seeds.
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setRevealedTier2(true); }} className="flex-1 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600">
                  Show gated/dead anyway
                </button>
                <button onClick={() => setShowManualPicker(true)} className="flex-1 rounded-md bg-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-600">
                  Search manually
                </button>
              </div>
              <button onClick={onClose} className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancel
              </button>
            </div>
          )}

          {/* Both tiers exhausted (or tier1 exhausted with an empty tier2) — only manual search left. */}
          {!grabbedTitle && !loading && !refreshing && !loadError && data && !data.needsSearch && !current && (revealedTier2 || tier2.length === 0) && (
            <div className="flex flex-col gap-2">
              <p className="rounded-md bg-zinc-800 px-3 py-2 text-xs text-zinc-400">
                No more releases found for this title. Try a manual search, or Refresh to search indexers again.
              </p>
              <div className="flex gap-2">
                <button onClick={() => void load(true)} className="flex-1 rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white hover:bg-sky-600">
                  Refresh
                </button>
                <button onClick={() => setShowManualPicker(true)} className="flex-1 rounded-md bg-zinc-700 px-3 py-2 text-sm text-white hover:bg-zinc-600">
                  Search manually
                </button>
              </div>
              <button onClick={onClose} className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}

// ---------------------------------------------------------------------------
// useGrabConfirm — thin wrapper so every trigger point manages "is it open, for what" with one
// line instead of hand-rolling the same useState + conditional-render boilerplate five times.
// ---------------------------------------------------------------------------

export function useGrabConfirm(onGrabbed?: () => void) {
  const [target, setTarget] = useState<GrabConfirmTarget | null>(null)

  const openGrabConfirm = useCallback((t: GrabConfirmTarget) => setTarget(t), [])
  const closeGrabConfirm = useCallback(() => setTarget(null), [])

  const grabConfirmModal = target ? (
    <GrabConfirmModal
      target={target}
      onClose={closeGrabConfirm}
      onGrabbed={() => { onGrabbed?.(); }}
    />
  ) : null

  return { openGrabConfirm, closeGrabConfirm, grabConfirmModal }
}
