/**
 * POST /api/grab/season — admin direct-grab for a single TV season (Part B).
 *
 * mode 'auto' (default): search indexers for a season pack matching the chosen
 *   language + quality profile. If one qualifies, send it to the download client and
 *   record a 'grabbed' monitored item. If none, return { result:'no_pack' } so the UI
 *   can offer the episode-by-episode fallback.
 * mode 'episodes': fan out — create one 'wanted' monitored item per episode of the
 *   season (scoped + language + quality). The 15-min grab cron then finds each, retrying
 *   until the season is complete ("find until full").
 *
 * Admin-only and Origin-checked: this bypasses the request/approval flow and directly
 * commands the download client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileById, createItem, recordGrab, updateItem } from '@/lib/automation/monitor'
import { createRequest, updateRequestStatus, getRequestByTmdb } from '@/lib/requests/monitor'
import { getDb } from '@/lib/db/index'
import { findSeasonPack } from '@/lib/automation/grabber'
import { getSeasonEpisodeNumbers } from '@/lib/media-server/tmdb'
import { getClient } from '@/lib/download-client/registry'
import type { QualityProfile } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

const ANY_PROFILE: QualityProfile = { id: 0, name: 'Any', conditions: '[]' }

// Creates or updates a media_request row for an admin grab so it shows on the Requests page.
// If a row already exists for this user+tmdbId+mediaType, the new seasonNumber is merged into
// scope_seasons so a second season grab doesn't silently disappear.
function recordGrabRequest(userId: string, tmdbId: number, title: string, year: number | undefined, seasonNumber: number) {
  try {
    const existing = getRequestByTmdb(userId, tmdbId, 'tv')
    if (existing) {
      // Merge the new season into scope_seasons without duplicating.
      let seasons: number[] = []
      try {
        const raw = (existing as { scope_seasons?: string | null }).scope_seasons
        if (typeof raw === 'string') seasons = JSON.parse(raw) as number[]
      } catch { /* malformed — reset */ }
      if (!seasons.includes(seasonNumber)) {
        seasons.push(seasonNumber)
        seasons.sort((a, b) => a - b)
        getDb()
          .prepare('UPDATE media_requests SET scope_seasons = ?, scope_type = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(seasons), 'seasons', Date.now(), existing.id)
      }
      return
    }
    const req = createRequest({
      userId,
      tmdbId,
      mediaType: 'tv',
      title,
      year: year ?? null,
      requestType: 'longterm',
      scopeType: 'seasons',
      scopeSeasons: [seasonNumber],
      monitorFuture: false,
    })
    updateRequestStatus(req.id, 'approved')
  } catch { /* ignore — grab should not fail because the requests row failed */ }
}

export async function POST(req: NextRequest) {
  const session = await requireAdmin()
  if (!verifyOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })

  const body = (await req.json().catch(() => null)) as {
    tmdbId?: number
    title?: string
    year?: number
    seasonNumber?: number
    language?: string
    qualityProfileId?: number
    mode?: 'auto' | 'episodes'
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { tmdbId, title, year, seasonNumber } = body
  const language = body.language || 'any'
  const mode = body.mode === 'episodes' ? 'episodes' : 'auto'
  if (typeof tmdbId !== 'number' || !title || typeof seasonNumber !== 'number' || seasonNumber < 1) {
    return NextResponse.json({ error: 'tmdbId, title and seasonNumber are required' }, { status: 400 })
  }

  // Default to profile id=1 (the seeded "Any" profile); fall back to a transient Any if it's gone.
  const profile = getProfileById(body.qualityProfileId ?? 1) ?? ANY_PROFILE
  const profileId = profile.id || 1

  try {
    if (mode === 'auto') {
      const pack = await findSeasonPack(title, seasonNumber, profile, language)
      if (!pack) {
        const eps = await getSeasonEpisodeNumbers(tmdbId, seasonNumber).catch(() => [])
        return NextResponse.json({ result: 'no_pack', seasonNumber, episodeCount: eps.length })
      }
      await getClient().addTorrent({ urls: pack.magnetUrl || pack.downloadUrl, category: 'tv' })
      // Track the grab; create then immediately mark grabbed so the 15-min cron won't re-grab it.
      const item = createItem({
        type: 'tv',
        title,
        tmdb_id: tmdbId,
        year: year ?? undefined,
        quality_profile_id: profileId,
        scope_type: 'seasons',
        scope_seasons: [seasonNumber],
        monitor_future: false,
        language,
      })
      recordGrab({ item_id: item.id, indexer: pack.indexerName, release_title: pack.title, info_hash: pack.infoHash })
      updateItem(item.id, { status: 'grabbed' })
      recordGrabRequest(session.userId, tmdbId, title, year, seasonNumber)
      return NextResponse.json({
        result: 'pack_grabbed',
        release: { title: pack.title, indexer: pack.indexerName, size: pack.size, seeders: pack.seeders },
      })
    }

    // mode === 'episodes' — one wanted item per episode; the cron grabs each until done.
    const episodes = await getSeasonEpisodeNumbers(tmdbId, seasonNumber)
    if (episodes.length === 0) {
      return NextResponse.json({ error: 'No episodes found for this season on TMDB' }, { status: 404 })
    }
    for (const e of episodes) {
      createItem({
        type: 'tv',
        title,
        tmdb_id: tmdbId,
        year: year ?? undefined,
        quality_profile_id: profileId,
        scope_type: 'episodes',
        scope_episodes: [{ s: seasonNumber, e }],
        monitor_future: false,
        language,
      })
    }
    recordGrabRequest(session.userId, tmdbId, title, year, seasonNumber)
    return NextResponse.json({ result: 'episodes_queued', count: episodes.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write(`[grab/season] ${title} S${seasonNumber} (${mode}): ${msg}\n`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
