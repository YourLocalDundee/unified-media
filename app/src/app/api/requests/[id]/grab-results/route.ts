import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getRequestById } from '@/lib/requests/monitor'
import { getLatestGrabResults, getMonitoredItemIdForRequest } from '@/lib/automation/grab-results'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const request = getRequestById(id)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const monitoredId = getMonitoredItemIdForRequest(request.tmdb_id, request.media_type as 'movie' | 'tv')
  if (!monitoredId) {
    return NextResponse.json({ results: null, message: 'No grab attempted yet' })
  }

  const results = getLatestGrabResults(monitoredId)
  return NextResponse.json({ results: results ?? null })
}
