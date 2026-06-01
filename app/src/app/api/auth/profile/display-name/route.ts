import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function PATCH(req: NextRequest) {
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
  db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
    .run(trimmed || null, Date.now(), session.userId)

  return NextResponse.json({ ok: true })
}
