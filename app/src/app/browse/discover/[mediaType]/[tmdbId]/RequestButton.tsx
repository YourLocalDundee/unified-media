'use client'

import { useState } from 'react'

interface Props {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  title: string
  year: number | null
  posterPath: string | null
  overview: string | null
  libraryId: string | null
  alreadyRequested: boolean
}

export default function RequestButton({
  tmdbId,
  mediaType,
  title,
  year,
  posterPath,
  overview,
  libraryId,
  alreadyRequested: initialRequested,
}: Props) {
  const [requested, setRequested] = useState(initialRequested)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoApproved, setAutoApproved] = useState(false)

  if (libraryId) {
    return (
      <a
        href={`/browse/${libraryId}`}
        className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-6 py-3 text-sm font-semibold text-white hover:bg-green-500 transition"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        In Library — Watch Now
      </a>
    )
  }

  if (requested) {
    return (
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-2 rounded-xl bg-green-700/40 px-6 py-3 text-sm font-semibold text-green-300 cursor-default">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {autoApproved ? 'Requested (Auto-Approved)' : 'Requested'}
        </span>
        {autoApproved && (
          <p className="text-xs text-zinc-500 pl-1">Your request was automatically approved.</p>
        )}
      </div>
    )
  }

  async function handleRequest() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tmdbId, mediaType, title, year, posterPath, overview }),
      })
      if (res.ok || res.status === 409) {
        const data = await res.json() as { status?: string }
        setRequested(true)
        if (data.status === 'approved') setAutoApproved(true)
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string }
        setError(data.error ?? 'Request failed')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => void handleRequest()}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition"
      >
        {loading ? (
          <>
            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Requesting…
          </>
        ) : (
          <>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Request {mediaType === 'movie' ? 'Movie' : 'Show'}
          </>
        )}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
