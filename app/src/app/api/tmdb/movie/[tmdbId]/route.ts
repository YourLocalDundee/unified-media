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

    const raw = await tmdbFetch(`/movie/${id}?append_to_response=credits,external_ids&language=en-US`)

    const data = {
      title: raw.title,
      tagline: raw.tagline ?? null,
      overview: raw.overview ?? null,
      posterPath: raw.poster_path ?? null,
      backdropPath: raw.backdrop_path ?? null,
      releaseDate: raw.release_date ?? null,
      runtime: raw.runtime ?? null,
      genres: raw.genres ?? [],
      productionCompanies: raw.production_companies ?? [],
      budget: raw.budget ?? 0,
      revenue: raw.revenue ?? 0,
      homepage: raw.homepage ?? null,
      originalLanguage: raw.original_language ?? null,
      voteAverage: raw.vote_average ?? null,
      belongsToCollection: raw.belongs_to_collection ?? null,
      externalIds: {
        imdb_id: raw.external_ids?.imdb_id ?? null,
      },
      credits: {
        cast: (raw.credits?.cast ?? []).map((c: Record<string, unknown>) => ({
          id: c.id,
          name: c.name,
          character: c.character,
          profilePath: c.profile_path ?? null,
        })),
        crew: (raw.credits?.crew ?? []).map((c: Record<string, unknown>) => ({
          id: c.id,
          name: c.name,
          job: c.job,
          department: c.department,
          profilePath: c.profile_path ?? null,
        })),
      },
    }

    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
