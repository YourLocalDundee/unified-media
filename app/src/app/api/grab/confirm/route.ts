import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getItemById } from '@/lib/automation/monitor'
import { resolveMonitoredItemForRequest, recordGrabResults, type ScoredCandidate } from '@/lib/automation/grab-results'
import { searchCandidatesForItem, grabSpecificRelease } from '@/lib/automation/grabber'
import { getRequestByTmdb } from '@/lib/requests/monitor'
import type { MonitoredItem } from '@/lib/automation/types'
import type { TorznabResult } from '@/lib/indexer/types'

export const dynamic = 'force-dynamic'

function isValidRelease(r: unknown): r is TorznabResult {
  if (!r || typeof r !== 'object') return false
  const rec = r as Record<string, unknown>
  return (
    typeof rec.title === 'string' && rec.title.length > 0 &&
    typeof rec.infoHash === 'string' &&
    typeof rec.magnetUrl === 'string' &&
    typeof rec.downloadUrl === 'string' &&
    !!(rec.magnetUrl || rec.downloadUrl) &&
    typeof rec.size === 'number' &&
    typeof rec.seeders === 'number' &&
    typeof rec.indexerName === 'string'
  )
}

// Identity used to match a client-supplied release against a freshly-scored candidate — mirrors
// gateKey()/grabItem's own winner-matching (infoHash when present, title as a stable fallback for
// magnet-less/hash-less indexer results).
const releaseKey = (r: TorznabResult) => r.infoHash || r.title

export async function POST(req: NextRequest) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  const body = await req.json().catch(() => null) as {
    itemId?: number
    tmdbId?: number
    type?: 'movie' | 'tv'
    release?: unknown
    override?: boolean
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  let item: MonitoredItem | undefined
  if (typeof body.itemId === 'number') {
    item = getItemById(body.itemId)
  } else if (typeof body.tmdbId === 'number' && (body.type === 'movie' || body.type === 'tv')) {
    item = resolveMonitoredItemForRequest(body.tmdbId, body.type)
  } else {
    return NextResponse.json({ error: 'itemId or (tmdbId & type) is required' }, { status: 400 })
  }
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Non-admins may only confirm a grab for an item tied to one of their OWN requests — a
  // monitored_item has no owner of its own (it's shared infra keyed by tmdb_id), so without this
  // check any authenticated user could trigger a grab for any title in the system.
  if (session.role !== 'admin') {
    const owned = item.tmdb_id != null && getRequestByTmdb(session.userId, item.tmdb_id, item.type)
    if (!owned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isValidRelease(body.release)) {
    return NextResponse.json({ error: 'A valid release object is required' }, { status: 400 })
  }
  const release = body.release

  // Re-validate fresh rather than trusting a client-supplied score/gate snapshot that may be
  // stale (a release can go dead or get blocklisted between "show candidates" and "confirm").
  // This also doubles as the grab_results write for this confirmation — same shape grabItem
  // itself records, so the admin "why did/didn't this grab" history stays consistent.
  const scored: ScoredCandidate[] = await searchCandidatesForItem(item)
  let match = scored.find(c => releaseKey(c.result) === releaseKey(release))

  if (!match) {
    // Client picked something outside the current scoped search (e.g. a hand-typed manual-search
    // result) — record it as a synthetic, ungated candidate so history still reflects what was
    // actually grabbed, but treat it like Tier 2: it needs an explicit override to commit.
    match = { result: release, score: 0, selected: false, gates: [] }
    scored.push(match)
  }

  const isTier2 = (match.gates?.length ?? 0) > 0 || release.seeders <= 0
  if (isTier2 && body.override !== true) {
    return NextResponse.json(
      { error: 'This release is gated or has no seeders — pass override:true to grab it anyway.' },
      { status: 409 },
    )
  }

  match.selected = true
  recordGrabResults(item.id, scored, release.infoHash || null, undefined)

  try {
    await grabSpecificRelease(item, release)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ grabbed: true, title: release.title })
}
