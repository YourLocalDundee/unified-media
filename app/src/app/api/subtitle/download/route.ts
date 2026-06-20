import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { downloadPendingSubtitles } from '@/lib/subtitle/downloader'
import { verifyOrigin } from '@/lib/csrf'
import { enqueue } from '@/lib/jobs/queue'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()

  const job = enqueue('subtitle-download', () => downloadPendingSubtitles())
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 })
}
