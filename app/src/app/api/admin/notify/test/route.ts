// POST /api/admin/notify/test
// Sends a sample availability notification to every configured channel (ignoring the
// notify_on_available master toggle) so an admin can verify Discord/ntfy config. Returns
// per-channel results. requireAdmin + verifyOrigin.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { sendTestNotification } from '@/lib/notify/index'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  const results = await sendTestNotification()
  if (results.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'No notification channels configured. Set a Discord webhook or ntfy URL first.' },
      { status: 400 },
    )
  }
  const allOk = results.every((r) => r.ok)
  return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 502 })
}
