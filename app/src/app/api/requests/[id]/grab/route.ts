import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getRequestById } from '@/lib/requests/monitor'
import { getAllItems, recordGrab, updateItem } from '@/lib/automation/monitor'
import { grabItem } from '@/lib/automation/grabber'
import { getClient } from '@/lib/download-client/registry'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const request = getRequestById(id)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (request.status !== 'approved') {
    return NextResponse.json({ error: 'Request must be approved before searching' }, { status: 422 })
  }

  const items = getAllItems()
  const item = items.find(
    i => i.tmdb_id === request.tmdb_id && i.type === (request.media_type === 'movie' ? 'movie' : 'tv')
  )
  if (!item) return NextResponse.json({ error: 'No monitored item found for this request' }, { status: 404 })

  // If body contains a magnetUrl, skip search and add that specific torrent directly (override)
  let body: { magnetUrl?: string; title?: string; indexerName?: string; infoHash?: string } = {}
  try { body = await req.json() } catch { /* empty body = normal re-search */ }

  if (body.magnetUrl) {
    await getClient().addTorrent({ urls: body.magnetUrl, category: item.type })
    recordGrab({
      item_id: item.id,
      indexer: body.indexerName ?? 'manual',
      release_title: body.title ?? 'manual override',
      info_hash: body.infoHash ?? '',
    })
    updateItem(item.id, { status: 'grabbed' })
    return NextResponse.json({ status: 'grabbed' })
  }

  const status = await grabItem(item)
  return NextResponse.json({ status })
}
