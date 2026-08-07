/**
 * Web Push (VAPID) server module.
 *
 * Mirrors the graceful-degradation shape of src/lib/email.ts: when the VAPID
 * env vars are unset the whole feature is a logging no-op — nothing throws, and
 * the app runs exactly as before. Configure via:
 *   VAPID_PUBLIC_KEY   — base64url public key
 *   VAPID_PRIVATE_KEY  — base64url private key
 *   VAPID_SUBJECT      — a `mailto:` (or https) contact URI; defaults to a mailto stub
 *
 * Generate a key pair with:  npx web-push generate-vapid-keys
 *
 * sendPushToUser loads every stored subscription for a user and pushes the
 * payload to each, pruning subscriptions the push service reports as gone
 * (404/410) so dead endpoints don't accumulate.
 */
import 'server-only'
import * as webpush from 'web-push'
import { getDb } from '@/lib/db/index'

export interface PushPayload {
  title: string
  body: string
  /** deep-link path opened when the notification is clicked; defaults to '/' */
  url?: string
}

interface SubscriptionRow {
  id: number
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Reads env fresh (like email.ts) and configures web-push. Returns false when
 * VAPID is not configured — callers treat that as "push disabled, no-op".
 */
function configureVapid(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return false

  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@unified.local'
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    return true
  } catch (err) {
    console.error('[push] Invalid VAPID configuration:', err)
    return false
  }
}

/** True when VAPID keys are present so the client can decide whether to offer the toggle. */
export function isPushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim())
}

/** The public VAPID key the browser needs to subscribe, or null when unconfigured. */
export function getPublicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

/**
 * Push a payload to every subscription belonging to a user. Best-effort: a send
 * failure for one endpoint never rejects, and endpoints the push service reports
 * as gone (404/410) are deleted so they aren't retried forever.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!configureVapid()) {
    // Dev/degraded fallback — no keys set. Mirror email.ts's console fallback.
    console.log(`[push:DEV] VAPID unset — would notify user ${userId}: ${payload.title}`)
    return
  }

  const db = getDb()
  const subs = db
    .prepare('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as SubscriptionRow[]
  if (subs.length === 0) return

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: '/icons/icon-192.png',
    data: { url: payload.url ?? '/' },
  })

  const deleteSub = db.prepare('DELETE FROM push_subscriptions WHERE id = ?')

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        )
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone (unsubscribed / expired) — prune it.
          deleteSub.run(sub.id)
        } else {
          console.error(`[push] send failed for user ${userId} (sub ${sub.id}):`, err)
        }
      }
    }),
  )
}
