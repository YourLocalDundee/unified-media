'use client'

import { useState } from 'react'
import type { RequestStatus } from '@/lib/requests/types'

interface Props {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  title: string
  year: number | null
  posterPath: string | null
  overview: string | null
  existingStatus?: RequestStatus
  compact?: boolean
}

const STATUS_BADGE_NORMAL: Record<RequestStatus, { label: string; className: string }> = {
  pending: {
    label: 'Requested',
    className: 'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium bg-zinc-700 text-zinc-400 cursor-default select-none',
  },
  approved: {
    label: 'Approved',
    className: 'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium bg-blue-900/60 text-blue-300 cursor-default select-none',
  },
  available: {
    label: 'Available',
    className: 'inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium bg-green-900/60 text-green-300 cursor-default select-none',
  },
  declined: {
    label: 'Declined',
    className: '', // handled as button below
  },
  expired: {
    label: 'Expired',
    className: '', // handled as button below (falls through to request button)
  },
}

const STATUS_BADGE_COMPACT: Record<RequestStatus, { label: string; className: string }> = {
  pending: {
    label: 'Requested',
    className: 'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-zinc-700 text-zinc-400 cursor-default select-none',
  },
  approved: {
    label: 'Approved',
    className: 'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-blue-900/60 text-blue-300 cursor-default select-none',
  },
  available: {
    label: 'Available',
    className: 'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium bg-green-900/60 text-green-300 cursor-default select-none',
  },
  declined: {
    label: 'Declined',
    className: '', // handled as button below
  },
  expired: {
    label: 'Expired',
    className: '', // handled as button below (falls through to request button)
  },
}

type UIState = 'idle' | 'loading' | 'success' | 'error'

export function RequestButton({
  tmdbId,
  mediaType,
  title,
  year,
  posterPath,
  overview,
  existingStatus,
  compact = false,
}: Props) {
  const [uiState, setUiState] = useState<UIState>('idle')
  const [currentStatus, setCurrentStatus] = useState<RequestStatus | undefined>(existingStatus)
  const [errorMsg, setErrorMsg] = useState('')

  async function submitRequest() {
    setUiState('loading')
    setErrorMsg('')
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tmdbId,
          mediaType,
          title,
          year,
          posterPath,
          overview,
        }),
      })

      if (res.status === 409) {
        // Already exists — treat as pending
        setCurrentStatus('pending')
        setUiState('idle')
        return
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      setCurrentStatus('pending')
      setUiState('success')
    } catch (err) {
      setUiState('error')
      setErrorMsg(err instanceof Error ? err.message : String(err))
    }
  }

  const STATUS_BADGE = compact ? STATUS_BADGE_COMPACT : STATUS_BADGE_NORMAL
  const sizeNormal = 'px-3 py-2 text-sm'
  const sizeCompact = 'px-2 py-1 text-xs'
  const sz = compact ? sizeCompact : sizeNormal

  // Static status badges (disabled states)
  if (currentStatus && currentStatus !== 'declined' && currentStatus !== 'expired') {
    if (uiState === 'success' && currentStatus === 'pending') {
      // Brief "Requested!" flash before settling into badge
      setTimeout(() => setUiState('idle'), 1500)
      return (
        <span className={`inline-flex items-center rounded-lg ${sz} font-medium bg-green-900/60 text-green-300`}>
          Requested!
        </span>
      )
    }
    const badge = STATUS_BADGE[currentStatus]
    return <span className={badge.className}>{badge.label}</span>
  }

  // Declined — re-request button
  if (currentStatus === 'declined') {
    return (
      <button
        onClick={submitRequest}
        disabled={uiState === 'loading'}
        className={`inline-flex items-center gap-2 rounded-lg ${sz} font-medium bg-red-900/40 text-red-400 hover:bg-red-900/70 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {uiState === 'loading' && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        )}
        {uiState === 'loading' ? 'Requesting...' : 'Declined — Request Again?'}
      </button>
    )
  }

  // Error state
  if (uiState === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-red-400">{errorMsg}</span>
        <button
          onClick={submitRequest}
          className={`inline-flex items-center rounded-lg ${sz} font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition-colors`}
        >
          Retry
        </button>
      </div>
    )
  }

  // No existing request — primary Request button
  return (
    <button
      onClick={submitRequest}
      disabled={uiState === 'loading'}
      className={`inline-flex items-center gap-2 rounded-lg ${sz} font-medium bg-zinc-800 text-white hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      {uiState === 'loading' && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {uiState === 'loading' ? 'Requesting...' : '+ Request'}
    </button>
  )
}
