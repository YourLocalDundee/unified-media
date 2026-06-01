import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getTotalCount } from '@/lib/media-server/library'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()

  const counts = getTotalCount()
  return NextResponse.json(counts)
}
