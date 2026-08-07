import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { resetSkippedToWanted } from '@/lib/subtitle/monitor'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

// Manual trigger for the same reset the weekly cron does (scheduler.ts) — lets an admin
// force a re-check instead of waiting for Sunday. Only resets status; the next
// "Download Pending" run (or the 3:30 AM cron) does the actual re-search.
export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  const reset = resetSkippedToWanted()
  return NextResponse.json({ reset })
}
