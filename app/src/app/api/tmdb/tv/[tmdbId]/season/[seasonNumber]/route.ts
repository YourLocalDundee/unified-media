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
  { params }: { params: Promise<{ tmdbId: string; seasonNumber: string }> }
) {
  await requireAuth()
  try {
    const { tmdbId, seasonNumber } = await params
    const id = parseInt(tmdbId, 10)
    const season = parseInt(seasonNumber, 10)
    if (isNaN(id) || isNaN(season)) {
      return NextResponse.json({ error: 'Invalid id or season number' }, { status: 400 })
    }

    const raw = await tmdbFetch(`/tv/${id}/season/${season}?language=en-US`)

    const episodes = (raw.episodes ?? [])
      .filter((ep: Record<string, unknown>) => ep.episode_number)
      .map((ep: Record<string, unknown>) => ({
        episodeNumber: ep.episode_number as number,
        name: (ep.name as string) ?? null,
        airDate: (ep.air_date as string) ?? null,
      }))

    return NextResponse.json({ episodes })
  } catch (_err) {
    return NextResponse.json({ episodes: [] })
  }
}
