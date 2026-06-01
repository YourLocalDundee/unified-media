'use client'

interface JellyfinSeasonShape {
  Id: string
  Name: string
  IndexNumber?: number
}

interface SeasonSelectorProps {
  seasons: JellyfinSeasonShape[]
  selectedSeasonId: string
  onSelect: (seasonId: string) => void
}

export default function SeasonSelector({ seasons, selectedSeasonId, onSelect }: SeasonSelectorProps) {
  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: 'none' }}
    >
      {seasons.map((season) => {
        const label = (season.IndexNumber ?? 0) === 0 ? 'Specials' : season.Name
        const isSelected = season.Id === selectedSeasonId
        return (
          <button
            key={season.Id}
            onClick={() => onSelect(season.Id)}
            className={`flex-shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              isSelected
                ? 'bg-blue-600 text-white'
                : 'border border-zinc-700 bg-transparent text-zinc-300 hover:border-zinc-500 hover:text-white'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
