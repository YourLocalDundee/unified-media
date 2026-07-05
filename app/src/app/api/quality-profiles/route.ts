import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { getAllProfiles, getAllTiers, getAllCustomFormats } from '@/lib/automation/quality'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json({
    profiles: getAllProfiles(),
    tiers: getAllTiers(),
    formats: getAllCustomFormats(),
  })
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  let body: {
    name?: string
    upgrade_allowed?: boolean
    cutoff_quality_id?: number | null
    min_format_score?: number
    cutoff_format_score?: number
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard

  // Default off (2026-07): upgrade-until-cutoff re-grabbing is opt-in, not opt-out, for new profiles.
  const { name, upgrade_allowed = false, cutoff_quality_id = null, min_format_score = 0, cutoff_format_score = 0 } = body
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const db = getDb()
  const result = db.prepare(`
    INSERT INTO quality_profiles (name, conditions, upgrade_allowed, cutoff_quality_id, min_format_score, cutoff_format_score)
    VALUES (?, '[]', ?, ?, ?, ?)
  `).run(name.trim(), upgrade_allowed ? 1 : 0, cutoff_quality_id, min_format_score, cutoff_format_score)

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}
