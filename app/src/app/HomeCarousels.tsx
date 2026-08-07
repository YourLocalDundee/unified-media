'use client'

import MediaCard from '@/components/media/MediaCard'
import { useDisplayPrefs } from '@/hooks/useSettings'

// ---------------------------------------------------------------------------
// Types shared between server (page.tsx) and this client render layer
// ---------------------------------------------------------------------------

export interface ContinueItem {
  id: string
  title: string
  subtitle?: string
  type: 'Episode' | 'Movie'
  imageUrl?: string
  progress: number
}

export interface RecentItem {
  id: string
  title: string
  year?: number
  imageUrl?: string
  type: 'Movie' | 'Series'
  href: string
}

// ---------------------------------------------------------------------------
// Continue Watching carousel — data-driven, display-pref-aware
// ---------------------------------------------------------------------------

export function ContinueWatchingCarousel({
  items,
  fallback,
}: {
  items: ContinueItem[]
  fallback?: React.ReactNode
}) {
  const { prefs } = useDisplayPrefs()

  if (!prefs.showContinueWatching) return null

  const limit = prefs.carouselLimit || items.length
  const visible = items.slice(0, limit)

  if (!visible.length) return <>{fallback}</>

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border">
      {visible.map((item) => (
        <div key={item.id} className="flex-shrink-0">
          <div className="relative">
            <MediaCard
              id={item.id}
              title={item.title}
              imageUrl={item.imageUrl}
              type={item.type}
              href={`/play/${item.id}`}
            />
            {item.progress > 0 && (
              <div className="absolute bottom-9 left-0 right-0 h-1 bg-zinc-700 rounded-b">
                <div
                  className="h-full bg-primary rounded-b"
                  style={{ width: `${Math.min(100, Math.round(item.progress * 100))}%` }}
                />
              </div>
            )}
          </div>
          {item.subtitle && (
            <p className="text-xs text-zinc-500 mt-1 truncate max-w-[120px] sm:max-w-[160px]">
              {item.subtitle}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Recently Added carousel — data-driven, display-pref-aware
// ---------------------------------------------------------------------------

export function RecentlyAddedCarousel({
  items,
}: {
  items: RecentItem[]
}) {
  const { prefs } = useDisplayPrefs()

  if (!prefs.showRecentlyAdded) return null

  const limit = prefs.carouselLimit || items.length
  const visible = items.slice(0, limit)

  if (!visible.length) return null

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border">
      {visible.map((item) => (
        <div key={item.id} className="flex-shrink-0">
          <MediaCard
            id={item.id}
            title={item.title}
            year={item.year}
            imageUrl={item.imageUrl}
            type={item.type}
            href={item.href}
          />
        </div>
      ))}
    </div>
  )
}
