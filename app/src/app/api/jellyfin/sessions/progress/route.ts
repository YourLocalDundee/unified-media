// Reports playback progress to Jellyfin (POST /Sessions/Playing/Progress).
// Called periodically by VideoPlayer (e.g. every 10s during playback) so Jellyfin
// tracks resume position and shows accurate progress in its clients.
import { NextRequest, NextResponse } from 'next/server'
import { jellyfinFetch } from '@/lib/jellyfin/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json()
  await jellyfinFetch('/Sessions/Playing/Progress', { method: 'POST', body: JSON.stringify(body) })
  return NextResponse.json({ ok: true })
}
