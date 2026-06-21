import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getRequestById } from '@/lib/requests/monitor'
import { deleteRequestWithCascade } from '@/lib/requests/delete'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAuth()
  const { id: idStr } = await params

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const request = getRequestById(id)
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // 404 rather than 403 to avoid leaking that the request ID exists.
  if (session.role !== 'admin' && request.user_id !== session.userId) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  return NextResponse.json(request)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()
  const { id: idStr } = await params

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const request = getRequestById(id)
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  if (session.role !== 'admin' && request.user_id !== session.userId) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // Cascade: also remove the show's orphaned monitored_items + grab history and its torrents
  // (torrent-only, no files) so a deleted request stops grabbing and leaves nothing in the client.
  const summary = await deleteRequestWithCascade(id)
  if (!summary.deleted) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
