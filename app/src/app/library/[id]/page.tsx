import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getItemById, getEpisodesForSeries, getWatchState, getSimilarItems, getSeriesResumeEpisode } from '@/lib/media-server/library'
import type { MediaItem } from '@/lib/media-server/types'
import { formatDuration } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import MediaCard from '@/components/media/MediaCard'
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

  const seasonMap = new Map<number, MediaItem[]>()
  for (const ep of episodes) {
    const s = ep.season_number ?? 0
    if (!seasonMap.has(s)) seasonMap.set(s, [])
    seasonMap.get(s)!.push(ep)
  }
  const seasons = [...seasonMap.entries()].sort((a, b) => a[0] - b[0])

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
      {backdropUrl && (
        <div className="absolute inset-0 -z-10">
          <Image
            fill
            src={backdropUrl}
            alt=""
            style={{ objectFit: 'cover' }}
            className="opacity-20"
            priority
            unoptimized
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
                  unoptimized
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

        {item.type === 'series' && seasons.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold text-white mb-4">Episodes</h2>
            {seasons.map(([seasonNumber, eps]) => (
              <div key={seasonNumber} className="mb-8">
                <h3 className="text-lg font-medium text-zinc-300 mb-3">
                  {seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`}
                </h3>
                <div className="flex flex-col gap-2">
                  {eps.map((ep) => (
                    <Link
                      key={ep.id}
                      href={`/play/${ep.id}`}
                      className="flex flex-col rounded-lg bg-zinc-900 hover:bg-zinc-800 px-4 py-3 transition-colors"
                    >
                      <span className="text-white text-sm font-medium">
                        S{String(ep.season_number ?? 0).padStart(2, '0')} E{String(ep.episode_number ?? 0).padStart(2, '0')} &mdash; {ep.title}
                      </span>
                      {ep.overview && (
                        <span className="text-zinc-500 text-xs mt-1 line-clamp-2">
                          {ep.overview}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
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
