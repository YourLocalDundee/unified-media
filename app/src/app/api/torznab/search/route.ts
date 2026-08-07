/**
 * Torznab search endpoint. The automation layer calls `searchAllIndexers` directly (in-process),
 * so this HTTP route has no internal callers — but it is still a normally-reachable endpoint.
 * A7-06: gate it with requireAuth so an anonymous caller can't drive an unbounded outbound
 * fan-out to every configured indexer (rate-limit burn / private-tracker bans).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { searchAllIndexers } from '@/lib/indexer/index'
import type { TorznabSearchParams } from '@/lib/indexer/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAuth()
  const sp = req.nextUrl.searchParams

  const q = sp.get('q') ?? undefined
  const imdbid = sp.get('imdbid') ?? undefined

  if (!q && !imdbid) {
    return NextResponse.json(
      { error: 'At least one of q or imdbid is required' },
      { status: 400 }
    )
  }

  const params: TorznabSearchParams = {
    q,
    imdbid,
    cats: sp.get('cats') ?? undefined,
    season: sp.get('season') ?? undefined,
    ep: sp.get('ep') ?? undefined,
  }

  const results = await searchAllIndexers(params)

  return NextResponse.json({ results, count: results.length })
}
