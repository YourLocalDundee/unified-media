/**
 * PATCH /api/auth/profile/demographics — updates the optional about-me fields
 * (first_name, last_name, bio, location) for the authenticated user.
 *
 * All fields are optional in the request — passing only `bio` updates only bio.
 * Empty strings after trim are stored as NULL so the UI can display nothing
 * rather than an empty string when a field has been cleared.
 *
 * These fields are also collected at registration (Step 1) and editable here,
 * keeping both paths in sync. The DB columns allow NULL for all four.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, logEvent } from '@/lib/dal'
import { getDb } from '@/lib/db/index'

export async function PATCH(req: NextRequest) {
  const session = await requireAuth()
  let body: { firstName?: string; lastName?: string; bio?: string; location?: string }
  try { body = await req.json() as typeof body }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const { firstName, lastName, bio, location } = body

  if (bio && bio.length > 256) return NextResponse.json({ error: 'Bio must be 256 characters or less.' }, { status: 400 })
  if (firstName && firstName.length > 64) return NextResponse.json({ error: 'First name must be 64 characters or less.' }, { status: 400 })
  if (lastName && lastName.length > 64) return NextResponse.json({ error: 'Last name must be 64 characters or less.' }, { status: 400 })
  if (location && location.length > 128) return NextResponse.json({ error: 'Location must be 128 characters or less.' }, { status: 400 })

  // All four columns are written every time — the route owns the full set of
  // demographic fields so partial updates don't silently preserve stale values.
  getDb().prepare(
    `UPDATE users SET first_name = ?, last_name = ?, bio = ?, location = ?, updated_at = ? WHERE id = ?`
  ).run(
    firstName?.trim() || null,
    lastName?.trim() || null,
    bio?.trim() || null,
    location?.trim() || null,
    Date.now(),
    session.userId
  )

  await logEvent('profile_updated', { fields: ['first_name', 'last_name', 'bio', 'location'] }, { userId: session.userId, username: session.username })
  return NextResponse.json({ ok: true })
}
