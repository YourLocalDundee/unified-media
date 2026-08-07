import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { searchItems, getItemsByType, getRecentlyAdded } from '@/lib/media-server/library'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAuth()

  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const type = searchParams.get('type') ?? ''
  // Clamp both so NaN/negative params can't reach LIMIT/OFFSET and 500 (A3-14).
  const rawLimit = Number(searchParams.get('limit') ?? '50')
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 200) : 50
  const rawOffset = Number(searchParams.get('offset') ?? '0')
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0

  if (q.trim()) {
    const items = searchItems(q.trim(), limit)
    return NextResponse.json(items)
  }

  if (type) {
    const items = getItemsByType(type, limit, offset)
    return NextResponse.json(items)
  }

  const items = getRecentlyAdded(limit)
  return NextResponse.json(items)
}
