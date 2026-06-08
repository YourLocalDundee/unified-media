// POST /api/party/[partyId]/leave — caller leaves the party.
// Host leaving does NOT end the party; only the last member out ends it.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getPartyStore } from '@/lib/party/state-store'
import { leaveAndMaybeEnd } from '@/lib/party/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ partyId: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()
  const { partyId } = await params

  // Atomic mark-left + last-member-out decision in a single durable call so a
  // concurrent leave can't race the count. Host leaving does NOT special-case
  // end; only zero active members ends it.
  const { ended } = leaveAndMaybeEnd(partyId, session.userId)
  if (ended) {
    // Tear down live state, which fans party_ended to any remaining sockets.
    await getPartyStore().endParty(partyId)
  }

  return NextResponse.json({ ok: true })
}
