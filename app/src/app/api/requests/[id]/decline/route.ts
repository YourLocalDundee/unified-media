import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getRequestById, updateRequestStatus } from '@/lib/requests/monitor'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()
  const { id: idStr } = await params

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const request = getRequestById(id)
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  updateRequestStatus(id, 'declined')

  const updated = getRequestById(id)
  return NextResponse.json(updated)
}
