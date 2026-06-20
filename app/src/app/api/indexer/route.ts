import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getAllIndexers, createIndexer, redactIndexer } from '@/lib/indexer/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  await requireAdmin()
  // S4: never return api_key to the browser.
  const indexers = getAllIndexers().map(redactIndexer)
  return NextResponse.json(indexers)
}

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  let body: { name?: unknown; torznab_url?: unknown; api_key?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard

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

  return NextResponse.json(redactIndexer(indexer), { status: 201 })
}
