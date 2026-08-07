/**
 * POST /api/push/subscribe — stores a browser PushSubscription for the current
 * user so the server can send them Web Push notifications. The body is the JSON
 * form of a PushSubscription (endpoint + keys.p256dh + keys.auth).
 *
 * endpoint is UNIQUE: re-subscribing from the same browser (or after a key
 * refresh) upserts the row and re-points it at the current user rather than
 * duplicating.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getDb } from '@/lib/db/index'

interface SubscriptionBody {
  endpoint?: unknown
  keys?: { p256dh?: unknown; auth?: unknown }
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  let body: SubscriptionBody
  try {
    body = (await req.json()) as SubscriptionBody
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const endpoint = body.endpoint
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string' ||
      !endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'Malformed subscription' }, { status: 400 })
  }

  const db = getDb()
  // Upsert on the unique endpoint: a browser that re-subscribes (or a subscription
  // that moves to a different account on a shared device) updates in place.
  db.prepare(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh  = excluded.p256dh,
       auth    = excluded.auth`,
  ).run(session.userId, endpoint, p256dh, auth, Date.now())

  return NextResponse.json({ ok: true })
}
