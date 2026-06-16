import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { scanAll } from '@/lib/media-server/scanner'
import { enrichAll } from '@/lib/media-server/enricher'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()

  const { scanned } = await scanAll()
  const { enriched, failed } = await enrichAll()

  return NextResponse.json({ scanned, enriched, failed })
}
