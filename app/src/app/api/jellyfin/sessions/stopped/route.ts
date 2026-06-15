// Notifies Jellyfin that playback has stopped (POST /Sessions/Playing/Stopped).
// Called by VideoPlayer on the 'ended' event and when the player is closed.
// This is what makes Jellyfin mark an item as played and remove it from Now Playing.
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'
import { jellyfinFetch } from '@/lib/jellyfin/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Credentialed Jellyfin proxy — require a session (A4-C2).
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  await jellyfinFetch('/Sessions/Playing/Stopped', { method: 'POST', body: JSON.stringify(body) })
  return NextResponse.json({ ok: true })
}
