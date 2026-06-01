import { NextRequest, NextResponse } from 'next/server'
import { getEpisodes } from '@/lib/jellyfin/api'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ seasonId: string }> }
) {
  const { seasonId } = await params
  const { searchParams } = new URL(req.url)
  const seriesId = searchParams.get('seriesId') ?? ''
  const userId = process.env.JELLYFIN_USER_ID ?? ''

  if (!seriesId) {
    return NextResponse.json({ error: 'seriesId query param required' }, { status: 400 })
  }

  try {
    const episodes = await getEpisodes(seriesId, userId, seasonId)
    const sorted = [...episodes].sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0))
    return NextResponse.json(sorted)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
