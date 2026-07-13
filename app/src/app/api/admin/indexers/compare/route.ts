// Head-to-head native-vs-Prowlarr comparison — the cutover evidence tool for the indexer
// independence build. Read-only against indexer health (see compare.ts: neither side records
// backoff/rate-limit state), but still admin-gated since it drives real outbound requests
// (including against a private-tracker-adjacent Prowlarr bridge) using the target indexer's
// api_key.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getIndexerById } from '@/lib/indexer/config'
import { compareIndexers } from '@/lib/indexer/compare'
import type { TorznabSearchParams } from '@/lib/indexer/types'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  let body: { indexerAId?: unknown; indexerBId?: unknown; q?: unknown; imdbid?: unknown; cats?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) }

  const aId = typeof body.indexerAId === 'number' ? body.indexerAId : NaN
  const bId = typeof body.indexerBId === 'number' ? body.indexerBId : NaN
  if (isNaN(aId) || isNaN(bId)) {
    return NextResponse.json({ error: 'indexerAId and indexerBId are required' }, { status: 400 })
  }

  const q = typeof body.q === 'string' ? body.q : undefined
  const imdbid = typeof body.imdbid === 'string' ? body.imdbid : undefined
  const cats = typeof body.cats === 'string' ? body.cats : undefined
  if (!q && !imdbid) {
    return NextResponse.json({ error: 'At least one of q or imdbid is required' }, { status: 400 })
  }

  const indexerA = getIndexerById(aId)
  const indexerB = getIndexerById(bId)
  if (!indexerA || !indexerB) {
    return NextResponse.json({ error: 'Indexer not found' }, { status: 404 })
  }

  const params: TorznabSearchParams = { q, imdbid, cats }
  const result = await compareIndexers(indexerA, indexerB, params)

  return NextResponse.json(result)
}
