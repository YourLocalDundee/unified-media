// API route: GET /api/requests  — list requests (admin sees all; user sees own)
//            POST /api/requests — create a new request with optional auto-approval
// Enforces auth on every request; no anonymous access to the request system.

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
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
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const session = await requireAuth()

  const rl = checkRateLimit(`create-request:${session.userId}`, 20, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  let body: {
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
    // Dub/sub audio preference: 'any' | 'dub' | 'sub'. Default 'any'.
    audioMode?: string
    // Quality profile to use when creating the monitored_items row.
    // null / omitted → falls back to the default (ID 1).
    quality_profile_id?: number
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
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }) } // A19: parse guard

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
  const audioMode = body.audioMode?.trim() || 'any'
  // Quality profile — positive integer or null (default profile).
  const qualityProfileId =
    typeof body.quality_profile_id === 'number' && body.quality_profile_id > 0
      ? body.quality_profile_id
      : null

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
  // A6-08: this is a content-policy rejection, not a rate/slot limit — return 422 (not 429, which
  // the client treats as "limit reached"). The `code` lets the client branch deterministically.
  // A7-03: only the auto-pick quick path is gated here. An interactive pick goes to the admin queue
  // "regardless of year" (CLAUDE.md §15), so it must not be rejected by the year rule.
  const currentYear = new Date().getFullYear()
  const isOldEnough = (year != null) && (year < currentYear)
  if (retentionType === 'quick' && methodType === 'auto-pick' && !isOldEnough) {
    return NextResponse.json(
      {
        code: 'year_not_eligible',
        error: '48hr Access is only available for content released before this year. Try Long-term instead.',
      },
      { status: 422 }
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

  // Persist request method, language, audio mode, and quality profile on the freshly created row.
  getDb()
    .prepare('UPDATE media_requests SET request_method = ?, language = ?, audio_mode = ?, quality_profile_id = ?, updated_at = ? WHERE id = ?')
    .run(methodType, language, audioMode, qualityProfileId, Date.now(), created.id)

  // ── INTERACTIVE PATH (user hand-picked a specific release) ──────────────────
  // A7-03: interactive picks ALWAYS go to the admin queue (pending), for both quick and long-term
  // retention. CLAUDE.md §15 and the TorrentPickModal footer both state this ("Interactive picks
  // always go to admin queue regardless of retention"); the previous quick+interactive branch
  // grabbed immediately, which (a) contradicted the spec, (b) skipped the quick-slot accounting in
  // tryAutoApprove, and (c) added the torrent before any bookkeeping (A6-06 orphaned-download race).
  // The chosen release is stored as preferred_release; the admin approve route grabs it on approval.
  if (pickedTorrent) {
    getDb()
      .prepare('UPDATE media_requests SET preferred_release = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(pickedTorrent), Date.now(), created.id)

    const pending = getRequestById(created.id)
    return NextResponse.json(pending, { status: 201 })
  }

  // ── AUTO-PICK PATH ─────────────────────────────────────────────────────────
  if (isImmediateGrab) {
    // 48hr + auto-pick: attempt immediate approval and grab without admin intervention.
    // Dynamically imported to keep 'server-only' out of edge-runtime bundles.
    const { tryAutoApprove } = await import('@/lib/requests/auto-approve')
    const itemId = tryAutoApprove(created.id)
    if (itemId !== null) {
      // itemId lets the client open the grab-confirmation modal directly against the item
      // tryAutoApprove just created — it does NOT grab; the user confirms via that modal.
      const approved = getRequestById(created.id)
      return NextResponse.json({ ...approved, itemId }, { status: 201 })
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
