import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { upsertWatchState, recordWatchEvent } from '@/lib/media-server/library'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

interface ProgressBody {
  mediaId: string
  positionTicks: number
  played?: boolean
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  const session = await requireAuth()

  let body: ProgressBody
  try { body = await req.json() as ProgressBody }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard
  const { mediaId, positionTicks, played = false } = body

  if (!mediaId || positionTicks === undefined) {
    return NextResponse.json({ error: 'mediaId and positionTicks are required' }, { status: 400 })
  }

  upsertWatchState(session.userId, mediaId, positionTicks, played)
  // Also feed watch_events so /history and the admin activity views have data (A3-01).
  recordWatchEvent(session.userId, mediaId, positionTicks, played)

  return NextResponse.json({ ok: true })
}
