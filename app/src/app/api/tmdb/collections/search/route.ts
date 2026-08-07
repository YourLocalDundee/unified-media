/**
 * GET /api/tmdb/collections/search?q=<query>
 * Proxies TMDB /search/collection. Requires auth (any user). Returns the matching collection list.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { searchCollections } from '@/lib/media-server/tmdb'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAuth()
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (!q) return NextResponse.json([])
  const results = await searchCollections(q)
  return NextResponse.json(results)
}
