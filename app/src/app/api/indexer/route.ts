import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getAllIndexers, createIndexer } from '@/lib/indexer/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  const indexers = getAllIndexers()
  return NextResponse.json(indexers)
}

export async function POST(req: NextRequest) {
  await requireAdmin()

  const body = await req.json() as { name?: unknown; torznab_url?: unknown; api_key?: unknown }

  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.torznab_url || typeof body.torznab_url !== 'string' || body.torznab_url.trim() === '') {
    return NextResponse.json({ error: 'torznab_url is required' }, { status: 400 })
  }

  const indexer = createIndexer({
    name: body.name.trim(),
    torznab_url: body.torznab_url.trim(),
    api_key: typeof body.api_key === 'string' ? body.api_key : '',
  })

  return NextResponse.json(indexer, { status: 201 })
}
