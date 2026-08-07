/**
 * POST /api/admin/collections/[id]/sync — manually sync one collection now (the daily cron does
 * this automatically). Returns { added } or a per-collection error. requireAdmin + verifyOrigin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getCollectionById, syncCollection } from '@/lib/automation/collections'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  const collection = Number.isFinite(id) ? getCollectionById(id) : undefined
  if (!collection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = await syncCollection(collection)
  if (result.error) return NextResponse.json({ ok: false, ...result }, { status: 502 })
  return NextResponse.json({ ok: true, ...result })
}
