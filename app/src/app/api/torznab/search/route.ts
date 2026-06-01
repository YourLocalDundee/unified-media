import { NextRequest, NextResponse } from 'next/server'
import { searchAllIndexers } from '@/lib/indexer/index'
import type { TorznabSearchParams } from '@/lib/indexer/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
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
