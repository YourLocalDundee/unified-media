/**
 * POST /api/automation/import-lists/[id]/sync — manually sync one import list now (the 6h cron
 * does this automatically). Returns { added, seen } or a per-list error. requireAdmin + verifyOrigin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getImportListById, syncImportList } from '@/lib/automation/import-lists'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  const list = Number.isFinite(id) ? getImportListById(id) : undefined
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = await syncImportList(list)
  // A source/config failure is reported as 502 with the message so the admin can fix it.
  if (result.error) return NextResponse.json({ ok: false, ...result }, { status: 502 })
  return NextResponse.json({ ok: true, ...result })
}
