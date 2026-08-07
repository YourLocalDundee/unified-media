/**
 * Import lists admin API (mining Tier-3 #10).
 *
 *   GET  — list all configured import lists
 *   POST — create one  body: { name, listType: 'trakt'|'rss', url, qualityProfileId?, mediaType? }
 *
 * requireAdmin (+ verifyOrigin on POST). Import-list adds are always long-term monitored items, so
 * they are never auto-deleted (see lib/automation/import-lists.ts).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getAllImportLists, createImportList } from '@/lib/automation/import-lists'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json({ lists: getAllImportLists() })
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  let body: { name?: unknown; listType?: unknown; url?: unknown; qualityProfileId?: unknown; mediaType?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const listType = body.listType === 'trakt' || body.listType === 'rss' ? body.listType : null
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const mediaType = body.mediaType === 'tv' ? 'tv' : 'movie'
  const qualityProfileId = typeof body.qualityProfileId === 'number' ? body.qualityProfileId : 1

  if (!name || !listType || !url) {
    return NextResponse.json({ error: 'name, listType (trakt|rss), and url are required' }, { status: 400 })
  }
  // URL must be http(s) — these are fetched server-side.
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol')
  } catch {
    return NextResponse.json({ error: 'url must be a valid http(s) URL' }, { status: 400 })
  }

  const list = createImportList({ name, list_type: listType, url, quality_profile_id: qualityProfileId, media_type: mediaType })
  return NextResponse.json({ ok: true, list }, { status: 201 })
}
