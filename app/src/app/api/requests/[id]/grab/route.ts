import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getRequestById } from '@/lib/requests/monitor'
import { recordGrab, updateItem } from '@/lib/automation/monitor'
import { resolveMonitoredItemForRequest } from '@/lib/automation/grab-results'
import { grabItem } from '@/lib/automation/grabber'
import { getClient } from '@/lib/download-client/registry'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const request = getRequestById(id)
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (request.status !== 'approved') {
    return NextResponse.json({ error: 'Request must be approved before searching' }, { status: 422 })
  }

  // Resolve to the active, narrowly-scoped item (e.g. the arc's wanted episode), NOT the stale
  // 'full' container — and resolve identically to the grab-results display route so a re-search
  // hits the same item whose candidates the admin is looking at.
  const item = resolveMonitoredItemForRequest(
    request.tmdb_id,
    request.media_type === 'movie' ? 'movie' : 'tv',
  )
  if (!item) return NextResponse.json({ error: 'No monitored item found for this request' }, { status: 404 })

  // If body contains a magnetUrl, skip search and add that specific torrent directly (override)
  let body: { magnetUrl?: string; title?: string; indexerName?: string; infoHash?: string } = {}
  try { body = await req.json() } catch { /* empty body = normal re-search */ }

  if (body.magnetUrl) {
    // A6-12: validate the override URL before handing it to the download client. Even though this
    // path is admin-gated, an unchecked `urls` value lets arbitrary schemes reach qBit. Accept only
    // magnet links and http(s) .torrent URLs.
    const url = body.magnetUrl.trim()
    if (!/^(magnet:\?|https?:\/\/)/i.test(url)) {
      return NextResponse.json({ error: 'Override URL must be a magnet link or http(s) URL' }, { status: 400 })
    }
    await getClient().addTorrent({ urls: url, category: item.type })
    recordGrab({
      item_id: item.id,
      indexer: body.indexerName ?? 'manual',
      release_title: body.title ?? 'manual override',
      info_hash: body.infoHash ?? '',
    })
    updateItem(item.id, { status: 'grabbed' })
    return NextResponse.json({ status: 'grabbed' })
  }

  // force: explicit admin re-search; the item is already 'approved'/'grabbed', not 'wanted' (D3).
  const status = await grabItem(item, { force: true })
  return NextResponse.json({ status })
}
