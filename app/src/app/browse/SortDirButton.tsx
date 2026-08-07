'use client'

export default function SortDirButton({ sortDir }: { sortDir: 'asc' | 'desc' }) {
  return (
    <button
      type="button"
      title={sortDir === 'desc' ? 'Descending — click for ascending' : 'Ascending — click for descending'}
      className="flex items-center justify-center rounded-lg bg-zinc-800 px-2 py-2 text-white hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-white/20"
      onClick={(e) => {
        const form = (e.currentTarget as HTMLElement).closest('form') as HTMLFormElement
        const input = form.querySelector('#dir-input') as HTMLInputElement
        input.value = input.value === 'desc' ? 'asc' : 'desc'
        form.requestSubmit()
      }}
    >
      {sortDir === 'desc'
        ? <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 12L3 6h10z"/></svg>
        : <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 4l5 6H3z"/></svg>
      }
    </button>
  )
}
