/**
 * GET /api/automation/items  — list all monitored items (admin only)
 * POST /api/automation/items — manually add a new monitored item (admin only)
 *
 * Admin-only; all methods call requireAdmin() which throws a redirect on failure.
 * force-dynamic prevents Next.js from caching this route since the DB changes frequently.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getAllItems, createItem } from '@/lib/automation/monitor'
import { verifyOrigin } from '@/lib/csrf'

// Opt out of static rendering — this route hits the DB on every request
export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const items = getAllItems()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()

  // Accept unknown body shape and validate each field explicitly to avoid trusting client types
  let body: {
    type?: unknown
    title?: unknown
    tmdb_id?: unknown
    tvdb_id?: unknown
    year?: unknown
    quality_profile_id?: unknown
    root_path?: unknown
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard

  if (body.type !== 'movie' && body.type !== 'tv') {
    return NextResponse.json({ error: 'type must be "movie" or "tv"' }, { status: 400 })
  }

  if (typeof body.title !== 'string' || body.title.trim() === '') {
    return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 })
  }

  // Optional numeric fields default to undefined (not null) so createItem's ?? defaults apply
  const item = createItem({
    type: body.type,
    title: body.title.trim(),
    tmdb_id: typeof body.tmdb_id === 'number' ? body.tmdb_id : undefined,
    tvdb_id: typeof body.tvdb_id === 'number' ? body.tvdb_id : undefined,
    year: typeof body.year === 'number' ? body.year : undefined,
    quality_profile_id: typeof body.quality_profile_id === 'number' ? body.quality_profile_id : undefined,
    root_path: typeof body.root_path === 'string' ? body.root_path : undefined,
  })

  return NextResponse.json(item, { status: 201 })
}
