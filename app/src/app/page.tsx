// Home dashboard page — the landing screen after login.
// Aggregates data from four independent sources (native media server, native requests,
// qBittorrent) into a single-page view. Each section is wrapped in its own Suspense
// boundary so one slow/failing data source doesn't block the rest from rendering.

import { Suspense } from 'react'
import Link from 'next/link'
import { getResumeItems, getWatchState, getRecentlyAdded, getItemById } from '@/lib/media-server/library'
import { getAllRequests } from '@/lib/requests/monitor'
import { getTorrents } from '@/lib/qbittorrent/api'
import { getTorrentStateLabel, getTorrentStateColor } from '@/lib/qbittorrent/types'
import { formatBytes, formatDate } from '@/lib/utils'
import MediaCard from '@/components/media/MediaCard'
import { Badge } from '@/components/ui/Badge'
import { requireAuth } from '@/lib/dal'
import type { MediaItem, WatchState } from '@/lib/media-server/types'
import type { NativeRequestWithUser } from '@/lib/requests/types'
import type { Torrent } from '@/lib/qbittorrent/types'

interface ContinueWatchingItem {
  id: string
  title: string
  subtitle?: string
  type: 'Episode' | 'Movie'
  imageUrl: string | undefined
  progress: number
}

// ---------------------------------------------------------------------------
// Root page — all sections are independently fault-tolerant via Suspense
// ---------------------------------------------------------------------------

export default async function HomePage() {
  await requireAuth()
  return (
    <div className="space-y-10">
      <Suspense fallback={<SectionSkeleton title="Continue Watching" />}>
        <ContinueWatchingSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Recently Added" />}>
        <LatestAddedSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Pending Requests" />}>
        <PendingRequestsSection />
      </Suspense>
      <Suspense fallback={<SectionSkeleton title="Active Downloads" />}>
        <ActiveDownloadsSection />
      </Suspense>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

function SectionHeading({ title, viewAllHref }: { title: string; viewAllHref?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-xl font-semibold">{title}</h2>
      {viewAllHref && (
        <Link href={viewAllHref} className="text-sm text-primary hover:underline">
          View all →
        </Link>
      )}
    </div>
  )
}

function SectionSkeleton({ title }: { title: string }) {
  return (
    <section>
      <SectionHeading title={title} />
      <div className="flex items-center gap-4 overflow-x-hidden pb-2">
        {/* Staggered animation delay gives the skeleton a natural "loading wave" feel */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-48 w-32 flex-shrink-0 animate-pulse rounded-lg bg-muted"
            style={{ animationDelay: `${i * 75}ms` }}
          />
        ))}
      </div>
    </section>
  )
}

function UnavailableMessage({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      {message}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Continue Watching
// ---------------------------------------------------------------------------

async function ContinueWatchingSection() {
  // requireAuth is called again here (not just in HomePage) because server component
  // async functions each need their own auth check — they may render independently.
  const session = await requireAuth()
  const userId = session.userId
  let items: ContinueWatchingItem[] = []

  try {
    const raw: MediaItem[] = getResumeItems(userId, 10)

    const all: ContinueWatchingItem[] = []

    for (const item of raw) {
      const watchState: WatchState | undefined = getWatchState(userId, item.id)
      // progress is 0 if watch state is missing or runtime is unknown (e.g. live)
      const progress =
        watchState && item.runtime_ticks && item.runtime_ticks > 0
          ? watchState.position_ticks / item.runtime_ticks
          : 0

      // Poster comes from TMDB — the media server stores the TMDB path, not a local URL.
      const imageUrl = item.poster_path
        ? `https://image.tmdb.org/t/p/w185${item.poster_path}`
        : undefined

      if (item.type === 'episode') {
        // For episodes we show the series title as the card title so the row
        // is recognizable at a glance; the episode code goes into the subtitle.
        let seriesTitle = item.title
        let subtitle: string | undefined
        if (item.series_id) {
          const series = getItemById(item.series_id)
          if (series) {
            seriesTitle = series.title
          }
        }
        if (item.season_number != null && item.episode_number != null) {
          const epLabel = item.episode_title ?? item.title
          subtitle = `S${String(item.season_number).padStart(2,'0')}E${String(item.episode_number).padStart(2,'0')} · ${epLabel}`
        }
        all.push({
          id: item.id,
          title: seriesTitle,
          subtitle,
          type: 'Episode',
          imageUrl,
          progress,
        })
      } else {
        all.push({
          id: item.id,
          title: item.title,
          type: 'Movie',
          imageUrl,
          progress,
        })
      }
    }

    items = all
  } catch {
    return (
      <section>
        <SectionHeading title="Continue Watching" viewAllHref="/history" />
        <UnavailableMessage message="Media server unavailable — cannot load continue watching." />
      </section>
    )
  }

  if (!items.length) {
    return (
      <section>
        <SectionHeading title="Continue Watching" viewAllHref="/history" />
        <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Nothing in progress — start watching something to resume here.
        </p>
      </section>
    )
  }

  return (
    <section>
      <SectionHeading title="Continue Watching" viewAllHref="/history" />
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border">
        {items.map((item) => (
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
                // Progress bar overlaid at the card bottom; bottom-9 clears the title text below
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
    </section>
  )
}

// ---------------------------------------------------------------------------
// Latest Added
// ---------------------------------------------------------------------------

async function LatestAddedSection() {
  let items: MediaItem[] = []
  try {
    items = getRecentlyAdded(12)
  } catch {
    return (
      <section>
        <SectionHeading title="Recently Added" />
        <UnavailableMessage message="Media server unavailable — cannot load recently added." />
      </section>
    )
  }

  if (!items.length) return null

  return (
    <section>
      <SectionHeading title="Recently Added" viewAllHref="/browse" />
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-border">
        {items.map((item) => {
          const imageUrl = item.poster_path
            ? `https://image.tmdb.org/t/p/w185${item.poster_path}`
            : undefined
          return (
            <div key={item.id} className="flex-shrink-0">
              <MediaCard
                id={item.id}
                title={item.title}
                year={item.year ?? undefined}
                imageUrl={imageUrl}
                type={item.type === 'movie' ? 'Movie' : 'Series'}
                href={`/play/${item.id}`}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pending Requests
// ---------------------------------------------------------------------------

function nativeStatusVariant(status: NativeRequestWithUser['status']): 'default' | 'warning' | 'success' | 'error' {
  switch (status) {
    case 'pending':   return 'warning'
    case 'approved':  return 'success'
    case 'available': return 'success'
    case 'declined':  return 'error'
    default:          return 'default'
  }
}

function nativeStatusLabel(status: NativeRequestWithUser['status']): string {
  switch (status) {
    case 'pending':   return 'Pending'
    case 'approved':  return 'Approved'
    case 'available': return 'Available'
    case 'declined':  return 'Declined'
    default:          return status
  }
}

async function PendingRequestsSection() {
  let requests: NativeRequestWithUser[] = []
  try {
    requests = getAllRequests({ status: 'pending' }).slice(0, 5)
  } catch {
    return (
      <section>
        <SectionHeading title="Pending Requests" viewAllHref="/requests" />
        <UnavailableMessage message="Requests unavailable." />
      </section>
    )
  }

  if (!requests.length) {
    return (
      <section>
        <SectionHeading title="Pending Requests" viewAllHref="/requests" />
        <p className="text-sm text-muted-foreground">No pending requests.</p>
      </section>
    )
  }

  return (
    <section>
      <SectionHeading title="Pending Requests" viewAllHref="/requests" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <ul className="divide-y divide-border">
          {requests.map((req) => {
            const requestedAt = req.created_at ? formatDate(new Date(req.created_at).toISOString()) : '—'

            return (
              <li key={req.id} className="hover:bg-accent/30 transition-colors">
                <a href="/requests" className="flex items-center gap-4 px-4 py-3">
                {/* Poster thumbnail */}
                {req.poster_path ? (
                  <img
                    src={`https://image.tmdb.org/t/p/w92${req.poster_path}`}
                    alt={req.title}
                    className="h-14 w-10 flex-shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-14 w-10 flex-shrink-0 rounded bg-muted" />
                )}

                {/* Title + meta */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{req.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{requestedAt}</p>
                </div>

                {/* Badges */}
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Badge variant="outline" className="capitalize">
                    {req.media_type === 'tv' ? 'TV Show' : 'Movie'}
                  </Badge>
                  <Badge variant={nativeStatusVariant(req.status)}>
                    {nativeStatusLabel(req.status)}
                  </Badge>
                </div>
                </a>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Active Downloads
// ---------------------------------------------------------------------------

// getTorrentStateColor returns a color name string, not a Tailwind class directly.
// This map bridges it to actual Tailwind text utilities.
const stateColorClass: Record<string, string> = {
  blue: 'text-blue-400',
  green: 'text-green-400',
  yellow: 'text-yellow-400',
  red: 'text-red-400',
  gray: 'text-muted-foreground',
}

async function ActiveDownloadsSection() {
  let torrents: Torrent[] = []
  try {
    const all = await getTorrents('downloading')
    torrents = all.slice(0, 5)
  } catch {
    return (
      <section>
        <SectionHeading title="Active Downloads" viewAllHref="/downloads" />
        <UnavailableMessage message="UMT unavailable." />
      </section>
    )
  }

  if (!torrents.length) {
    return (
      <section>
        <SectionHeading title="Active Downloads" viewAllHref="/downloads" />
        <p className="text-sm text-muted-foreground">No active downloads.</p>
      </section>
    )
  }

  return (
    <section>
      <SectionHeading title="Active Downloads" viewAllHref="/downloads" />
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <ul className="divide-y divide-border">
          {torrents.map((t) => {
            const name = t.name.length > 60 ? `${t.name.slice(0, 57)}...` : t.name
            const progressPct = Math.round(t.progress * 100)
            const dlSpeed = t.dlspeed > 0 ? `${formatBytes(t.dlspeed)}/s` : null
            const stateLabel = getTorrentStateLabel(t.state)
            const stateColor = getTorrentStateColor(t.state)
            const colorClass = stateColorClass[stateColor] ?? 'text-muted-foreground'

            return (
              <li key={t.hash} className="px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between gap-4">
                  <p className="min-w-0 truncate text-sm font-medium" title={t.name}>
                    {name}
                  </p>
                  <div className="flex flex-shrink-0 items-center gap-3 text-xs">
                    {dlSpeed && <span className="text-muted-foreground">{dlSpeed}</span>}
                    <span className={colorClass}>{stateLabel}</span>
                    <span className="text-muted-foreground">{progressPct}%</span>
                  </div>
                </div>
                {/* Progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
