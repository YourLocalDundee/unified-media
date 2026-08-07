/**
 * Import lists item API.
 *
 *   PATCH  — update a list  body: { name?, url?, enabled?, qualityProfileId?, mediaType? }
 *   DELETE — remove a list (and its dedup ledger)
 *
 * requireAdmin + verifyOrigin. Deleting a list does NOT remove items already added to the library.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { updateImportList, deleteImportList, getImportListById } from '@/lib/automation/import-lists'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id) || !getImportListById(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { name?: unknown; url?: unknown; enabled?: unknown; qualityProfileId?: unknown; mediaType?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const patch: Parameters<typeof updateImportList>[1] = {}
  if (typeof body.name === 'string') patch.name = body.name.trim()
  if (typeof body.url === 'string') patch.url = body.url.trim()
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled ? 1 : 0
  if (typeof body.qualityProfileId === 'number') patch.quality_profile_id = body.qualityProfileId
  if (body.mediaType === 'movie' || body.mediaType === 'tv') patch.media_type = body.mediaType

  const list = updateImportList(id, patch)
  return NextResponse.json({ ok: true, list })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const ok = deleteImportList(id)
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 })
}
