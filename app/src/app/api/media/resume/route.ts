import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getResumeItems } from '@/lib/media-server/library'
import type { MediaItem } from '@/lib/media-server/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse<MediaItem[]>> {
  const session = await requireAuth()

  const { searchParams } = req.nextUrl
  const limit = Math.min(Number(searchParams.get('limit') ?? '12'), 50)

  const items = getResumeItems(session.userId, limit)

  return NextResponse.json(items)
}
