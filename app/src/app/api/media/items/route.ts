import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { searchItems, getItemsByType, getRecentlyAdded } from '@/lib/media-server/library'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAuth()

  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? ''
  const type = searchParams.get('type') ?? ''
  const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 200)
  const offset = Number(searchParams.get('offset') ?? '0')

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
