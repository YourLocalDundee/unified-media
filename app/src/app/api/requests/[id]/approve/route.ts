import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getRequestById, updateRequestStatus } from '@/lib/requests/monitor'
import { createItem } from '@/lib/automation/monitor'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()
  const { id: idStr } = await params

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const request = getRequestById(id)
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  try {
    createItem({
      tmdb_id: request.tmdb_id,
      tvdb_id: undefined,
      type: request.media_type === 'movie' ? 'movie' : 'tv',
      title: request.title,
      year: request.year ?? undefined,
      quality_profile_id: 1,
      root_path: '',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.toLowerCase().includes('already exists')) {
      return NextResponse.json({ error: 'Failed to queue item' }, { status: 500 })
    }
  }

  updateRequestStatus(id, 'approved')

  const updated = getRequestById(id)
  return NextResponse.json(updated)
}
