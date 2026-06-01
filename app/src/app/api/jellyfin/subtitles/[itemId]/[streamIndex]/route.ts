import { NextRequest } from 'next/server'
import { JELLYFIN_URL, JELLYFIN_API_KEY } from '@/lib/jellyfin/client'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string; streamIndex: string }> }
) {
  const { itemId, streamIndex } = await params
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
