import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { getProfileFull } from '@/lib/automation/quality'
import type { CustomFormatSpec } from '@/lib/automation/quality'
import { verifyOrigin } from '@/lib/csrf'

// Shared (user_id IS NULL) profiles require admin; user-owned profiles only require ownership.
async function authoriseProfileEdit(profileId: number) {
  const row = getDb()
    .prepare('SELECT user_id FROM quality_profiles WHERE id = ?')
    .get(profileId) as { user_id: string | null } | undefined
  if (!row) return { ok: false, status: 404, error: 'Not found' } as const
  if (row.user_id === null) {
    // Shared profile — admin only
    try { await requireAdmin() } catch { return { ok: false, status: 403, error: 'Admin required for shared profiles' } as const }
  } else {
    // User-owned — just needs a valid session and ownership
    const session = await requireAuth().catch(() => null)
    if (!session) return { ok: false, status: 401, error: 'Unauthorised' } as const
    if (session.userId !== row.user_id && session.role !== 'admin') {
      return { ok: false, status: 403, error: 'Forbidden' } as const
    }
  }
  return { ok: true } as const
}

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
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const profileId = parseInt(id, 10)
  const auth = await authoriseProfileEdit(profileId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  let body: {
    name?: string
    upgrade_allowed?: boolean
    cutoff_quality_id?: number | null
    min_format_score?: number
    cutoff_format_score?: number
    language?: string
    formats?: Array<{ format_id: number; score: number }>
    new_format?: { name: string; specs: CustomFormatSpec[] }
    conditions?: Array<{ type: string; value: string; required: boolean; negate?: boolean }>
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard

  const db = getDb()

  if (body.name !== undefined || body.upgrade_allowed !== undefined ||
      body.cutoff_quality_id !== undefined || body.min_format_score !== undefined ||
      body.cutoff_format_score !== undefined || body.language !== undefined ||
      body.conditions !== undefined) {
    const fields: string[] = []
    const vals: unknown[] = []
    if (body.name !== undefined)              { fields.push('name = ?');               vals.push(body.name.trim()) }
    if (body.upgrade_allowed !== undefined)   { fields.push('upgrade_allowed = ?');    vals.push(body.upgrade_allowed ? 1 : 0) }
    if (body.cutoff_quality_id !== undefined) { fields.push('cutoff_quality_id = ?'); vals.push(body.cutoff_quality_id) }
    if (body.min_format_score !== undefined)  { fields.push('min_format_score = ?');  vals.push(body.min_format_score) }
    if (body.cutoff_format_score !== undefined) { fields.push('cutoff_format_score = ?'); vals.push(body.cutoff_format_score) }
    if (body.language !== undefined)          { fields.push('language = ?');          vals.push(body.language.trim() || 'any') }
    if (body.conditions !== undefined)        { fields.push('conditions = ?');        vals.push(JSON.stringify(body.conditions)) }
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
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const profileId = parseInt(id, 10)
  const auth = await authoriseProfileEdit(profileId)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const db = getDb()
  db.prepare('DELETE FROM quality_profile_formats WHERE profile_id = ?').run(profileId)
  db.prepare('DELETE FROM quality_profiles WHERE id = ?').run(profileId)
  return new NextResponse(null, { status: 204 })
}
