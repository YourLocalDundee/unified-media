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
  // Clamp so ?limit=abc (NaN) or a negative/huge value can't reach LIMIT and throw
  // a 500 from better-sqlite3 (A3-14).
  const rawLimit = parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(1, rawLimit), 100) : 10
  const items = getSimilarItems(id, limit)
  return NextResponse.json(items)
}
