import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { findAllBridgedItems } from '@/lib/automation/bridge'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const raw = findAllBridgedItems()
  const items = raw.map(({ item }) => ({
    id: item.id,
    tmdb_id: item.tmdb_id,
    tvdb_id: item.tvdb_id,
    type: item.type,
    title: item.title,
    year: item.year,
    status: item.status,
    quality_profile_id: item.quality_profile_id,
    created_at: item.created_at,
    updated_at: item.updated_at,
  }))
  return NextResponse.json(items)
}
