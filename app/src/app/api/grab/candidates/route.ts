import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getItemById } from '@/lib/automation/monitor'
import { resolveMonitoredItemForRequest, getLatestGrabResults } from '@/lib/automation/grab-results'
import { searchCandidatesForItem, splitTiers } from '@/lib/automation/grabber'
import type { MonitoredItem } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await requireAuth()

  const { searchParams } = req.nextUrl
  const itemIdParam = searchParams.get('itemId')
  const tmdbIdParam = searchParams.get('tmdbId')
  const typeParam = searchParams.get('type')
  const refresh = searchParams.get('refresh') === 'true'

  let item: MonitoredItem | undefined
  if (itemIdParam) {
    const itemId = parseInt(itemIdParam, 10)
    if (isNaN(itemId)) return NextResponse.json({ error: 'Invalid itemId' }, { status: 400 })
    item = getItemById(itemId)
  } else if (tmdbIdParam && (typeParam === 'movie' || typeParam === 'tv')) {
    const tmdbId = parseInt(tmdbIdParam, 10)
    if (isNaN(tmdbId)) return NextResponse.json({ error: 'Invalid tmdbId' }, { status: 400 })
    item = resolveMonitoredItemForRequest(tmdbId, typeParam)
  } else {
    return NextResponse.json({ error: 'itemId or (tmdbId & type) is required' }, { status: 400 })
  }

  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const shared = {
    itemId: item.id,
    language: item.language,
    audioMode: item.audio_mode,
    profileId: item.quality_profile_id,
  }

  if (refresh) {
    // Live re-search — NOT written to grab_results (that table is cron/grab history; a preview
    // shouldn't pollute it). Uses the same scoring/gating primitives as grabItem, just via
    // whichever search shape this item needs (see searchCandidatesForItem).
    const scored = await searchCandidatesForItem(item)
    const { tier1, tier2 } = splitTiers(scored)
    return NextResponse.json({ ...shared, tier1, tier2, needsSearch: false })
  }

  const cached = getLatestGrabResults(item.id)
  if (!cached) {
    // Brand-new item (just created, never searched) — expected for the two "create then confirm"
    // flows (Auto-grab, Grab pack); the client's next action here is Refresh, not an error state.
    return NextResponse.json({ ...shared, tier1: [], tier2: [], needsSearch: true })
  }

  const { tier1, tier2 } = splitTiers(cached.candidates)
  return NextResponse.json({
    ...shared,
    tier1,
    tier2,
    needsSearch: false,
    selectedHash: cached.selected_hash,
    skipReason: cached.skip_reason,
  })
}
