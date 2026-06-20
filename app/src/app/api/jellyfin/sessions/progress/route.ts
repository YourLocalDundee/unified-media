// Reports playback progress to Jellyfin (POST /Sessions/Playing/Progress).
// Called periodically by VideoPlayer (e.g. every 10s during playback) so Jellyfin
// tracks resume position and shows accurate progress in its clients.
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/dal'
import { jellyfinFetch } from '@/lib/jellyfin/client'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  // Credentialed Jellyfin proxy — require a session (A4-C2).
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard
  await jellyfinFetch('/Sessions/Playing/Progress', { method: 'POST', body: JSON.stringify(body) })
  return NextResponse.json({ ok: true })
}
