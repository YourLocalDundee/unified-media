// Notifies Jellyfin that playback has started (POST /Sessions/Playing).
// Called by VideoPlayer on the first play event so Jellyfin can update Now Playing
// and show the session in its dashboard. No auth check here — the session info
// passed in the body identifies the playback session to Jellyfin.
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'
import { jellyfinFetch } from '@/lib/jellyfin/client'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Forwards an attacker-controllable body to Jellyfin under the server key —
  // require a session (A4-C2).
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  await jellyfinFetch('/Sessions/Playing', { method: 'POST', body: JSON.stringify(body) })
  return NextResponse.json({ ok: true })
}
