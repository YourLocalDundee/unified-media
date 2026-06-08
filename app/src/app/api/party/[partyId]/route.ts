// GET    /api/party/[partyId] — durable party info + member list (members only).
// DELETE /api/party/[partyId] — host explicitly ends the party for everyone.

import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getPartyStore } from '@/lib/party/state-store'
import { getActivePartyById, getMembers, isActiveMember, endPartyRow } from '@/lib/party/db'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, { params }: { params: Promise<{ partyId: string }> }) {
  const session = await requireAuth()
  const { partyId } = await params

  const party = getActivePartyById(partyId)
  if (!party) {
    return NextResponse.json({ error: 'Party not found or already ended' }, { status: 404 })
  }
  // Never act on membership inferred elsewhere — check it against the DB here.
  // Return 404 (not 403) so a non-member cannot distinguish "exists but you're
  // not in it" from "does not exist" — party existence stays opaque to outsiders.
  if (!isActiveMember(partyId, session.userId)) {
    return NextResponse.json({ error: 'Party not found or already ended' }, { status: 404 })
  }

  return NextResponse.json({
    id: party.id,
    joinCode: party.join_code,
    mediaId: party.media_id,
    hostUserId: party.host_user_id,
    status: party.status,
    members: getMembers(partyId),
  })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ partyId: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()
  const { partyId } = await params

  // Host-only. Look up the row directly so a non-active party still resolves the host.
  const party = getDb()
    .prepare('SELECT host_user_id FROM watch_parties WHERE id = ?')
    .get(partyId) as { host_user_id: string } | undefined
  if (!party) {
    return NextResponse.json({ error: 'Party not found' }, { status: 404 })
  }
  if (party.host_user_id !== session.userId) {
    return NextResponse.json({ error: 'Only the host can end the party' }, { status: 403 })
  }

  endPartyRow(partyId)
  // Ends the live party in the shared store, which fans party_ended to all sockets.
  await getPartyStore().endParty(partyId)

  return NextResponse.json({ ok: true })
}
