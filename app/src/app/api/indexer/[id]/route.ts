import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getIndexerById, updateIndexer, deleteIndexer, redactIndexer } from '@/lib/indexer/config'

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

  // S4: never return api_key to the browser.
  return NextResponse.json(redactIndexer(indexer))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Partial<{
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
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard

  // S4: because GET no longer returns api_key, the admin edit form submits it empty unless the user
  // typed a new one. Treat an empty/whitespace api_key as "leave unchanged" so saving an edit does
  // not wipe the stored passkey. A real rotation sends a non-empty value.
  if (typeof body.api_key === 'string' && body.api_key.trim() === '') {
    delete body.api_key
  }

  const updated = updateIndexer(id, body)
  if (!updated) {
    return NextResponse.json({ error: 'Indexer not found' }, { status: 404 })
  }

  return NextResponse.json(redactIndexer(updated))
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
