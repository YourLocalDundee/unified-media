import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { scanAll } from '@/lib/media-server/scanner'
import { enrichAll } from '@/lib/media-server/enricher'

export const dynamic = 'force-dynamic'

export async function POST() {
  await requireAdmin()

  const { scanned } = await scanAll()
  const { enriched, failed } = await enrichAll()

  return NextResponse.json({ scanned, enriched, failed })
}
