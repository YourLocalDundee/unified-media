// API route: GET /api/requests/[id]/progress
// Returns real-time download progress for a given request by:
//   1. Finding the latest grab_history row linked to any monitored_items row for this request
//   2. Querying qBittorrent for current torrent state using the info_hash

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/dal'
import { getDb } from '@/lib/db/index'
import { qbitFetch } from '@/lib/qbittorrent/session'

export const dynamic = 'force-dynamic'

interface QbtTorrentInfo {
  hash: string
  progress: number      // 0–1
  state: string         // e.g. 'downloading', 'stalledDL', 'pausedDL', 'uploading', etc.
  dlspeed: number       // bytes/s
  eta: number           // seconds; 8640000 = unknown
  name: string
}

interface ProgressResponse {
  grabbed: boolean
  hash: string | null
  progress: number | null
  state: string | null
  dlspeed: number | null
  eta: number | null
  indexer: string | null
  releaseTitle: string | null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireAuth()

  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const db = getDb()

  // Look up the request to get tmdb_id + media_type so we can find monitored_items rows.
  const request = db
    .prepare('SELECT tmdb_id, media_type FROM media_requests WHERE id = ?')
    .get(id) as { tmdb_id: number; media_type: string } | undefined

  if (!request) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Find the latest grab_history row for any monitored_items entry that matches
  // this request's tmdb_id + type. "Latest" = highest grabbed_at timestamp.
  const grab = db
    .prepare(`
      SELECT gh.info_hash, gh.indexer, gh.release_title
      FROM grab_history gh
      JOIN monitored_items mi ON mi.id = gh.item_id
      WHERE mi.tmdb_id = ?
        AND mi.type    = ?
      ORDER BY gh.grabbed_at DESC
      LIMIT 1
    `)
    .get(request.tmdb_id, request.media_type === 'tv' ? 'tv' : 'movie') as
    | { info_hash: string; indexer: string; release_title: string }
    | undefined

  const empty: ProgressResponse = {
    grabbed: false,
    hash: null,
    progress: null,
    state: null,
    dlspeed: null,
    eta: null,
    indexer: null,
    releaseTitle: null,
  }

  if (!grab || !grab.info_hash) {
    return NextResponse.json(empty)
  }

  // Query qBittorrent for the specific torrent.
  let torrent: QbtTorrentInfo | null = null
  try {
    const list = await qbitFetch<QbtTorrentInfo[]>(
      `/api/v2/torrents/info?hashes=${grab.info_hash}`
    )
    torrent = Array.isArray(list) && list.length > 0 ? list[0] : null
  } catch {
    // qBittorrent unreachable or torrent not found — return grabbed:true with null progress
    // so the UI can show "Grabbed / searching" rather than "Searching..."
    return NextResponse.json({
      grabbed: true,
      hash: grab.info_hash,
      progress: null,
      state: null,
      dlspeed: null,
      eta: null,
      indexer: grab.indexer,
      releaseTitle: grab.release_title,
    } satisfies ProgressResponse)
  }

  if (!torrent) {
    // Hash not found in qBittorrent (may have been imported and removed already).
    return NextResponse.json({
      grabbed: true,
      hash: grab.info_hash,
      progress: null,
      state: 'imported',
      dlspeed: null,
      eta: null,
      indexer: grab.indexer,
      releaseTitle: grab.release_title,
    } satisfies ProgressResponse)
  }

  return NextResponse.json({
    grabbed: true,
    hash: torrent.hash,
    progress: torrent.progress,
    state: torrent.state,
    dlspeed: torrent.dlspeed,
    // qBittorrent uses 8640000 as a sentinel for "unknown ETA"
    eta: torrent.eta === 8640000 ? null : torrent.eta,
    indexer: grab.indexer,
    releaseTitle: grab.release_title,
  } satisfies ProgressResponse)
}
