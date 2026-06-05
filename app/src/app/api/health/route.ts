/**
 * GET /api/health — liveness and dependency check endpoint.
 * Returns 200 when both the SQLite DB and the primary media root are reachable,
 * 503 otherwise. Docker and uptime monitors can poll this to detect degraded
 * state without relying on a full page load.
 *
 * Response shape: { status: 'ok' | 'degraded', db: bool, media: bool, timestamp: string }
 */
import { access, constants } from 'fs/promises'
import { getDb } from '@/lib/db/index'

// Never cache — health checks must reflect real-time state
export const dynamic = 'force-dynamic'

export async function GET() {
  let db = false
  let media = false

  try {
    getDb().prepare('SELECT 1').get()
    db = true
  } catch { /* db unreachable */ }

  // MEDIA_ROOTS is colon-separated; we only probe the first path here
  const mediaRoot = (process.env.MEDIA_ROOTS ?? '').split(':').filter(Boolean)[0]
  if (mediaRoot) {
    try {
      await access(mediaRoot, constants.R_OK)
      media = true
    } catch { /* media dir unreachable */ }
  }

  // If MEDIA_ROOTS is not configured, skip the check and consider media healthy
  const status = db && (media || !mediaRoot) ? 'ok' : 'degraded'
  return Response.json(
    { status, db, media, timestamp: new Date().toISOString() },
    { status: status === 'ok' ? 200 : 503 }
  )
}
