import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getAvailableFilters } from '@/lib/media-server/library'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAuth()
  const type = req.nextUrl.searchParams.get('type') ?? undefined
  const filters = getAvailableFilters(type)
  return NextResponse.json(filters)
}
