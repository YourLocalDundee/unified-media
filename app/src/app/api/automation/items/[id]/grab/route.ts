import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getItemById } from '@/lib/automation/monitor'
import { grabItem } from '@/lib/automation/grabber'

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

  const item = getItemById(id)
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const result = await grabItem(item)
  return NextResponse.json({ result })
}
