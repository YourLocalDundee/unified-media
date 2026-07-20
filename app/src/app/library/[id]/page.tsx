import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getItemById, getEpisodesForSeries, getWatchState, getSimilarItems, getSeriesResumeEpisode } from '@/lib/media-server/library'
import type { MediaItem } from '@/lib/media-server/types'
import { formatDuration } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import MediaCard from '@/components/media/MediaCard'
import { LibraryItemAdminMenu } from '@/components/media/LibraryItemAdminMenu'
import { SeasonEpisodeList } from '@/components/media/SeasonEpisodeList'
import { requireAuth } from '@/lib/dal'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const item = getItemById(id)
  return {
    title: item ? `${item.title} — minime` : 'Library — minime',
    description: item?.overview ?? undefined,
  }
}

export default async function LibraryDetailPage({ params }: Props) {
  const session = await requireAuth()
  const isAdmin = session.role === 'admin'
  const { id } = await params
  const item: MediaItem | undefined = getItemById(id)
  if (!item) notFound()

  const year = item.year
  const runtime = item.runtime_ticks ? formatDuration(item.runtime_ticks) : null

  const posterUrl = item.poster_path
    ? `https://image.tmdb.org/t/p/w342${item.poster_path}`
    : null
  const backdropUrl = item.backdrop_path
    ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
    : null

  const watchState = getWatchState(session.userId, id)
  const resumePositionTicks = watchState?.position_ticks ?? 0

  const episodes: MediaItem[] = item.type === 'series' ? getEpisodesForSeries(id) : []
  const similar: MediaItem[] = item.type !== 'episode' ? getSimilarItems(id, 12) : []

  let watchNowHref: string | null = null
  if (item.type === 'series') {
    const resumeEp = getSeriesResumeEpisode(session.userId, id)
    const targetEp = resumeEp ?? episodes[0]
    watchNowHref = targetEp ? `/play/${targetEp.id}` : null
  } else if (item.file_path) {
    watchNowHref = `/play/${item.id}`
  }

  return (
    <div className="relative min-h-screen">
      {/* Admin-only corner settings: delete-from-server lives here. */}
      {isAdmin && (
        <div className="absolute right-4 top-4 z-20">
          <LibraryItemAdminMenu itemId={item.id} title={item.title} />
        </div>
      )}
      {backdropUrl && (
        <div className="absolute inset-0 -z-10">
          {/* A02-006/A15-G: TMDB host covered by remotePatterns — optimization on. */}
          <Image
            fill
            src={backdropUrl}
            alt=""
            style={{ objectFit: 'cover' }}
            className="opacity-20"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        </div>
      )}

      <div className="container mx-auto px-6 pt-20 pb-12">
        <div className="flex gap-8">
          <div className="flex-shrink-0 w-48 h-72 rounded-lg overflow-hidden bg-zinc-900">
            {posterUrl ? (
              <div className="relative w-full h-full">
                <Image
                  src={posterUrl}
                  alt={item.title}
                  fill
                  style={{ objectFit: 'cover' }}
                  priority
                />
              </div>
            ) : (
              <div className="flex w-full h-full items-center justify-center text-zinc-500 text-sm px-3 text-center">
                {item.title}
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold text-white mb-2">{item.title}</h1>

            <div className="flex items-center gap-2 text-zinc-400 text-sm mb-4 flex-wrap">
              {year && <span>{year}</span>}
              {runtime && (
                <>
                  {year && <span className="text-zinc-600">&middot;</span>}
                  <span>{runtime}</span>
                </>
              )}
            </div>

            {item.overview && (
              <p className="text-zinc-300 leading-relaxed mb-6 max-w-2xl">{item.overview}</p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              {watchNowHref && (
                <Link href={watchNowHref}>
                  <Button>&#9654; Watch Now</Button>
                </Link>
              )}
              {resumePositionTicks > 0 && (
                <span className="text-zinc-400 text-sm">
                  Continue from {formatDuration(resumePositionTicks)}
                </span>
              )}
            </div>
          </div>
        </div>

        {item.type === 'series' && episodes.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-white mb-4">Episodes</h2>
            <SeasonEpisodeList episodes={episodes} />
          </section>
        )}

        {similar.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-white mb-4">More Like This</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {similar.map((s) => (
                <MediaCard
                  key={s.id}
                  id={s.id}
                  title={s.title}
                  year={s.year ?? undefined}
                  imageUrl={s.poster_path ? `https://image.tmdb.org/t/p/w300${s.poster_path}` : undefined}
                  type={s.type === 'movie' ? 'Movie' : 'Series'}
                  href={s.type === 'series' ? `/library/${s.id}` : `/play/${s.id}`}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
