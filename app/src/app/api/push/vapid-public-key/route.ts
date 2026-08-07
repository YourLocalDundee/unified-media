/**
 * GET /api/push/vapid-public-key — returns the server's public VAPID key so the
 * browser can create a PushSubscription. The public key is not a secret, but the
 * route is auth-gated for consistency (only signed-in users subscribe). Returns
 * { key: null } when VAPID is unconfigured so the client can hide the toggle
 * instead of erroring.
 */
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getPublicVapidKey } from '@/lib/push'

export async function GET() {
  await requireAuth()
  return NextResponse.json({ key: getPublicVapidKey() })
}
