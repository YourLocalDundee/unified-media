// DELETE /api/admin/invites/[code]
// Hard-deletes the invite code row, preventing any future registrations with it.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await requireAdmin()
  const { code } = await params
  // Normalize to uppercase in case the URL carries a mixed-case code (e.g. from copy-paste).
  getDb().prepare('DELETE FROM invite_codes WHERE code = ?').run(code.toUpperCase())
  await logEvent('invite_revoked', { code }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
