import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getSubtitleById, updateSubtitleStatus, deleteSubtitleWant } from '@/lib/subtitle/monitor'
import type { SubtitleStatus } from '@/lib/subtitle/types'
import { verifyOrigin } from '@/lib/csrf'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const item = getSubtitleById(numId)
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { status?: SubtitleStatus }
  try { body = await req.json() as { status?: SubtitleStatus } }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard
  const valid: SubtitleStatus[] = ['wanted', 'downloaded', 'skipped', 'failed']
  if (!body.status || !valid.includes(body.status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  updateSubtitleStatus(numId, body.status)
  return NextResponse.json(getSubtitleById(numId))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 }) // S2: CSRF
  await requireAdmin()
  const { id } = await params
  const numId = parseInt(id, 10)
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const deleted = deleteSubtitleWant(numId)
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return new NextResponse(null, { status: 204 })
}
