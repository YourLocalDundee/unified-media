/**
 * GET /api/grab/season/status?tmdbId=&season= — progress for an episode-by-episode
 * season grab (Part B). Counts the per-episode monitored items created for the season
 * and how many have been grabbed/imported, so the UI can show "x / total".
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { getItemsByTmdbId } from '@/lib/automation/monitor'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAdmin()
  const sp = req.nextUrl.searchParams
  const tmdbId = parseInt(sp.get('tmdbId') ?? '', 10)
  const season = parseInt(sp.get('season') ?? '', 10)
  if (isNaN(tmdbId) || isNaN(season)) {
    return NextResponse.json({ error: 'tmdbId and season are required' }, { status: 400 })
  }

  const items = getItemsByTmdbId(tmdbId).filter((it) => {
    if (it.type !== 'tv' || it.scope_type !== 'episodes' || !it.scope_episodes) return false
    try {
      const eps = JSON.parse(it.scope_episodes) as Array<{ s: number; e: number }>
      return eps.some((x) => x.s === season)
    } catch {
      return false
    }
  })

  const total = items.length
  const grabbed = items.filter((it) => it.status === 'grabbed' || it.status === 'imported').length
  return NextResponse.json({ total, grabbed })
}
