/**
 * DELETE /api/admin/media/[id] — admin "delete from server" (Part C).
 *
 * Purges a library title from disk, the download client, and the database. Destructive
 * and irreversible, so admin-gated + Origin-checked. The heavy lifting (and the safety
 * of scoping file deletion to the explicit id) lives in purgeMediaItem.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logEvent } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { purgeMediaItem } from '@/lib/media-server/purge'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin()
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  try {
    const summary = await purgeMediaItem(id)
    if (!summary) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await logEvent(
      'admin_action',
      {
        action: 'delete_media',
        id,
        title: summary.title,
        filesDeleted: summary.filesDeleted,
        torrentsDeleted: summary.torrentsDeleted,
        rowsDeleted: summary.rowsDeleted,
      },
      { userId: session.userId, username: session.username },
    )
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[admin/media DELETE] ${id}: ${message}\n`)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
