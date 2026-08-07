'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useDisplayPrefs } from '@/hooks/useSettings'

// posterSize → responsive grid column classes
const GRID_CLASSES: Record<string, string> = {
  small: 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-3',
  medium: 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4',
  large: 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6',
}

interface LibraryItem {
  id: string
  title: string
  year?: number
  imageUrl?: string
  type: 'Movie' | 'Series'
}

interface LibraryViewLayoutProps {
  items: LibraryItem[]
  view: 'grid' | 'list'
}

export function LibraryViewLayout({ items, view }: LibraryViewLayoutProps) {
  const { prefs } = useDisplayPrefs()
  const gridClass = GRID_CLASSES[prefs.posterSize] ?? GRID_CLASSES.medium
  const resolvedView = view === 'list' ? 'list' : 'grid'

  if (resolvedView === 'list') {
    return (
      <div className="divide-y divide-zinc-800 rounded-lg border border-zinc-800 overflow-hidden">
        {items.map((item) => (
          <Link
            key={item.id}
            href={`/library/${item.id}`}
            className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/50 transition-colors"
          >
            {item.imageUrl ? (
              <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded">
                <Image
                  src={item.imageUrl}
                  alt=""
                  fill
                  className="object-cover"
                  sizes="40px"
                />
              </div>
            ) : (
              <div className="h-14 w-10 flex-shrink-0 rounded bg-zinc-700" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{item.title}</p>
              <p className="text-xs text-zinc-400">
                {item.type}{item.year ? ` · ${item.year}` : ''}
              </p>
            </div>
          </Link>
        ))}
      </div>
    )
  }

  return (
    <div className={gridClass}>
      {items.map((item) => (
        <Link
          key={item.id}
          href={`/library/${item.id}`}
          className="group flex flex-col gap-2"
        >
          <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-zinc-800">
            {item.imageUrl ? (
              <Image
                src={item.imageUrl}
                alt={item.title}
                fill
                className="object-cover transition-transform duration-200 group-hover:scale-105"
                sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, 20vw"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-zinc-600">
                <svg className="h-8 w-8" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M4 4h16v12H4zM2 18h20v2H2z" />
                </svg>
              </div>
            )}
            {prefs.showTypeBadge && (
              <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                {item.type}
              </span>
            )}
          </div>
          <div>
            <p className="truncate text-sm font-medium text-white leading-tight">{item.title}</p>
            {prefs.showYear && item.year && (
              <p className="text-xs text-zinc-400">{item.year}</p>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}
