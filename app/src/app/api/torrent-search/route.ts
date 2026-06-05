import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { searchAllIndexers } from '@/lib/indexer/index'
import { parseReleaseName, scoreRelease } from '@/lib/automation/parser'
import type { TorznabResult } from '@/lib/indexer/types'

export const dynamic = 'force-dynamic'

export interface TorrentSearchResult {
  title: string
  infoHash: string
  magnetUrl: string
  downloadUrl: string
  size: number
  seeders: number
  leechers: number
  indexerName: string
  publishDate: string
  categories: string[]
  imdbId?: string
  score: number   // additive quality score (resolution + source bonuses); user picks manually so no hard rejects
}

function scoredResult(r: TorznabResult): TorrentSearchResult {
  const meta = parseReleaseName(r.title)
  // Empty conditions = no hard rejects; score reflects resolution/source bonuses only
  const raw = scoreRelease(meta, [])
  return { ...r, score: raw ?? 0 }
}

export async function GET(req: NextRequest) {
  await requireAuth()

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const type = req.nextUrl.searchParams.get('type') as 'movie' | 'tv' | null

  if (!q.trim()) return NextResponse.json({ results: [] })

  const cats = type === 'movie' ? '2000' : type === 'tv' ? '5000' : undefined
  const results = await searchAllIndexers({ q: q.trim(), ...(cats ? { cats } : {}) })

  const scored = results
    .map(scoredResult)
    .sort((a, b) => b.seeders - a.seeders)  // default: most seeded first

  return NextResponse.json({ results: scored })
}
