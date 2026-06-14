/**
 * PATCH /api/auth/profile/display-name — updates the authenticated user's
 * display_name field (max 64 chars). An empty string after trim is stored as
 * NULL so the UI can fall back to the username for display.
 *
 * Display names are not unique — two users can share a display name. Only
 * username uniqueness is enforced at the DB level.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getDb } from '@/lib/db/index'

export async function PATCH(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  let body: { displayName?: unknown }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const displayName = body.displayName
  if (typeof displayName !== 'string') {
    return NextResponse.json({ error: 'displayName must be a string' }, { status: 400 })
  }
  const trimmed = displayName.trim()
  if (trimmed.length > 64) {
    return NextResponse.json({ error: 'Display name must be 64 characters or fewer' }, { status: 400 })
  }

  const db = getDb()
  // Store null (not empty string) when display name is cleared so the UI's
  // `display_name ?? username` fallback logic works without string length checks.
  db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
    .run(trimmed || null, Date.now(), session.userId)

  return NextResponse.json({ ok: true })
}
