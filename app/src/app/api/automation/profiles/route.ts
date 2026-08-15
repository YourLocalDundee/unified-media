/**
 * GET /api/automation/profiles — shared + caller's own profiles + caller's default profile ID
 * POST /api/automation/profiles — create a new user-owned quality profile
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { getAllProfiles } from '@/lib/automation/quality'
import { getDb } from '@/lib/db/index'
import type { QualityCondition } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await requireAuth()
  const profiles = getAllProfiles(session.userId)
  const userRow = getDb()
    .prepare('SELECT default_quality_profile_id FROM users WHERE id = ?')
    .get(session.userId) as { default_quality_profile_id: number | null } | undefined
  return NextResponse.json({
    profiles,
    defaultProfileId: userRow?.default_quality_profile_id ?? null,
  })
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  // requireAuth is correct here and must stay: profiles are user-owned by design (GET returns
  // shared profiles plus the caller's own, and getAllProfiles() filters on user_id). What was
  // missing is a ceiling on how many a single user can create.
  const rl = checkRateLimit(`create-profile:${session.userId}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) return rateLimitResponse(rl, 'Too many quality profiles created. Try again later.')

  let body: { name?: unknown; conditions?: unknown } = {}
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  if (typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const name = body.name.trim()
  const conditions: QualityCondition[] = Array.isArray(body.conditions)
    ? (body.conditions as QualityCondition[]).filter(
        c => typeof c.type === 'string' && typeof c.value === 'string'
      )
    : []

  const db = getDb()
  const r = db.prepare(
    `INSERT INTO quality_profiles (name, conditions, user_id, upgrade_allowed, min_format_score, cutoff_format_score)
     VALUES (?, ?, ?, 1, 0, 0)`
  ).run(name, JSON.stringify(conditions), session.userId)

  const created = db.prepare('SELECT * FROM quality_profiles WHERE id = ?').get(r.lastInsertRowid) as Record<string, unknown>
  return NextResponse.json(created, { status: 201 })
}
