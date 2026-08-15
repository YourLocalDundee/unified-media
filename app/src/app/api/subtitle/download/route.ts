import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { downloadPendingSubtitles } from '@/lib/subtitle/downloader'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { enqueue } from '@/lib/jobs/queue'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  const session = await requireAdmin()

  // Admin-gated, but this is the one admin route that spends a finite EXTERNAL resource: each
  // run works through every wanted subtitle against OpenSubtitles, which has a hard daily quota
  // (1000/day on the VIP tier). A retry loop in the UI would burn the day's allowance as
  // effectively as an attacker, so the ceiling is here to protect the quota, not the server.
  const rl = checkRateLimit(`subtitle-download:${session.userId}`, 10, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl, 'Too many subtitle download runs. Try again later.')

  const job = enqueue('subtitle-download', () => downloadPendingSubtitles())
  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 })
}
