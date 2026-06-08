// POST /api/party — create a watch party for a playable media item.
// requireAuth; caller becomes host. Returns a shareable code + one-tap join URL.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, makeId, logEvent } from '@/lib/dal'
import { checkRateLimit } from '@/lib/rate-limit'
import { getDb } from '@/lib/db/index'
import { getPartyStore } from '@/lib/party/state-store'
import { CREATE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS } from '@/lib/party/constants'
import { createPartyRow, generateUniqueJoinCode } from '@/lib/party/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await requireAuth()

  const rl = checkRateLimit(`party-create:${session.userId}`, CREATE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many parties created. Try again later.' }, { status: 429 })
  }

  const body = await req.json() as { mediaId?: string }
  const mediaId = body.mediaId
  if (!mediaId) {
    return NextResponse.json({ error: 'mediaId is required' }, { status: 400 })
  }

  // Parties are per playable item — series containers (file_path NULL) are rejected.
  const item = getDb()
    .prepare('SELECT id, file_path FROM media_items WHERE id = ?')
    .get(mediaId) as { id: string; file_path: string | null } | undefined
  if (!item) {
    return NextResponse.json({ error: 'Media item not found' }, { status: 400 })
  }
  if (!item.file_path) {
    return NextResponse.json({ error: 'This item is not directly playable' }, { status: 400 })
  }

  const partyId = makeId(32)
  const joinCode = generateUniqueJoinCode()
  createPartyRow({ id: partyId, joinCode, hostUserId: session.userId, mediaId })

  // Seed the in-memory live state so the WS server has authoritative state to fan.
  await getPartyStore().createParty({ partyId, mediaId, positionTicks: 0, paused: true })

  await logEvent('party_created', { partyId, mediaId, joinCode }, { userId: session.userId, username: session.username })

  const joinUrl = `${process.env.NEXT_PUBLIC_APP_URL}/play/${mediaId}?party=${joinCode}`
  return NextResponse.json({ partyId, joinCode, joinUrl }, { status: 201 })
}
