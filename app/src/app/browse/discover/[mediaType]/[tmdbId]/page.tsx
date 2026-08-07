import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/dal'
import { getMovieDetail, getTVDetail, getArcs } from '@/lib/media-server/tmdb'
import { getItemsByTmdbIds } from '@/lib/media-server/library'
import { getRequestByTmdb } from '@/lib/requests/monitor'
import { getDisplayModeOverride } from '@/lib/media-server/display-prefs'
import RequestButton from './RequestButton'
import { SeasonCard } from '@/components/media/SeasonCard'
import { ArcCard } from '@/components/media/ArcCard'
import { DisplayModeToggle } from '@/components/media/DisplayModeToggle'

interface PageProps {
  params: Promise<{ mediaType: string; tmdbId: string }>
}

function formatRuntime(minutes: number | null): string | null {
  if (!minutes) return null
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function formatYear(date: string | null | undefined): number | null {
  if (!date) return null
  const n = parseInt(date.slice(0, 4), 10)
  return isNaN(n) ? null : n
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null
  return (
    <span className="flex items-center gap-1 text-yellow-400">
      <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      <span className="text-sm font-medium">{rating.toFixed(1)}</span>
      <span className="text-xs text-zinc-500">/ 10</span>
    </span>
  )
}

function CastCard({ name, character, profilePath }: { name: string; character: string; profilePath: string | null }) {
  const imgUrl = profilePath ? `https://image.tmdb.org/t/p/w185${profilePath}` : null
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-white/5">
      <div className="relative aspect-[2/3] w-full bg-zinc-800">
        {imgUrl ? (
          // A02-006/A15-G: TMDB host covered by remotePatterns — optimization on.
          <Image src={imgUrl} alt={name} fill sizes="100px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-zinc-600 text-2xl font-bold select-none">
            {name.charAt(0)}
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-white leading-tight line-clamp-1">{name}</p>
        <p className="text-[10px] text-zinc-400 leading-tight line-clamp-1 mt-0.5">{character}</p>
      </div>
    </div>
  )
}

export default async function DiscoverDetailPage({ params }: PageProps) {
  const session = await requireAuth()
  // Next.js 15 — dynamic segment params are a Promise; must be awaited before use.
  const { mediaType, tmdbId: tmdbIdStr } = await params

  if (mediaType !== 'movie' && mediaType !== 'tv') notFound()
  const tmdbId = parseInt(tmdbIdStr, 10)
  if (isNaN(tmdbId)) notFound()

  const [detail, libraryMap, arcs] = await Promise.all([
    mediaType === 'movie'
      ? getMovieDetail(tmdbId).catch(() => null)
      : getTVDetail(tmdbId).catch(() => null),
    Promise.resolve(getItemsByTmdbIds([tmdbId])),
    // Bug 7: TMDB story arcs (episode_groups). [] for movies and any series TMDB doesn't group
    // into arcs (most non-anime) — in which case we fall back to plain season cards below.
    mediaType === 'tv' ? getArcs(tmdbId).catch(() => []) : Promise.resolve([]),
  ])

  if (!detail) notFound()

  const libraryId = libraryMap[tmdbId] ?? null
  const existingRequest = getRequestByTmdb(session.userId, tmdbId, mediaType as 'movie' | 'tv')

  const isMovie = mediaType === 'movie'
  const movie = isMovie ? (detail as Awaited<ReturnType<typeof getMovieDetail>>) : null
  const tv = !isMovie ? (detail as Awaited<ReturnType<typeof getTVDetail>>) : null
  // Admins get the per-season direct-grab control on the Seasons list.
  const isAdmin = session.role === 'admin'

  // Arcs vs Seasons: default to Arcs when TMDB has story-arc grouping data, else plain Seasons —
  // an admin can override per-show (e.g. force Seasons for a show whose "arcs" read poorly).
  // The override only matters when arcs actually exist; a show with none only ever has Seasons.
  const displayOverride = !isMovie ? getDisplayModeOverride(tmdbId) : null
  const showArcs = arcs.length > 0 && displayOverride !== 'seasons'

  const title = movie?.title ?? tv?.name ?? ''
  const tagline = movie?.tagline ?? tv?.tagline ?? null
  const overview = movie?.overview ?? tv?.overview ?? null
  const posterPath = movie?.posterPath ?? tv?.posterPath ?? null
  const backdropPath = movie?.backdropPath ?? tv?.backdropPath ?? null
  const genres = movie?.genres ?? tv?.genres ?? []
  const voteAverage = movie?.voteAverage ?? tv?.voteAverage ?? null
  const year = formatYear(movie?.releaseDate ?? tv?.firstAirDate)
  const cast = movie?.cast ?? tv?.cast ?? []
  const crew = movie?.crew ?? tv?.crew ?? []

  const posterUrl = posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : null
  const backdropUrl = backdropPath ? `https://image.tmdb.org/t/p/w1280${backdropPath}` : null

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Backdrop */}
      {backdropUrl && (
        <div className="relative h-64 sm:h-80 lg:h-96 w-full overflow-hidden">
          {/* A02-006/A15-G: TMDB host covered by remotePatterns — optimization on. */}
          <Image
            src={backdropUrl}
            alt={title}
            fill
            priority
            sizes="100vw"
            className="object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/60 to-transparent" />
        </div>
      )}

      <div className="mx-auto max-w-screen-xl px-4 sm:px-6 lg:px-8">
        {/* Back link */}
        <div className={`${backdropUrl ? '-mt-8' : 'pt-8'} pb-2`}>
          <Link href="/browse?type=discover" className="text-sm text-zinc-400 hover:text-white transition">
            ← Back to Discover
          </Link>
        </div>

        {/* Hero section */}
        <div className="flex flex-col gap-6 sm:flex-row sm:gap-8 pb-10">
          {/* Poster */}
          {posterUrl && (
            <div className="relative w-36 sm:w-48 flex-shrink-0 self-start">
              <div className="relative aspect-[2/3] w-full overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10">
                <Image src={posterUrl} alt={title} fill sizes="(max-width: 640px) 144px, 192px" className="object-cover" />
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-1 flex-col gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight leading-tight">
                {title}
                {year && <span className="ml-2 text-xl font-normal text-zinc-400">({year})</span>}
              </h1>
              {tagline && <p className="mt-1 text-base italic text-zinc-400">{tagline}</p>}
            </div>

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-2">
              <StarRating rating={voteAverage} />
              <span className="rounded-full bg-zinc-800 px-3 py-0.5 text-xs font-medium text-zinc-300">
                {isMovie ? 'Movie' : 'TV Show'}
              </span>
              {isMovie && movie?.runtime && (
                <span className="rounded-full bg-zinc-800 px-3 py-0.5 text-xs font-medium text-zinc-300">
                  {formatRuntime(movie.runtime)}
                </span>
              )}
              {!isMovie && tv?.numberOfSeasons && (
                <span className="rounded-full bg-zinc-800 px-3 py-0.5 text-xs font-medium text-zinc-300">
                  {tv.numberOfSeasons} Season{tv.numberOfSeasons !== 1 ? 's' : ''}
                </span>
              )}
              {!isMovie && tv?.status && (
                <span className="rounded-full bg-zinc-800 px-3 py-0.5 text-xs font-medium text-zinc-300">
                  {tv.status}
                </span>
              )}
              {genres.slice(0, 4).map((g) => (
                <span key={g.id} className="rounded-full bg-zinc-800 px-3 py-0.5 text-xs font-medium text-zinc-300">
                  {g.name}
                </span>
              ))}
            </div>

            {/* Overview */}
            {overview && (
              <p className="text-sm text-zinc-300 leading-relaxed max-w-2xl">{overview}</p>
            )}

            {/* Crew highlights */}
            {crew.length > 0 && (
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                {crew.slice(0, 4).map((c) => (
                  <div key={`${c.id}-${c.job}`}>
                    <p className="text-xs text-zinc-500">{c.job}</p>
                    <p className="text-sm font-medium">{c.name}</p>
                  </div>
                ))}
              </div>
            )}

            {/* TV networks */}
            {tv?.networks && tv.networks.length > 0 && (
              <p className="text-xs text-zinc-400">
                {tv.networks.map((n) => n.name).join(' · ')}
              </p>
            )}

            {/* Request / Watch button */}
            <div className="mt-2">
              <RequestButton
                tmdbId={tmdbId}
                mediaType={mediaType as 'movie' | 'tv'}
                title={title}
                year={year}
                posterPath={posterPath}
                overview={overview}
                libraryId={libraryId}
                existingStatus={existingRequest?.status}
                existingRequestType={existingRequest?.request_type}
              />
            </div>
          </div>
        </div>

        {/* Cast */}
        {cast.length > 0 && (
          <section className="pb-12">
            <h2 className="mb-4 text-lg font-semibold">Cast</h2>
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
              {cast.slice(0, 12).map((c) => (
                <CastCard key={c.id} name={c.name} character={c.character} profilePath={c.profilePath} />
              ))}
            </div>
          </section>
        )}

        {/* TV Arcs (Bug 7) — when TMDB groups this series into story arcs, show those instead of
            the merged "seasons" so each arc (e.g. Impel Down) is separately grabbable with its
            own true episode range. Admins can override this per-show via DisplayModeToggle when
            arcs exist but plain Seasons reads better for that title. */}
        {showArcs && (
          <section className="pb-12">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <h2 className="text-lg font-semibold">Arcs</h2>
              {isAdmin && <DisplayModeToggle tmdbId={tmdbId} mode="arcs" />}
            </div>
            <p className="mb-4 text-xs text-zinc-500">Story arcs from TMDB — each grabs only its own episode range.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {arcs.map((a) => (
                <ArcCard key={a.id} tmdbId={tmdbId} title={title} year={year} arc={a} isAdmin={isAdmin} />
              ))}
            </div>
          </section>
        )}

        {/* TV Seasons — shown when the series has no TMDB arc grouping, or an admin overrode a
            show that has arcs back to plain Seasons. */}
        {!showArcs && tv?.seasons && tv.seasons.length > 0 && (
          <section className="pb-12">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
              <h2 className="text-lg font-semibold">Seasons</h2>
              {isAdmin && arcs.length > 0 && <DisplayModeToggle tmdbId={tmdbId} mode="seasons" />}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {tv.seasons.map((s) => (
                <SeasonCard key={s.id} tmdbId={tmdbId} title={title} year={year} season={s} isAdmin={isAdmin} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
