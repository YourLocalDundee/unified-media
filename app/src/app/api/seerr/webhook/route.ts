/**
 * Seerr webhook receiver — POST /api/seerr/webhook
 *
 * Seerr pushes events here when a request is approved or media becomes available.
 * This is a server-to-server endpoint; no session auth is required or performed.
 *
 * Configure in Seerr → Settings → Notifications → Webhook:
 *   URL: https://unified.minijoe.dev/api/seerr/webhook
 *   Events: Request Approved, Media Available
 *   Secret: value of SEERR_WEBHOOK_SECRET env var (optional but recommended)
 *
 * Signature verification: HMAC-SHA256 of the raw request body, hex-encoded,
 * compared against the X-Webhook-Signature header sent by Seerr.
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/index'
import { findItemForRequest, extractTitle } from '@/lib/automation/bridge'
import { createItem } from '@/lib/automation/monitor'
import { grabItem } from '@/lib/automation/grabber'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// Seerr payload shape
// ---------------------------------------------------------------------------

interface SeerrMediaPayload {
  media_type: 'movie' | 'tv'
  tmdbId: number
  status: 'AVAILABLE' | 'PROCESSING' | 'PENDING'
}

interface SeerrRequestPayload {
  request_id: number
  requestedBy_username: string
}

interface SeerrWebhookBody {
  notification_type:
    | 'MEDIA_APPROVED'
    | 'MEDIA_AVAILABLE'
    | 'REQUEST_PENDING'
    | 'REQUEST_APPROVED'
    | 'REQUEST_DECLINED'
    | string
  subject: string
  media?: SeerrMediaPayload
  request?: SeerrRequestPayload
}

// ---------------------------------------------------------------------------
// HMAC signature verification
// ---------------------------------------------------------------------------

function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex')
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    // Buffer lengths differ — definitely not equal
    return false
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read raw body as text first — required for HMAC verification before JSON parse
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch (err) {
    console.log('[seerr-webhook] Failed to read request body:', err)
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 })
  }

  // Signature verification — fail closed. Without a configured secret this endpoint
  // queues grabs (MEDIA_APPROVED/REQUEST_APPROVED -> arbitrary tmdbId) for any POST,
  // which is an unauthenticated action surface on a publicly-routable host. If no
  // secret is set the webhook is treated as disabled and every POST is rejected.
  const secret = process.env.SEERR_WEBHOOK_SECRET
  if (!secret) {
    console.log('[seerr-webhook] SEERR_WEBHOOK_SECRET is not set — webhook disabled, rejecting request')
    return NextResponse.json(
      { error: 'Webhook not configured' },
      { status: 403 },
    )
  }
  const signature = req.headers.get('x-webhook-signature') ?? ''
  if (!verifySignature(rawBody, signature, secret)) {
    console.log('[seerr-webhook] Signature mismatch — rejecting request')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Parse JSON payload
  let body: SeerrWebhookBody
  try {
    body = JSON.parse(rawBody) as SeerrWebhookBody
  } catch (err) {
    console.log('[seerr-webhook] Failed to parse JSON body:', err)
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { notification_type, subject, media, request } = body

  console.log(
    `[seerr-webhook] Received event: ${notification_type} — subject: "${subject}"`,
    request ? `requestId=${request.request_id} user=${request.requestedBy_username}` : '',
    media ? `tmdbId=${media.tmdbId} type=${media.media_type} status=${media.status}` : '',
  )

  try {
    // ------------------------------------------------------------------
    // MEDIA_APPROVED / REQUEST_APPROVED — queue grab via automation pipeline
    // ------------------------------------------------------------------
    if (notification_type === 'MEDIA_APPROVED' || notification_type === 'REQUEST_APPROVED') {
      if (!media) {
        console.log(`[seerr-webhook] ${notification_type} missing media payload — ignoring`)
        return NextResponse.json({ ok: true, action: 'ignored' })
      }

      const tmdbId = media.tmdbId
      const mediaType = media.media_type

      // Idempotency check — skip if already in monitored_items
      const existing = findItemForRequest(tmdbId, mediaType)
      if (existing) {
        console.log(
          `[seerr-webhook] Item already monitored (id=${existing.id} title="${existing.title}") — skipping duplicate`,
        )
        return NextResponse.json({ ok: true, action: 'queued' })
      }

      // Resolve title from TMDB (falls back to 'Unknown' on outage)
      const title = await extractTitle(tmdbId, mediaType)
      console.log(`[seerr-webhook] Resolved title: "${title}" for tmdbId=${tmdbId} type=${mediaType}`)

      // Add to monitored_items so the 15-minute cron will pick it up
      const item = createItem({
        type: mediaType,
        title,
        tmdb_id: tmdbId,
      })
      console.log(`[seerr-webhook] Created monitored item id=${item.id} "${item.title}"`)

      // Fire an immediate grab attempt without blocking the webhook response
      void Promise.resolve().then(() =>
        grabItem(item).then((result) => {
          console.log(`[seerr-webhook] Immediate grab result for "${item.title}": ${result}`)
        }),
      )

      return NextResponse.json({ ok: true, action: 'queued' })
    }

    // ------------------------------------------------------------------
    // MEDIA_AVAILABLE — update matching media_requests rows to 'available'
    // ------------------------------------------------------------------
    if (notification_type === 'MEDIA_AVAILABLE') {
      if (!media) {
        console.log('[seerr-webhook] MEDIA_AVAILABLE missing media payload — ignoring')
        return NextResponse.json({ ok: true, action: 'ignored' })
      }

      const tmdbId = media.tmdbId
      const mediaType = media.media_type

      const db = getDb()
      const result = db
        .prepare(
          `UPDATE media_requests
              SET status = 'available', updated_at = ?
            WHERE tmdb_id = ?
              AND media_type = ?
              AND status != 'available'`,
        )
        .run(Date.now(), tmdbId, mediaType)

      console.log(
        `[seerr-webhook] MEDIA_AVAILABLE: updated ${result.changes} media_requests row(s) to available`,
        `(tmdbId=${tmdbId} type=${mediaType})`,
      )

      return NextResponse.json({ ok: true, action: 'status_updated' })
    }

    // ------------------------------------------------------------------
    // All other event types — acknowledge and ignore
    // ------------------------------------------------------------------
    console.log(`[seerr-webhook] Ignoring unhandled event type: ${notification_type}`)
    return NextResponse.json({ ok: true, action: 'ignored' })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[seerr-webhook] Unhandled error processing ${notification_type}:`, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
