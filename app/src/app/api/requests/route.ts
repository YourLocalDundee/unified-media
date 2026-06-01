import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import type { RequestStatus } from '@/lib/requests/types'
import {
  getAllRequests,
  getUserRequests,
  getRequestByTmdb,
  createRequest,
} from '@/lib/requests/monitor'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await requireAuth()

  const statusParam = req.nextUrl.searchParams.get('status') as RequestStatus | null
  const opts = statusParam ? { status: statusParam } : undefined

  if (session.role === 'admin') {
    const requests = getAllRequests(opts)
    return NextResponse.json(requests)
  }

  const requests = getUserRequests(session.userId, opts)
  return NextResponse.json(requests)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()

  const body = await req.json() as {
    tmdbId?: number
    mediaType?: 'movie' | 'tv'
    title?: string
    year?: number
    posterPath?: string
    overview?: string
    seasons?: number[]
  }

  const { tmdbId, mediaType, title, year, posterPath, overview, seasons } = body

  if (!tmdbId || !mediaType || !title) {
    return NextResponse.json(
      { error: 'tmdbId, mediaType, and title are required' },
      { status: 400 }
    )
  }

  const existing = getRequestByTmdb(session.userId, tmdbId, mediaType)
  if (existing) {
    return NextResponse.json({ error: 'Already requested' }, { status: 409 })
  }

  const created = createRequest({
    userId: session.userId,
    tmdbId,
    mediaType,
    title,
    year,
    posterPath,
    overview,
    seasons,
  })

  return NextResponse.json(created, { status: 201 })
}
