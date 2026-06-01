import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { upsertWatchState } from '@/lib/media-server/library'

export const dynamic = 'force-dynamic'

interface ProgressBody {
  mediaId: string
  positionTicks: number
  played?: boolean
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()

  const body = await req.json() as ProgressBody
  const { mediaId, positionTicks, played = false } = body

  if (!mediaId || positionTicks === undefined) {
    return NextResponse.json({ error: 'mediaId and positionTicks are required' }, { status: 400 })
  }

  upsertWatchState(session.userId, mediaId, positionTicks, played)

  return NextResponse.json({ ok: true })
}
