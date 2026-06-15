// API route: GET /api/requests  — list requests (admin sees all; user sees own)
//            POST /api/requests — create a new request with optional auto-approval
// Enforces auth on every request; no anonymous access to the request system.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { checkRateLimit } from '@/lib/rate-limit'
import type { RequestStatus } from '@/lib/requests/types'
import {
  getAllRequests,
  getUserRequests,
  getRequestByTmdb,
  getRequestById,
  createRequest,
} from '@/lib/requests/monitor'
import { getDb } from '@/lib/db/index'

// Opt out of static rendering — every response depends on session identity and live DB state.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await requireAuth()

  const statusParam = req.nextUrl.searchParams.get('status') as RequestStatus | null
  const opts = statusParam ? { status: statusParam } : undefined

  // Admins see all users' requests; regular users see only their own.
  if (session.role === 'admin') {
    const requests = getAllRequests(opts)
    return NextResponse.json(requests)
  }

  const requests = getUserRequests(session.userId, opts)
  return NextResponse.json(requests)
}

export async function POST(req: NextRequest) {
  const session = await requireAuth()

  const rl = checkRateLimit(`create-request:${session.userId}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const body = await req.json() as {
    tmdbId?: number
    mediaType?: 'movie' | 'tv'
    title?: string
    year?: number
    posterPath?: string
    overview?: string
    seasons?: number[]
    // DIMENSION 1 — Retention: '48hr' maps to DB value 'quick'; 'longterm' is literal.
    // The client may send either the UI name ('48hr') or the internal value ('quick').
    requestType?: 'quick' | 'longterm' | '48hr'
    // DIMENSION 2 — Method: explicitly sent, or inferred from pickedTorrent presence.
    requestMethod?: 'auto-pick' | 'interactive'
    // PIECE 4 — Language: ISO 639-1 code or 'any'. Default 'any'.
    language?: string
    // Series scope — which portion of the TV series the user wants.
    scopeType?: 'full' | 'seasons' | 'episodes' | 'movie'
    scopeSeasons?: number[]
    scopeEpisodes?: Array<{ s: number; e: number }>
    monitorFuture?: boolean
    // Interactive pick: user chose a specific torrent from the search modal.
    pickedTorrent?: {
      magnetUrl: string
      downloadUrl: string
      infoHash: string
      indexerName: string
      releaseTitle: string
      seeders: number
      size: number
    }
  }

  const { tmdbId, mediaType, title, year, posterPath, overview, seasons, pickedTorrent,
          scopeType, scopeSeasons, scopeEpisodes, monitorFuture } = body

  if (!tmdbId || !mediaType || !title) {
    return NextResponse.json(
      { error: 'tmdbId, mediaType, and title are required' },
      { status: 400 }
    )
  }

  // Normalise retention: '48hr' is a UI alias for the DB value 'quick'.
  const rawType = body.requestType
  const retentionType: 'quick' | 'longterm' =
    rawType === '48hr' ? 'quick' : (rawType === 'quick' ? 'quick' : 'longterm')

  // Infer method from pickedTorrent if not explicitly provided.
  const methodType: 'auto-pick' | 'interactive' =
    body.requestMethod === 'interactive' || pickedTorrent != null
      ? 'interactive'
      : 'auto-pick'

  // Language defaults to 'any' (no constraint).
  const language = body.language?.trim() || 'any'

  // GATING RULE: grab immediately ONLY when retention=48hr AND method=auto-pick.
  // Everything else (longterm OR interactive) → admin approval queue.
  const isImmediateGrab = retentionType === 'quick' && methodType === 'auto-pick'

  const existing = getRequestByTmdb(session.userId, tmdbId, mediaType)
  // Block re-requests for the same title unless the previous one expired.
  if (existing && existing.status !== 'expired') {
    return NextResponse.json({ error: 'Already requested' }, { status: 409 })
  }
  // Expired rows must be deleted before insert; the UNIQUE constraint would otherwise fire.
  if (existing && existing.status === 'expired') {
    getDb().prepare('DELETE FROM media_requests WHERE id = ?').run(existing.id)
  }

  // Year guard for 48hr retention: quick-slot logic only applies to back-catalog content.
  const currentYear = new Date().getFullYear()
  const isOldEnough = (year != null) && (year < currentYear)
  if (retentionType === 'quick' && !isOldEnough) {
    return NextResponse.json(
      { error: '48hr Access is only available for content released before this year. Try Long-term instead.' },
      { status: 429 }
    )
  }

  const created = createRequest({
    userId: session.userId,
    tmdbId,
    mediaType,
    title,
    year,
    posterPath,
    overview,
    seasons,
    requestType: retentionType,
    scopeType,
    scopeSeasons,
    scopeEpisodes,
    monitorFuture,
  })

  // Persist the two new dimension columns and language on the freshly created row.
  getDb()
    .prepare('UPDATE media_requests SET request_method = ?, language = ?, updated_at = ? WHERE id = ?')
    .run(methodType, language, Date.now(), created.id)

  // ── INTERACTIVE PATH (user hand-picked a specific release) ──────────────────
  if (pickedTorrent) {
    // Store the preferred release regardless of retention type.
    getDb()
      .prepare('UPDATE media_requests SET preferred_release = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(pickedTorrent), Date.now(), created.id)

    if (retentionType === 'quick') {
      // Quick + interactive: grab immediately (same as Radarr interactive search).
      // The user already chose the release — no admin approval gate applies.
      try {
        const { getClient } = await import('@/lib/download-client/registry')
        const client = getClient()
        await client.addTorrent({
          urls: pickedTorrent.magnetUrl || pickedTorrent.downloadUrl,
          category: mediaType,
        })

        // Create a monitored_item so the importer can track completion.
        const { createItem } = await import('@/lib/automation/monitor')
        try {
          createItem({
            tmdb_id: tmdbId,
            tvdb_id: undefined,
            type: mediaType === 'movie' ? 'movie' : 'tv',
            title,
            year: year ?? undefined,
            quality_profile_id: 1,
            root_path: '',
            scope_type: scopeType ?? null,
            scope_seasons: scopeSeasons ? (Array.isArray(scopeSeasons) ? scopeSeasons : null) : null,
            scope_episodes: scopeEpisodes ? (Array.isArray(scopeEpisodes) ? scopeEpisodes : null) : null,
            monitor_future: Boolean(monitorFuture),
            language,
          })
        } catch (itemErr) {
          // 'already exists' is fine — a previous request may have already created the item.
          const msg = itemErr instanceof Error ? itemErr.message : String(itemErr)
          if (!msg.toLowerCase().includes('already exists')) {
            throw itemErr
          }
        }

        // Record in grab_history.
        const { getAllItems, recordGrab, updateItem } = await import('@/lib/automation/monitor')
        const allItems = getAllItems()
        const monitoredItem = allItems.find(
          i => i.tmdb_id === tmdbId && i.type === (mediaType === 'movie' ? 'movie' : 'tv')
        )
        if (monitoredItem) {
          recordGrab({
            item_id: monitoredItem.id,
            indexer: pickedTorrent.indexerName,
            release_title: pickedTorrent.releaseTitle,
            info_hash: pickedTorrent.infoHash,
          })
          updateItem(monitoredItem.id, { status: 'grabbed' })
        }

        // Mark request approved.
        getDb()
          .prepare("UPDATE media_requests SET status = 'approved', auto_approved = 1, updated_at = ? WHERE id = ?")
          .run(Date.now(), created.id)

        const approved = getRequestById(created.id)
        return NextResponse.json(approved, { status: 201 })
      } catch (grabErr) {
        // Grab failed — leave request in pending state for manual retry.
        console.error('[requests] Interactive quick grab failed:', grabErr)
        const pending = getRequestById(created.id)
        return NextResponse.json({ ...pending, _grabError: true }, { status: 201 })
      }
    }

    // Long-term + interactive: store preferred release, queue for admin approval.
    const pending = getRequestById(created.id)
    return NextResponse.json(pending, { status: 201 })
  }

  // ── AUTO-PICK PATH ─────────────────────────────────────────────────────────
  if (isImmediateGrab) {
    // 48hr + auto-pick: attempt immediate approval and grab without admin intervention.
    // Dynamically imported to keep 'server-only' out of edge-runtime bundles.
    const { tryAutoApprove } = await import('@/lib/requests/auto-approve')
    const wasApproved = tryAutoApprove(created.id)
    if (wasApproved) {
      const approved = getRequestById(created.id)
      return NextResponse.json(approved, { status: 201 })
    }
    // Slot limit hit: all-or-nothing — clean up and return 429.
    getDb().prepare('DELETE FROM media_requests WHERE id = ?').run(created.id)
    return NextResponse.json(
      { error: '48hr Access limit reached (1 movie or 2 shows max). Try Long-term instead.' },
      { status: 429 }
    )
  }

  // All other paths (longterm+auto-pick, longterm+interactive already handled above):
  // return pending and wait for admin approval via POST /api/requests/[id]/approve.
  const pending = getRequestById(created.id)
  return NextResponse.json(pending, { status: 201 })
}
