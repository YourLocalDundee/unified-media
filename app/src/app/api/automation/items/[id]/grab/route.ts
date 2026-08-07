/**
 * POST /api/automation/items/[id]/grab
 *
 * Triggers an immediate grab attempt for a single monitored item, bypassing the
 * 15-minute cron schedule. Used by the "Grab Now" button on the admin automation page.
 *
 * Returns { result: 'grabbed' | 'not_found' | 'error' } — the same values grabItem() returns.
 * The item does not have to be in 'wanted' status; admin can force-grab any item.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getItemById } from '@/lib/automation/monitor'
import { grabItem } from '@/lib/automation/grabber'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const item = getItemById(id)
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  // grabItem handles its own error catching; result is always one of the three string literals.
  // force: bypass the D3 'wanted'-claim — this is an explicit admin grab that must work on any status.
  const result = await grabItem(item, { force: true })
  return NextResponse.json({ result })
}
