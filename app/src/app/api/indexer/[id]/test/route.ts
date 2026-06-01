import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getIndexerById, updateIndexerHealth } from '@/lib/indexer/config'
import { testIndexer } from '@/lib/indexer/index'

export const dynamic = 'force-dynamic'

export async function POST(
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

  const result = await testIndexer(indexer)
  updateIndexerHealth(id, result.status, result.responseTimeMs)

  return NextResponse.json({
    status: result.status,
    responseTimeMs: result.responseTimeMs,
    errorMessage: result.errorMessage ?? null,
  })
}
