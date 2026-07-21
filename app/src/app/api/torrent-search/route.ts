import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { searchAllIndexers } from '@/lib/indexer/index'
import { parseReleaseName, scoreRelease } from '@/lib/automation/parser'
import { getGateConfig, evaluateGates, loadBlocklist, type GateReason } from '@/lib/automation/gates'
import { detectSuspiciousUpscale } from '@/lib/automation/fake-upscale'
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
  // Hard-gate failures (feature 1) — informational here. The interactive picker still lets the
  // admin override-grab a gated release; this just shows WHY auto-pick would have skipped it.
  gates: GateReason[]
  // Detected dub/sub tag (null = untagged) — display-only badge for the interactive picker, since
  // that path bypasses audioModePenalty scoring entirely (see grabber.ts).
  audioMode: 'dub' | 'sub' | null
  // Fake-2160p-upscale suspicion (fake-upscale.ts) — informational only, never excludes the
  // release from this manual-override picker.
  upscaleWarning: string | null
}

export async function GET(req: NextRequest) {
  await requireAuth()

  const q = req.nextUrl.searchParams.get('q') ?? ''
  const type = req.nextUrl.searchParams.get('type') as 'movie' | 'tv' | null

  if (!q.trim()) return NextResponse.json({ results: [] })

  const cats = type === 'movie' ? '2000' : type === 'tv' ? '5000' : undefined
  const results = await searchAllIndexers({ q: q.trim(), ...(cats ? { cats } : {}) })

  // Evaluate gates once per search (config + blocklist loaded a single time).
  const gateConfig = getGateConfig(type === 'movie' ? 'movie' : 'tv')
  const blocked = loadBlocklist()

  const scored: TorrentSearchResult[] = results
    .map((r): TorrentSearchResult => {
      const meta = parseReleaseName(r.title)
      // Empty conditions = no hard rejects; score reflects resolution/source bonuses only
      const raw = scoreRelease(meta, [])
      return {
        ...r,
        score: raw ?? 0,
        gates: evaluateGates(r, gateConfig, blocked),
        audioMode: meta.audioMode,
        upscaleWarning: detectSuspiciousUpscale(meta.resolution, type === 'movie' ? 'movie' : 'tv', r.size, r.title).reason,
      }
    })
    .sort((a, b) => b.seeders - a.seeders)  // default: most seeded first

  return NextResponse.json({ results: scored })
}
