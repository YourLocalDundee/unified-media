/**
 * GET /api/search — JSON search API backed by TMDB (via the native media
 * server's tmdb wrapper). Exists as a separate endpoint so client components
 * that need search results without a full page navigation can call it directly.
 * The main /search page uses searchTMDB server-side, not this route.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { searchTMDB } from '@/lib/media-server/tmdb'

// Required because TMDB results change with every query; CDN caching would serve stale data
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAuth()
  const { searchParams } = req.nextUrl
  const q = searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ results: [], totalResults: 0, totalPages: 0, page: 1 })
  const type = (searchParams.get('type') ?? 'all') as 'movie' | 'tv' | 'all'
  const page = Math.max(1, Number(searchParams.get('page') ?? '1'))
  const data = await searchTMDB(q, type, page)
  return NextResponse.json(data)
}
