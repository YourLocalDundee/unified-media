import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import type { RequestStatus } from '@/lib/requests/types'
import {
  getAllRequests,
  getUserRequests,
  getRequestByTmdb,
  createRequest,
  updateRequestStatus,
} from '@/lib/requests/monitor'
import { getSetting } from '@/lib/settings/index'

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

  // Auto-approve if enabled in settings
  const autoApprove = getSetting('auto_approve', '0') === '1'
  if (autoApprove) {
    updateRequestStatus(created.id, 'approved')
    const approved = { ...created, status: 'approved' as const }
    return NextResponse.json(approved, { status: 201 })
  }

  return NextResponse.json(created, { status: 201 })
}
