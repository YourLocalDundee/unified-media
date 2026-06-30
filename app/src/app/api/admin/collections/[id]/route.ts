/**
 * Movie Collections item API.
 *
 *   PATCH  — update a collection  body: { enabled?, quality_profile_id? }
 *   DELETE — remove a collection (and its dedup ledger via CASCADE)
 *
 * requireAdmin + verifyOrigin. Deleting a collection does NOT remove films already added to the library.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getCollectionById, updateCollection, deleteCollection } from '@/lib/automation/collections'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id) || !getCollectionById(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { enabled?: unknown; quality_profile_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const patch: Parameters<typeof updateCollection>[1] = {}
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled ? 1 : 0
  if (typeof body.quality_profile_id === 'number') patch.quality_profile_id = body.quality_profile_id

  const collection = updateCollection(id, patch)
  return NextResponse.json({ ok: true, collection })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const ok = deleteCollection(id)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
}
