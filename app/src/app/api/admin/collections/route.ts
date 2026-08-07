/**
 * Movie Collections admin API.
 *
 *   GET  — list all monitored TMDB collections
 *   POST — add a new collection  body: { tmdb_collection_id, name, quality_profile_id? }
 *
 * requireAdmin + verifyOrigin on POST. Collection items are always long-term monitored movies —
 * never auto-deleted.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getAllCollections, createCollection } from '@/lib/automation/collections'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  return NextResponse.json({ collections: getAllCollections() })
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  let body: { tmdb_collection_id?: unknown; name?: unknown; quality_profile_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const tmdbCollectionId =
    typeof body.tmdb_collection_id === 'number' && Number.isFinite(body.tmdb_collection_id)
      ? body.tmdb_collection_id
      : null
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const qualityProfileId =
    typeof body.quality_profile_id === 'number' ? body.quality_profile_id : 1

  if (!tmdbCollectionId || !name) {
    return NextResponse.json(
      { error: 'tmdb_collection_id (number) and name (string) are required' },
      { status: 400 },
    )
  }

  try {
    const collection = createCollection({
      tmdb_collection_id: tmdbCollectionId,
      name,
      quality_profile_id: qualityProfileId,
    })
    return NextResponse.json({ ok: true, collection }, { status: 201 })
  } catch (err) {
    // UNIQUE constraint on tmdb_collection_id — already monitored
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Collection is already being monitored' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create collection' }, { status: 500 })
  }
}
