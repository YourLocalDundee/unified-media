import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getIndexerById, updateIndexer, deleteIndexer } from '@/lib/indexer/config'

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

  const indexer = getIndexerById(id)
  if (!indexer) {
    return NextResponse.json({ error: 'Indexer not found' }, { status: 404 })
  }

  return NextResponse.json(indexer)
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

  const body = await req.json() as Partial<{
    name: string
    torznab_url: string
    api_key: string
    enabled: number
    description: string
    base_url: string
    requires_auth: number
    requires_flaresolverr: number
    search_type: string
    pending_credentials: string
  }>

  const updated = updateIndexer(id, body)
  if (!updated) {
    return NextResponse.json({ error: 'Indexer not found' }, { status: 404 })
  }

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

  const deleted = deleteIndexer(id)
  if (!deleted) {
    return NextResponse.json({ error: 'Indexer not found' }, { status: 404 })
  }

  return new NextResponse(null, { status: 204 })
}
