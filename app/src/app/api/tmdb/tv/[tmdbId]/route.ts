/**
 * TMDB reverse proxy — injects the Bearer token so client components can fetch
 * TV show details without the API key ever reaching the browser.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'

export const dynamic = 'force-dynamic'

const TMDB_BASE = 'https://api.themoviedb.org/3'

function tmdbFetch(path: string) {
  const token = process.env.TMDB_ACCESS_TOKEN
  if (!token) throw new Error('TMDB_ACCESS_TOKEN not set')
  return fetch(`${TMDB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 86400 },
  }).then(async (r) => {
    if (!r.ok) throw new Error(`TMDB ${r.status}`)
    return r.json()
  })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tmdbId: string }> }
) {
  await requireAuth()
  try {
    const { tmdbId } = await params
    const id = parseInt(tmdbId, 10)
    if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const raw = await tmdbFetch(`/tv/${id}?append_to_response=external_ids&language=en-US`)

    const data = {
      name: raw.name,
      overview: raw.overview ?? null,
      posterPath: raw.poster_path ?? null,
      backdropPath: raw.backdrop_path ?? null,
      firstAirDate: raw.first_air_date ?? null,
      status: raw.status ?? null,
      networks: raw.networks ?? [],
      numberOfSeasons: raw.number_of_seasons ?? null,
      numberOfEpisodes: raw.number_of_episodes ?? null,
      genres: raw.genres ?? [],
      episodeRunTime: raw.episode_run_time ?? [],
      homepage: raw.homepage ?? null,
      originalLanguage: raw.original_language ?? null,
      voteAverage: raw.vote_average ?? null,
      externalIds: {
        tvdb_id: raw.external_ids?.tvdb_id ?? null,
        imdb_id: raw.external_ids?.imdb_id ?? null,
      },
      seasons: (raw.seasons ?? []).map((s: Record<string, unknown>) => ({
        id: s.id,
        seasonNumber: s.season_number,
        episodeCount: s.episode_count ?? null,
        airDate: s.air_date ?? null,
        overview: s.overview ?? null,
        name: s.name ?? null,
      })),
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
