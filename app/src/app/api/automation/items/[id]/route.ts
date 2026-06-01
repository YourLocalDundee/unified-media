import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getItemById, updateItem, deleteItem } from '@/lib/automation/monitor'
import type { ItemStatus } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const item = getItemById(id)
  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  return NextResponse.json(item)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const existing = getItemById(id)
  if (!existing) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  const body = await req.json() as Partial<{
    title: string
    tmdb_id: number | null
    tvdb_id: number | null
    year: number | null
    quality_profile_id: number
    root_path: string
    monitored: number
    status: ItemStatus
  }>

  const updated = updateItem(id, body)
  return NextResponse.json(updated)
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const deleted = deleteItem(id)
  if (!deleted) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
