import { NextRequest, NextResponse } from 'next/server'
import { getPlaybackData } from '@/lib/jellyfin/playback'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const data = await getPlaybackData(id)
    return NextResponse.json(data)
  } catch (err) {
    console.error('[playback]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
