'use client'

import { useState } from 'react'
import EpisodeCarousel from '@/components/media/EpisodeCarousel'

interface NativeSeason {
  id: string
  title: string
  season_number: number | null
}

interface SeriesSectionProps {
  seriesId: string
  initialSeasons: NativeSeason[]
}

export default function SeriesSection({ seriesId, initialSeasons }: SeriesSectionProps) {
  const [selectedSeasonId, setSelectedSeasonId] = useState<string>(
    initialSeasons[0]?.id ?? ''
  )

  if (!initialSeasons.length) return null

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {initialSeasons.map((season) => (
          <button
            key={season.id}
            onClick={() => setSelectedSeasonId(season.id)}
            className={[
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              selectedSeasonId === season.id
                ? 'bg-white text-black'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
            ].join(' ')}
          >
            {season.season_number === 0 ? 'Specials' : season.title}
          </button>
        ))}
      </div>
      {selectedSeasonId && (
        <EpisodeCarousel
          seriesId={seriesId}
          seasonId={selectedSeasonId}
        />
      )}
    </div>
  )
}
