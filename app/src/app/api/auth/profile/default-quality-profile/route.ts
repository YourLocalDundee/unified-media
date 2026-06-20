import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  let body: { profileId?: unknown } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const profileId = body.profileId === null ? null
    : typeof body.profileId === 'number' ? body.profileId
    : undefined

  if (profileId === undefined) {
    return NextResponse.json({ error: 'profileId must be a number or null' }, { status: 400 })
  }

  // Verify the target profile exists and is visible to this user (shared OR owned)
  if (profileId !== null) {
    const row = getDb()
      .prepare('SELECT user_id FROM quality_profiles WHERE id = ?')
      .get(profileId) as { user_id: string | null } | undefined
    if (!row) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    if (row.user_id !== null && row.user_id !== session.userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  getDb()
    .prepare('UPDATE users SET default_quality_profile_id = ? WHERE id = ?')
    .run(profileId, session.userId)

  return NextResponse.json({ defaultProfileId: profileId })
}
