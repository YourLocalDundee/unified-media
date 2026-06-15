'use client'

import { useState } from 'react'
import type { RequestStatus, RequestType } from '@/lib/requests/types'
import { TorrentPickModal } from './TorrentPickModal'
import { SeriesScopeModal } from './SeriesScopeModal'
import type { SeriesScope } from './SeriesScopeModal'

interface Props {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  title: string
  year: number | null
  posterPath: string | null
  overview: string | null
  existingStatus?: RequestStatus
  existingRequestType?: RequestType
  compact?: boolean
}

type UIState = 'idle' | 'loading' | 'picking' | 'scoping' | 'error'

export const LANGUAGE_OPTIONS = [
  { value: 'any', label: 'Any language' },
  { value: 'en',  label: 'English' },
  { value: 'fr',  label: 'French' },
  { value: 'de',  label: 'German' },
  { value: 'es',  label: 'Spanish' },
  { value: 'it',  label: 'Italian' },
  { value: 'pt',  label: 'Portuguese' },
  { value: 'nl',  label: 'Dutch' },
  { value: 'ja',  label: 'Japanese' },
  { value: 'zh',  label: 'Chinese' },
  { value: 'ko',  label: 'Korean' },
  { value: 'ru',  label: 'Russian' },
]

const BADGE_NORMAL: Record<RequestStatus, { label: string; className: string }> = {
  pending:   { label: 'Requested', className: 'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium bg-zinc-700 text-zinc-400 cursor-default select-none' },
  approved:  { label: 'Approved',  className: 'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium bg-blue-900/60 text-blue-300 cursor-default select-none' },
  available: { label: 'Available', className: 'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium bg-green-900/60 text-green-300 cursor-default select-none' },
  declined:  { label: 'Declined',  className: '' },
  expired:   { label: 'Expired',   className: '' },
}

const BADGE_COMPACT: Record<RequestStatus, { label: string; className: string }> = {
  pending:   { label: 'Requested', className: 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-zinc-700 text-zinc-400 cursor-default select-none' },
  approved:  { label: 'Approved',  className: 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-blue-900/60 text-blue-300 cursor-default select-none' },
  available: { label: 'Available', className: 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-green-900/60 text-green-300 cursor-default select-none' },
  declined:  { label: 'Declined',  className: '' },
  expired:   { label: 'Expired',   className: '' },
}

function Spinner() {
  return (
    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

export function RequestOptions({
  tmdbId, mediaType, title, year, posterPath, overview,
  existingStatus, existingRequestType, compact = false,
}: Props) {
  const currentYear = new Date().getFullYear()
  const isOldContent = year !== null && year < currentYear

  const [uiState, setUiState] = useState<UIState>('idle')
  const [currentStatus, setCurrentStatus] = useState<RequestStatus | undefined>(existingStatus)
  const [currentType, setCurrentType] = useState<RequestType | undefined>(existingRequestType)
  const [errorMsg, setErrorMsg] = useState('')
  // DIMENSION 1 — Retention: default to 48hr for old content, longterm for new
  const [retention, setRetention] = useState<'quick' | 'longterm'>(isOldContent ? 'quick' : 'longterm')
  const [language, setLanguage] = useState('any')

  const BADGE = compact ? BADGE_COMPACT : BADGE_NORMAL
  const sz = compact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'
  const rnd = compact ? 'rounded' : 'rounded-lg'

  async function submitAutoGrab(scope?: SeriesScope) {
    setUiState('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId, mediaType, title, year, posterPath, overview,
          requestType: retention,
          requestMethod: 'auto-pick',
          language,
          // scope fields — only meaningful for tv; movies default to 'movie' server-side
          scopeType: scope?.scopeType,
          scopeSeasons: scope?.scopeSeasons,
          scopeEpisodes: scope?.scopeEpisodes,
          monitorFuture: scope?.monitorFuture,
        }),
      })

      if (res.status === 409) { setCurrentStatus('pending'); setCurrentType(retention); setUiState('idle'); return }

      if (res.status === 429) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setErrorMsg(data.error ?? '48hr limit reached. Try Long-term.')
        setUiState('error')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      const data = await res.json() as { status?: string }
      setCurrentStatus((data.status as RequestStatus) ?? 'pending')
      setCurrentType(retention)
      setUiState('idle')
    } catch (err) {
      setUiState('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  function handleAutoGrab() {
    if (mediaType === 'tv') {
      setUiState('scoping')
    } else {
      void submitAutoGrab()
    }
  }

  function handlePickedTorrent(status: 'approved' | 'pending', type: 'quick' | 'longterm') {
    setCurrentStatus(status)
    setCurrentType(type)
    setUiState('idle')
  }

  if (currentStatus && currentStatus !== 'declined' && currentStatus !== 'expired') {
    const badge = BADGE[currentStatus]
    return (
      <div className="flex flex-col gap-0.5">
        <span className={badge.className}>{badge.label}</span>
        {currentType && (
          <span className={`text-[10px] ${currentType === 'quick' ? 'text-amber-400' : 'text-blue-400'}`}>
            {currentType === 'quick' ? '48hr (auto-delete)' : 'Long-term'}
          </span>
        )}
      </div>
    )
  }

  if (uiState === 'error') {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[10px] text-red-400">{errorMsg}</span>
        <button onClick={() => setUiState('idle')} className={`inline-flex items-center ${rnd} ${sz} font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700`}>
          Try again
        </button>
      </div>
    )
  }

  const loading = uiState === 'loading'

  return (
    <>
      {uiState === 'scoping' && (
        <SeriesScopeModal
          tmdbId={tmdbId}
          title={title}
          onConfirm={(scope) => {
            setUiState('idle')
            void submitAutoGrab(scope)
          }}
          onClose={() => setUiState('idle')}
        />
      )}
      {uiState === 'picking' && (
        <TorrentPickModal
          title={title}
          year={year}
          tmdbId={tmdbId}
          mediaType={mediaType}
          posterPath={posterPath}
          overview={overview}
          isOldContent={isOldContent}
          defaultRetention={retention}
          defaultLanguage={language}
          onClose={() => setUiState('idle')}
          onPicked={handlePickedTorrent}
        />
      )}

      <div className="flex flex-col gap-2">
        {/* DIMENSION 1 — Retention toggle */}
        <div className="flex flex-col gap-1">
          {!compact && <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Retention</span>}
          <div className="flex gap-1">
            {isOldContent && (
              <button
                onClick={() => setRetention('quick')}
                disabled={loading}
                className={`${rnd} ${sz} font-medium transition-colors ${
                  retention === 'quick'
                    ? 'bg-amber-800/60 text-amber-300 ring-1 ring-amber-600'
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                }`}
                title="Auto-deleted 48h after it appears in your library."
              >
                48hr
              </button>
            )}
            <button
              onClick={() => setRetention('longterm')}
              disabled={loading}
              className={`${rnd} ${sz} font-medium transition-colors ${
                retention === 'longterm'
                  ? 'bg-blue-900/60 text-blue-300 ring-1 ring-blue-700'
                  : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
              }`}
              title="Stays until manually removed."
            >
              {isOldContent ? 'Long-term' : '+ Request'}
            </button>
          </div>
        </div>

        {/* DIMENSION 2 — Method buttons */}
        <div className="flex flex-col gap-1">
          {!compact && <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Method</span>}
          <div className="flex gap-1.5">
            <button
              onClick={() => handleAutoGrab()}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 ${rnd} ${sz} font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition-colors disabled:opacity-50`}
              title={mediaType === 'tv' ? 'Choose scope (full series, seasons, or episodes), then auto-grab.' : 'Auto-grab immediately, no approval needed.'}
            >
              {loading && <Spinner />}
              {loading ? 'Requesting…' : 'Auto-grab'}
            </button>
            <button
              onClick={() => setUiState('picking')}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 ${rnd} ${sz} font-medium bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50`}
              title="Search indexers and hand-pick a specific release. Always goes to admin queue."
            >
              <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="M21 21l-4.35-4.35" />
              </svg>
              Pick release
            </button>
          </div>
        </div>

        {/* Language — non-compact only */}
        {!compact && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500">Language:</span>
            <select
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="rounded px-1.5 py-0.5 text-[10px] bg-zinc-900 border border-zinc-700 text-zinc-300 focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {!compact && (
          <span className="text-[10px] text-zinc-600">
            {retention === 'quick'
              ? '48hr + auto-grab = immediate · Pick release always queues'
              : 'Long-term always needs admin approval'}
          </span>
        )}
      </div>
    </>
  )
}
