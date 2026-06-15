// Subtitle track proxy: fetches a WebVTT subtitle stream from Jellyfin and serves
// it to the browser. Required because the Jellyfin subtitle URL includes a token
// and is on the internal host IP, neither of which can be exposed to the client.
// streamIndex is the subtitle track index from Jellyfin's MediaStreams array.
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'
import { JELLYFIN_URL, JELLYFIN_API_KEY } from '@/lib/jellyfin/client'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string; streamIndex: string }> }
) {
  // Credentialed Jellyfin proxy reachable pre-auth, with both params interpolated
  // straight into the upstream URL — require a session and validate the params so
  // they can't be used to reshape the Jellyfin request (A4-C2).
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { itemId, streamIndex } = await params
  if (!/^[a-fA-F0-9]{32}$/.test(itemId) || !/^\d+$/.test(streamIndex)) {
    return NextResponse.json({ error: 'Invalid item or stream index' }, { status: 400 })
  }
  const authHeader = `MediaBrowser Client="unified-frontend", Device="server", DeviceId="unified-frontend-01", Version="0.1.0", Token="${JELLYFIN_API_KEY}"`
  const url = `${JELLYFIN_URL}/Videos/${itemId}/Subtitles/${streamIndex}/Stream.vtt`
  const res = await fetch(url, {
    headers: { Authorization: authHeader },
  })
  if (!res.ok) return new Response(null, { status: res.status })
  return new Response(res.body, {
    headers: {
      'Content-Type': 'text/vtt',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
