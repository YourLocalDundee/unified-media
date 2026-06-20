import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { scanAll } from '@/lib/media-server/scanner'
import { enrichAll } from '@/lib/media-server/enricher'
import { verifyOrigin } from '@/lib/csrf'
import { enqueue } from '@/lib/jobs/queue'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()

  const job = enqueue('media-scan', async () => {
    const { scanned } = await scanAll()
    const { enriched, failed } = await enrichAll()
    return { scanned, enriched, failed }
  })

  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 })
}
