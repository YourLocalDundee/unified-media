// Episode list for a specific season. Requires both seasonId (path) and seriesId
// (query param) because Jellyfin's episode endpoint needs the series context to
// look up the correct library item.
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'
import { getEpisodes } from '@/lib/jellyfin/api'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  // S1: credentialed Jellyfin proxy — require a session (matches stream/playback/subtitles).
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { seasonId } = await params
  const { searchParams } = new URL(req.url)
  const seriesId = searchParams.get('seriesId') ?? ''
  const userId = process.env.JELLYFIN_USER_ID ?? ''

  if (!seriesId) {
    return NextResponse.json({ error: 'seriesId query param required' }, { status: 400 })
  }

  try {
    const episodes = await getEpisodes(seriesId, userId, seasonId)
    // Sort client-side because Jellyfin's episode endpoint does not guarantee order.
    const sorted = [...episodes].sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0))
    return NextResponse.json(sorted)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
