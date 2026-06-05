import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getIndexerById, activateIndexer } from '@/lib/indexer/config'
import { testIndexer } from '@/lib/indexer/index'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAdmin()
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const indexer = getIndexerById(id)
  if (!indexer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json() as { credentials?: Record<string, string> }
  const creds = body.credentials ?? {}

  const torznab_url = (creds['torznab_url'] ?? '').trim()
  const api_key = (creds['api_key'] ?? '').trim()

  if (!torznab_url) return NextResponse.json({ error: 'torznab_url is required' }, { status: 400 })

  // Test with the new credentials before writing to DB — test uses the provided values
  const testTarget = { ...indexer, torznab_url, api_key }
  const health = await testIndexer(testTarget)
  if (health.status === 'error') {
    return NextResponse.json({
      error: `Indexer test failed: ${health.errorMessage ?? 'unreachable'}`,
      health,
    }, { status: 422 })
  }

  activateIndexer(id, torznab_url, api_key)
  return NextResponse.json({ ok: true, health })
}
