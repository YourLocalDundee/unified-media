// Playback data endpoint for the VideoPlayer component.
// Delegates to getPlaybackData() in lib/jellyfin/playback.ts which resolves the
// stream URL, builds quality tiers, extracts chapters, and handles both direct-play
// and HLS transcode paths. The VideoPlayer calls this once on mount.
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'
import { getPlaybackData } from '@/lib/jellyfin/playback'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // This proxies Jellyfin with the server API key, so it must require a session —
  // it was previously reachable pre-auth (A4-C2).
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  try {
    const data = await getPlaybackData(id)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[playback]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
