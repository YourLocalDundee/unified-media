// Season list for a TV series. Sorts by IndexNumber with the Specials season
// (IndexNumber=0) moved to the end of the list since it is less commonly accessed.
import { NextRequest, NextResponse } from 'next/server'
import { getSeasons } from '@/lib/jellyfin/api'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const userId = process.env.JELLYFIN_USER_ID ?? ''
  try {
    const seasons = await getSeasons(id, userId)
    // Sort by IndexNumber, move IndexNumber 0 (Specials) to end
    const numbered = seasons
      .filter((s) => (s.IndexNumber ?? 0) > 0)
      .sort((a, b) => (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0))
    const specials = seasons.filter((s) => (s.IndexNumber ?? 0) === 0)
    return NextResponse.json([...numbered, ...specials])
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
