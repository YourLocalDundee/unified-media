import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { createSession } from '@/lib/media-server/playback'

export const dynamic = 'force-dynamic'

interface PlaybackBody {
  mediaId: string
  method: 'direct' | 'hls'
  quality?: '1080p' | '720p' | '480p' | '360p'
}

export async function POST(req: NextRequest) {
  await requireAuth()

  const body = await req.json() as PlaybackBody
  const { mediaId, method, quality } = body

  if (!mediaId || !method) {
    return NextResponse.json({ error: 'mediaId and method are required' }, { status: 400 })
  }

  const session = createSession(mediaId, method, quality)
  if (!session) {
    return NextResponse.json({ error: 'Media item not found or has no file' }, { status: 404 })
  }

  return NextResponse.json({
    sessionId: session.sessionId,
    streamUrl: session.streamUrl,
    method: session.method,
  })
}
