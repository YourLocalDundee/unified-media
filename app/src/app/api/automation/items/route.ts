import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getAllItems, createItem } from '@/lib/automation/monitor'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const items = getAllItems()
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  await requireAdmin()

  const body = await req.json() as {
    type?: unknown
    title?: unknown
    tmdb_id?: unknown
    tvdb_id?: unknown
    year?: unknown
    quality_profile_id?: unknown
    root_path?: unknown
  }

  if (body.type !== 'movie' && body.type !== 'tv') {
    return NextResponse.json({ error: 'type must be "movie" or "tv"' }, { status: 400 })
  }

  if (typeof body.title !== 'string' || body.title.trim() === '') {
    return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 })
  }

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
