import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getTrendingContent } from '@/lib/media-server/tmdb'
import type { TrendingCategory } from '@/lib/media-server/tmdb'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES: TrendingCategory[] = [
  'trending',
  'popular-movies',
  'popular-tv',
  'top-rated-movies',
  'top-rated-tv',
]

export async function GET(req: NextRequest) {
  await requireAuth()
  try {
    const cat = (req.nextUrl.searchParams.get('category') ?? 'trending') as TrendingCategory
    const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1
    const category = VALID_CATEGORIES.includes(cat) ? cat : 'trending'

    const data = await getTrendingContent(category, page)
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
