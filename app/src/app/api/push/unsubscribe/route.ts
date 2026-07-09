/**
 * POST /api/push/unsubscribe — removes a stored PushSubscription by endpoint.
 * Scoped to the current user so one account can't delete another's subscription.
 * Idempotent: deleting an already-absent endpoint still returns ok.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getDb } from '@/lib/db/index'

interface UnsubscribeBody {
  endpoint?: unknown
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  let body: UnsubscribeBody
  try {
    body = (await req.json()) as UnsubscribeBody
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const endpoint = body.endpoint
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'endpoint is required' }, { status: 400 })
  }

  getDb()
    .prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .run(endpoint, session.userId)

  return NextResponse.json({ ok: true })
}
