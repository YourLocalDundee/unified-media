'use client'

import { MovieDetailPanel } from './MovieDetailPanel'
import { TvDetailPanel } from './TvDetailPanel'

interface MediaDetailPanelProps {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  requestStatus?: number
  title?: string
}

export function MediaDetailPanel({ tmdbId, mediaType, requestStatus, title: _title }: MediaDetailPanelProps) {
  if (!tmdbId) {
    return (
      <div className="border-t border-zinc-800 bg-zinc-900/50 p-4">
        <p className="text-sm text-zinc-500">No TMDB ID available for this request.</p>
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-800 bg-zinc-900/50 p-4">
      {mediaType === 'movie' ? (
        <MovieDetailPanel tmdbId={tmdbId} requestStatus={requestStatus} />
      ) : (
        <TvDetailPanel tmdbId={tmdbId} requestStatus={requestStatus} />
      )}
    </div>
  )
}
