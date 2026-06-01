'use client'

export type SortField = 'episode' | 'airdate' | 'runtime'
export type SortOrder = 'asc' | 'desc'
export type EpisodeFilter = 'all' | 'watched' | 'unwatched'

export interface EpisodeToolbarProps {
  sortBy: SortField
  sortOrder: SortOrder
  filter: EpisodeFilter
  onChange: (updates: Partial<{ sortBy: SortField; sortOrder: SortOrder; filter: EpisodeFilter }>) => void
}

const selectClass =
  'bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-white'

const labelClass = 'text-xs text-zinc-500 uppercase tracking-wide'

export default function EpisodeToolbar({ sortBy, sortOrder, filter, onChange }: EpisodeToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* Sort by */}
      <label className="flex items-center gap-2">
        <span className={labelClass}>Sort by</span>
        <select
          value={sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as SortField })}
          className={selectClass}
        >
          <option value="episode">Episode</option>
          <option value="airdate">Air date</option>
          <option value="runtime">Runtime</option>
        </select>
      </label>

      {/* Order */}
      <label className="flex items-center gap-2">
        <span className={labelClass}>Order</span>
        <select
          value={sortOrder}
          onChange={(e) => onChange({ sortOrder: e.target.value as SortOrder })}
          className={selectClass}
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </label>

      {/* Filter */}
      <label className="flex items-center gap-2">
        <span className={labelClass}>Filter</span>
        <select
          value={filter}
          onChange={(e) => onChange({ filter: e.target.value as EpisodeFilter })}
          className={selectClass}
        >
          <option value="all">All episodes</option>
          <option value="watched">Watched</option>
          <option value="unwatched">Unwatched</option>
        </select>
      </label>
    </div>
  )
}
