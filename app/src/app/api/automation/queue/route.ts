/**
 * GET /api/automation/queue
 *
 * Returns the grab history (most recent 100 entries) from the grab_history table.
 * Named "queue" for historical reasons — it functions as an audit log of what was sent
 * to the download client, not a live queue of active torrents (that's qBittorrent's domain).
 *
 * Used by the admin automation page's "Recent Grabs" table.
 * Per-item history (unbounded) is not exposed through this route — see getGrabHistory(itemId).
 */

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getGrabHistory } from '@/lib/automation/monitor'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const history = getGrabHistory()  // no itemId arg = global history, capped at 100 rows
  return NextResponse.json(history)
}
