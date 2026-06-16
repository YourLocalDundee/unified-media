/**
 * POST /api/automation/sync
 *
 * Manually triggers the availability check outside the 30-minute cron schedule.
 * Used by the "Check Availability Now" button on the admin bridge page.
 *
 * Returns { updated: number } — the count of items that transitioned to 'imported'.
 * Errors are caught and returned as { error: string } with a 500 status rather than
 * letting Next.js produce an unstructured error response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { checkAvailability } from '@/lib/automation/availability'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  try {
    const updated = await checkAvailability()
    return NextResponse.json({ updated })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
