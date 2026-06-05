import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { getAllProfiles, getAllTiers, getAllCustomFormats } from '@/lib/automation/quality'

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
  await requireAdmin()
  const body = await req.json() as {
    name?: string
    upgrade_allowed?: boolean
    cutoff_quality_id?: number | null
    min_format_score?: number
    cutoff_format_score?: number
  }

  const { name, upgrade_allowed = true, cutoff_quality_id = null, min_format_score = 0, cutoff_format_score = 0 } = body
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })

  const db = getDb()
  const result = db.prepare(`
    INSERT INTO quality_profiles (name, conditions, upgrade_allowed, cutoff_quality_id, min_format_score, cutoff_format_score)
    VALUES (?, '[]', ?, ?, ?, ?)
  `).run(name.trim(), upgrade_allowed ? 1 : 0, cutoff_quality_id, min_format_score, cutoff_format_score)

  return NextResponse.json({ id: result.lastInsertRowid }, { status: 201 })
}
