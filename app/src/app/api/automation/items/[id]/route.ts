/**
 * GET    /api/automation/items/[id]  — fetch a single monitored item
 * PATCH  /api/automation/items/[id]  — update fields on a monitored item
 * DELETE /api/automation/items/[id]  — remove from monitoring (does not delete grab history)
 *
 * Admin-only. The PATCH body passes through to monitor.updateItem which has its own
 * allowlist-based SQL injection guard — no need to re-validate field names here.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getItemById, updateItem, deleteItem } from '@/lib/automation/monitor'
import type { ItemStatus } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()

  // params is a Promise in Next.js 15 App Router — must be awaited before reading
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const item = getItemById(id)
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  return NextResponse.json(item)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  // Pre-check existence to return 404 before attempting a no-op update
  const existing = getItemById(id)
  if (!existing) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  // Body is typed loosely here — updateItem's ITEM_ALLOWED_FIELDS set is the real safety net
  const body = await req.json() as Partial<{
    title: string
    tmdb_id: number | null
    tvdb_id: number | null
    year: number | null
    quality_profile_id: number
    root_path: string
    monitored: number
    status: ItemStatus
  }>

  const updated = updateItem(id, body)
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const deleted = deleteItem(id)
  if (!deleted) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  // 204 No Content — standard REST response for a successful DELETE with no body
  return new NextResponse(null, { status: 204 })
}
