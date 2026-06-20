// Home dashboard page — the landing screen after login.
// Aggregates data from four independent sources (native media server, native requests,
// qBittorrent) into a single-page view. Each section is wrapped in its own Suspense
// boundary so one slow/failing data source doesn't block the rest from rendering.

import { Suspense } from 'react'
import Link from 'next/link'
import { getResumeItems, getWatchState, getRecentlyAdded, getItemById } from '@/lib/media-server/library'
import { tmdbImageUrl } from '@/lib/media-server'
import { getAllRequests } from '@/lib/requests/monitor'
import { getTorrents } from '@/lib/qbittorrent/api'
import { getTorrentStateLabel, getTorrentStateColor } from '@/lib/qbittorrent/types'
import { formatBytes, formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { JoinPartyButton } from '@/components/party/JoinPartyButton'
import { requireAuth } from '@/lib/dal'
import type { MediaItem, WatchState } from '@/lib/media-server/types'
import type { NativeRequestWithUser } from '@/lib/requests/types'
import type { Torrent } from '@/lib/qbittorrent/types'
import { ContinueWatchingCarousel, RecentlyAddedCarousel } from './HomeCarousels'
import type { ContinueItem, RecentItem } from './HomeCarousels'

// ---------------------------------------------------------------------------
// Root page — all sections are independently fault-tolerant via Suspense
// ---------------------------------------------------------------------------

export default async function HomePage() {
  await requireAuth()
  return (
    <div className="space-y-10">
      <div className="flex items-center justify-end">
        {/* Manual code entry for a watch party — the one join path that isn't a one-tap link (A5-01). */}
        <JoinPartyButton />
      </div>
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

// Resolve a card poster URL with a fallback chain. Episodes carry no poster_path
// (the scanner never writes one and the enricher only enriches movies/series), so
// without a fallback they render as a gray placeholder while every movie/series in
// the same row shows its poster. Fall back to the parent series' poster, then a
// backdrop, before giving up. Reuses the shared `tmdbImageUrl` builder so the TMDB
// base URL is never hardcoded here.
function resolveCardImage(item: MediaItem, series?: MediaItem): string | undefined {
  return (
    tmdbImageUrl(item.poster_path, 'w342') ??
    tmdbImageUrl(series?.poster_path ?? null, 'w342') ??
    tmdbImageUrl(series?.backdrop_path ?? null, 'w780') ??
    tmdbImageUrl(item.backdrop_path, 'w780') ??
    undefined
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
  let items: ContinueItem[] = []

  try {
    const raw: MediaItem[] = getResumeItems(userId, 10)

    const all: ContinueItem[] = []

    for (const item of raw) {
      const watchState: WatchState | undefined = getWatchState(userId, item.id)
      // progress is 0 if watch state is missing or runtime is unknown (e.g. live)
      const progress =
        watchState && item.runtime_ticks && item.runtime_ticks > 0
          ? watchState.position_ticks / item.runtime_ticks
          : 0

      // Episodes store their parent under series_id; fetch it once so it can supply
      // both the display title and the poster fallback (episodes have no poster_path).
      const series = item.type === 'episode' && item.series_id
        ? getItemById(item.series_id)
        : undefined

      // Poster comes from TMDB — the media server stores the TMDB path, not a local URL.
      const imageUrl = resolveCardImage(item, series)

      if (item.type === 'episode') {
        // For episodes we show the series title as the card title so the row
        // is recognizable at a glance; the episode code goes into the subtitle.
        let seriesTitle = series ? series.title : item.title
        let subtitle: string | undefined
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

  const emptyFallback = (
    <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      Nothing in progress — start watching something to resume here.
    </p>
  )

  return (
    <section>
      <SectionHeading title="Continue Watching" viewAllHref="/history" />
      <ContinueWatchingCarousel items={items as ContinueItem[]} fallback={emptyFallback} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Latest Added
// ---------------------------------------------------------------------------

async function LatestAddedSection() {
  let recentItems: RecentItem[] = []
  try {
    const raw = getRecentlyAdded(12)
    recentItems = raw.map((item) => {
      // Recently Added is normally movies/series, but a mis-classified episode
      // (e.g. a top-level anime episode) can land here with no poster_path — fall
      // back to its parent series' poster the same way Continue Watching does.
      const series = item.series_id ? getItemById(item.series_id) : undefined
      return {
        id: item.id,
        title: item.title,
        year: item.year ?? undefined,
        imageUrl: resolveCardImage(item, series),
        type: (item.type === 'movie' ? 'Movie' : 'Series') as 'Movie' | 'Series',
        href: item.type === 'series' ? `/library/${item.id}` : `/play/${item.id}`,
      }
    })
  } catch {
    return (
      <section>
        <SectionHeading title="Recently Added" />
        <UnavailableMessage message="Media server unavailable — cannot load recently added." />
      </section>
    )
  }

  if (!recentItems.length) return null

  return (
    <section>
      <SectionHeading title="Recently Added" viewAllHref="/library" />
      <RecentlyAddedCarousel items={recentItems} />
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
