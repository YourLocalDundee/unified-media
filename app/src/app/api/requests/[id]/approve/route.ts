import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { checkRateLimit } from '@/lib/rate-limit'
import { getClientIp } from '@/lib/client-ip'
import { getRequestById, updateRequestStatus } from '@/lib/requests/monitor'
import { createItem } from '@/lib/automation/monitor'
import { resolveMonitoredItemForRequest } from '@/lib/automation/grab-results'
import { getDb } from '@/lib/db/index'

export const dynamic = 'force-dynamic'

// Grab a specific release that the user pre-selected in the torrent picker.
function firePreferredGrab(
  tmdbId: number,
  mediaType: string,
  profileId: number,
  picked: {
    magnetUrl: string
    downloadUrl: string
    infoHash: string
    indexerName: string
    releaseTitle: string
    seeders: number
    size: number
  }
): void {
  void (async () => {
    try {
      const { createItem: ci, recordGrab, updateItem } = await import('@/lib/automation/monitor')
      const { getClient } = await import('@/lib/download-client/registry')
      const { recordGrabResults } = await import('@/lib/automation/grab-results')

      let monitorItem
      try {
        monitorItem = ci({
          tmdb_id: tmdbId,
          tvdb_id: undefined,
          type: mediaType === 'movie' ? 'movie' : 'tv',
          title: picked.releaseTitle,
          year: undefined,
          quality_profile_id: profileId,
          root_path: '',
        })
      } catch {
        // Item already created by the createItem call in POST approve below — find it
        const { getAllItems } = await import('@/lib/automation/monitor')
        const existing = getAllItems().find(
          i => i.tmdb_id === tmdbId && i.type === (mediaType === 'movie' ? 'movie' : 'tv')
        )
        if (!existing) return
        monitorItem = existing
      }

      // D3: atomically claim the row ('wanted'→'grabbing') before adding the torrent so this
      // non-awaited preferred grab cannot race the 15-min cron grabbing the same row. If the
      // cron already claimed/grabbed it (changes===0), bail and let the cron's grab stand.
      const { getDb } = await import('@/lib/db/index')
      const claim = getDb()
        .prepare("UPDATE monitored_items SET status = 'grabbing', updated_at = ? WHERE id = ? AND status = 'wanted'")
        .run(Date.now(), monitorItem.id)
      if (claim.changes === 0) {
        console.log(`[approve] Preferred grab for "${picked.releaseTitle}" skipped — row already claimed`)
        return
      }

      const url = picked.magnetUrl || picked.downloadUrl
      await getClient().addTorrent({ urls: url, category: mediaType === 'movie' ? 'movie' : 'tv' })

      recordGrab({
        item_id: monitorItem.id,
        indexer: picked.indexerName,
        release_title: picked.releaseTitle,
        info_hash: picked.infoHash,
        urls: [picked.magnetUrl, picked.downloadUrl],
      })
      updateItem(monitorItem.id, { status: 'grabbed' })

      recordGrabResults(monitorItem.id, [{
        result: {
          title: picked.releaseTitle,
          infoHash: picked.infoHash,
          magnetUrl: picked.magnetUrl,
          downloadUrl: picked.downloadUrl,
          size: picked.size,
          seeders: picked.seeders,
          leechers: 0,
          indexerName: picked.indexerName,
          publishDate: new Date().toISOString(),
          categories: [],
        },
        score: 0,
        selected: true,
      }], picked.infoHash)

      console.log(`[approve] Preferred grab for "${picked.releaseTitle}": grabbed`)
    } catch (err) {
      console.warn('[approve] Preferred grab failed (cron will retry):', err)
      // D3: release a stuck 'grabbing' claim back to 'wanted' so the cron retries.
      try {
        const { getDb } = await import('@/lib/db/index')
        getDb()
          .prepare("UPDATE monitored_items SET status = 'wanted', updated_at = ? WHERE tmdb_id = ? AND type = ? AND status = 'grabbing'")
          .run(Date.now(), tmdbId, mediaType === 'movie' ? 'movie' : 'tv')
      } catch { /* best-effort release */ }
    }
  })()
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await requireAdmin()

  const ip = getClientIp(req)
  const rl = checkRateLimit(`admin-approve:${ip}`, 60, 5 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
  }

  const { id: idStr } = await params

  const id = parseInt(idStr, 10)
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({})) as {
    ignorePreferred?: boolean
    overrideRelease?: {
      magnetUrl: string; downloadUrl: string; infoHash: string
      indexerName: string; releaseTitle: string; seeders: number; size: number
    }
  }

  const request = getRequestById(id)
  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // A6-03: only a pending request can be approved. Re-approving an already-approved/available/
  // declined/expired row would re-create the monitored item, reset status to 'approved' (freeing
  // an 'available' quick request from the auto-delete query → slot leak), and fire a duplicate
  // grab. Re-grabbing an already-approved item is what POST /api/requests/[id]/grab is for.
  if (request.status !== 'pending') {
    return NextResponse.json(
      { error: `Request is already ${request.status}; only pending requests can be approved.` },
      { status: 409 }
    )
  }

  // Read scope + quality profile fields from the request row
  const scopeRow = getDb()
    .prepare('SELECT scope_type, scope_seasons, scope_episodes, monitor_future, quality_profile_id, language, audio_mode FROM media_requests WHERE id = ?')
    .get(id) as {
      scope_type: string | null
      scope_seasons: string | null
      scope_episodes: string | null
      monitor_future: number | null
      quality_profile_id: number | null
      language: string | null
      audio_mode: string | null
    } | undefined

  const qualityProfileId =
    typeof scopeRow?.quality_profile_id === 'number' && scopeRow.quality_profile_id > 0
      ? scopeRow.quality_profile_id
      : 1
  const language = scopeRow?.language?.trim() || 'any'
  const audioMode = scopeRow?.audio_mode?.trim() || 'any'

  // Create the monitored_item so the cron loop can find it.
  // Scope and quality profile are forwarded from what the user chose at request time.
  let itemId: number | null = null
  try {
    const item = createItem({
      tmdb_id: request.tmdb_id,
      tvdb_id: undefined,
      type: request.media_type === 'movie' ? 'movie' : 'tv',
      title: request.title,
      year: request.year ?? undefined,
      quality_profile_id: qualityProfileId,
      root_path: '',
      scope_type: (scopeRow?.scope_type as 'full' | 'seasons' | 'episodes' | 'movie' | null) ?? null,
      scope_seasons: scopeRow?.scope_seasons ? (JSON.parse(scopeRow.scope_seasons) as number[]) : null,
      scope_episodes: scopeRow?.scope_episodes ? (JSON.parse(scopeRow.scope_episodes) as Array<{s:number;e:number}>) : null,
      monitor_future: Boolean(scopeRow?.monitor_future),
      language,
      audio_mode: audioMode,
    })
    itemId = item.id
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!message.toLowerCase().includes('already exists')) {
      return NextResponse.json({ error: 'Failed to queue item' }, { status: 500 })
    }
    // Already exists — resolve it so the response can still carry an itemId for the confirmation modal.
    itemId = resolveMonitoredItemForRequest(request.tmdb_id, request.media_type as 'movie' | 'tv')?.id ?? null
  }

  updateRequestStatus(id, 'approved')

  // A20-01: a quick request approved here (e.g. a quick+interactive pick that skipped
  // tryAutoApprove and landed in the admin queue) must also get auto_approved=1. availability.ts
  // keys auto_delete_at on request_type='quick', but runAutoDelete keys on auto_approved=1 — without
  // this, the 48h timer is set but the file is never deleted and the quick slot leaks.
  if (request.request_type === 'quick') {
    getDb().prepare('UPDATE media_requests SET auto_approved = 1 WHERE id = ?').run(id)
  }

  // Check if the user pre-selected a release in the picker modal
  const row = getDb()
    .prepare('SELECT preferred_release FROM media_requests WHERE id = ?')
    .get(id) as { preferred_release: string | null } | undefined

  const preferred = row?.preferred_release
    ? (() => {
        try { return JSON.parse(row.preferred_release) as {
          magnetUrl: string; downloadUrl: string; infoHash: string
          indexerName: string; releaseTitle: string; seeders: number; size: number
        } } catch { return null }
      })()
    : null

  // "Approve (use pick)" and the admin's own "Pick different release" override are already a
  // confirmed choice (made via the interactive picker) — grab immediately, same as before.
  // "Approve (auto-search)" / plain "Approve" with no preferred release has no confirmed pick, so
  // it no longer auto-searches-and-grabs here — the client opens the grab-confirmation modal
  // against `itemId` instead.
  let needsConfirm = false
  if (body.overrideRelease) {
    firePreferredGrab(request.tmdb_id, request.media_type, qualityProfileId, body.overrideRelease)
  } else if (!body.ignorePreferred && preferred) {
    firePreferredGrab(request.tmdb_id, request.media_type, qualityProfileId, preferred)
  } else {
    needsConfirm = true
  }

  const updated = getRequestById(id)
  return NextResponse.json({
    ...updated,
    preferredRelease: preferred ?? null,
    ...(needsConfirm ? { itemId } : {}),
  })
}
