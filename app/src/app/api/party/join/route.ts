// POST /api/party/join — join an active party by friendly code or by id.
// requireAuth; idempotent (reactivates an existing membership row).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { checkRateLimit } from '@/lib/rate-limit'
import { verifyOrigin } from '@/lib/csrf'
import { getPartyStore } from '@/lib/party/state-store'
import { JOIN_RATE_LIMIT, RATE_LIMIT_WINDOW_MS } from '@/lib/party/constants'
import { getActivePartyByCode, getActivePartyById, upsertMember } from '@/lib/party/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  const rl = checkRateLimit(`party-join:${session.userId}`, JOIN_RATE_LIMIT, RATE_LIMIT_WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many join attempts. Try again later.' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { joinCode?: string; partyId?: string } | null
  if (!body || (!body.joinCode && !body.partyId)) {
    return NextResponse.json({ error: 'joinCode or partyId is required' }, { status: 400 })
  }

  const party = body.joinCode
    ? getActivePartyByCode(body.joinCode)
    : getActivePartyById(body.partyId!)
  if (!party) {
    // Count a failed attempt against a separate bucket so a brute-force scan of
    // the 6-char join code (~36^6) is throttled without burning the normal join quota.
    const fail = checkRateLimit(`party-join-fail:${session.userId}`, 10, RATE_LIMIT_WINDOW_MS)
    if (!fail.allowed) {
      return NextResponse.json({ error: 'Too many failed join attempts. Try again later.' }, { status: 429 })
    }
    return NextResponse.json({ error: 'Party not found or already ended' }, { status: 404 })
  }

  upsertMember(party.id, session.userId)

  // The WS server may not have live state if it was restarted — restore it from
  // the durable checkpoint so the joiner has authoritative state to sync against.
  const store = getPartyStore()
  if ((await store.getParty(party.id)) == null) {
    await store.createParty({
      partyId: party.id,
      mediaId: party.media_id,
      positionTicks: party.last_position_ticks,
      paused: party.last_paused === 1,
    })
  }

  return NextResponse.json({ partyId: party.id, mediaId: party.media_id, joinCode: party.join_code })
}
