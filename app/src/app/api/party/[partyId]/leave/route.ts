// POST /api/party/[partyId]/leave — caller leaves the party.
// Host leaving does NOT end the party; only the last member out ends it.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getPartyStore } from '@/lib/party/state-store'
import { markMemberLeft, countActiveMembers, endPartyRow } from '@/lib/party/db'

export const dynamic = 'force-dynamic'

export async function POST(_req: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const session = await requireAuth()
  const { partyId } = await params

  markMemberLeft(partyId, session.userId)

  // Last member out ends the party (status ended + tear down live state).
  if (countActiveMembers(partyId) === 0) {
    endPartyRow(partyId)
    await getPartyStore().endParty(partyId)
  }

  return NextResponse.json({ ok: true })
}
