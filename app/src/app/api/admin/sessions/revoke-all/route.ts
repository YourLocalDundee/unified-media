/**
 * POST /api/admin/sessions/revoke-all — admin bulk session revoke (CLAUDE.md §13).
 *
 * Deletes every session in the DB EXCEPT the acting admin's current one, so a forced logout of all
 * users (e.g. after a suspected compromise or a mass password reset) does not also lock the admin out.
 * requireAdmin + verifyOrigin. Returns the number of sessions revoked.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getDb } from '@/lib/db/index'
import { logEvent } from '@/lib/dal'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admin = await requireAdmin()

  const db = getDb()
  const result = db.prepare('DELETE FROM sessions WHERE id != ?').run(admin.sessionId)
  const revoked = result.changes

  await logEvent('admin_revoke_all_sessions', { revoked }, { userId: admin.userId })
  return NextResponse.json({ ok: true, revoked })
}
