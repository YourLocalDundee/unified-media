'use client'

import { RequestOptions } from '@/components/media/RequestOptions'
import type { RequestStatus, RequestType } from '@/lib/requests/types'

interface Props {
  tmdbId: number
  mediaType: 'movie' | 'tv'
  title: string
  year: number | null
  posterPath: string | null
  overview: string | null
  libraryId: string | null
  existingStatus?: RequestStatus
  existingRequestType?: RequestType
}

// Server-side library membership is checked by the parent page and passed as libraryId.
// If the item is already local we skip RequestOptions entirely and go straight to /browse/[id].
export default function RequestButton({
  tmdbId, mediaType, title, year, posterPath, overview,
  libraryId, existingStatus, existingRequestType,
}: Props) {
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

  return (
    <RequestOptions
      tmdbId={tmdbId}
      mediaType={mediaType}
      title={title}
      year={year}
      posterPath={posterPath}
      overview={overview}
      existingStatus={existingStatus}
      existingRequestType={existingRequestType}
    />
  )
}
