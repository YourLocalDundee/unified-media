import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { getProfileFull } from '@/lib/automation/quality'
import type { CustomFormatSpec } from '@/lib/automation/quality'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()
  const { id } = await params
  const profile = getProfileFull(parseInt(id, 10))
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(profile)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  const { id } = await params
  const profileId = parseInt(id, 10)
  let body: {
    name?: string
    upgrade_allowed?: boolean
    cutoff_quality_id?: number | null
    min_format_score?: number
    cutoff_format_score?: number
    language?: string
    formats?: Array<{ format_id: number; score: number }>
    new_format?: { name: string; specs: CustomFormatSpec[] }
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard

  const db = getDb()

  if (body.name !== undefined || body.upgrade_allowed !== undefined ||
      body.cutoff_quality_id !== undefined || body.min_format_score !== undefined ||
      body.cutoff_format_score !== undefined || body.language !== undefined) {
    const fields: string[] = []
    const vals: unknown[] = []
    if (body.name !== undefined)              { fields.push('name = ?');               vals.push(body.name.trim()) }
    if (body.upgrade_allowed !== undefined)   { fields.push('upgrade_allowed = ?');    vals.push(body.upgrade_allowed ? 1 : 0) }
    if (body.cutoff_quality_id !== undefined) { fields.push('cutoff_quality_id = ?'); vals.push(body.cutoff_quality_id) }
    if (body.min_format_score !== undefined)  { fields.push('min_format_score = ?');  vals.push(body.min_format_score) }
    if (body.cutoff_format_score !== undefined) { fields.push('cutoff_format_score = ?'); vals.push(body.cutoff_format_score) }
    if (body.language !== undefined)          { fields.push('language = ?');          vals.push(body.language.trim() || 'any') }
    if (fields.length > 0) {
      db.prepare(`UPDATE quality_profiles SET ${fields.join(', ')} WHERE id = ?`).run(...vals, profileId)
    }
  }

  // Create a new custom format and attach it to this profile
  if (body.new_format) {
    const { name, specs } = body.new_format
    const existing = db.prepare('SELECT id FROM custom_formats WHERE name = ?').get(name) as { id: number } | undefined
    let formatId: number
    if (existing) {
      formatId = existing.id
    } else {
      const r = db.prepare('INSERT INTO custom_formats (name, specs) VALUES (?, ?)').run(name, JSON.stringify(specs))
      formatId = r.lastInsertRowid as number
    }
    db.prepare('INSERT OR IGNORE INTO quality_profile_formats (profile_id, format_id, score) VALUES (?, ?, 0)').run(profileId, formatId)
  }

  // Update format scores (replace all for this profile)
  if (body.formats !== undefined) {
    db.prepare('DELETE FROM quality_profile_formats WHERE profile_id = ?').run(profileId)
    for (const f of body.formats) {
      db.prepare('INSERT INTO quality_profile_formats (profile_id, format_id, score) VALUES (?, ?, ?)').run(profileId, f.format_id, f.score)
    }
  }

  return NextResponse.json(getProfileFull(profileId))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  const { id } = await params
  const profileId = parseInt(id, 10)
  const db = getDb()
  db.prepare('DELETE FROM quality_profile_formats WHERE profile_id = ?').run(profileId)
  db.prepare('DELETE FROM quality_profiles WHERE id = ?').run(profileId)
  return new NextResponse(null, { status: 204 })
}
