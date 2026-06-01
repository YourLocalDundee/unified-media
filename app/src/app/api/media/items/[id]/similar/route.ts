import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getSimilarItems } from '@/lib/media-server/library'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()
  const { id } = await params
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10)
  const items = getSimilarItems(id, limit)
  return NextResponse.json(items)
}
