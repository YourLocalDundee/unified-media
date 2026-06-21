/**
 * POST /api/grab/season — admin direct-grab for a TV season OR a TMDB-episode-group arc (Bug 7).
 *
 * Scope: the body carries EITHER `seasonNumber` (plain season) OR `arc:{name,episodes}` (a story
 * arc such as One Piece "Impel Down" = absolute eps 422–456). Arc episodes are resolved on the
 * client from getArcs() and sanitized here; the route is admin-only so they're trusted but shape-checked.
 *
 * Modes:
 *   override (interactive, admin pick): body.override = a specific release the admin chose from the
 *     candidate list. Sent straight to the download client via the SAME enqueue path as auto.
 *   'auto'    : one-shot pack search (findSeasonPack / findArcPack). Found → grab; none → no_pack.
 *   'episodes': fan out one 'wanted' monitored item per episode; the 5-min cron grabs each. Returns
 *     {queued, failed, total} — per-episode createItem failures are logged + counted, never swallowed.
 *
 * Every successful grab also records a media_requests row (status 'approved') so it shows on the
 * Requests page with the exact scope (season number, or arc episodes + label).
 *
 * Admin-only (requireAdmin) and Origin-checked: this bypasses the request/approval flow and directly
 * commands the download client.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/dal'
import { verifyOrigin } from '@/lib/csrf'
import { getProfileById, createItem, recordGrab, updateItem } from '@/lib/automation/monitor'
import { createRequest, updateRequestStatus, getRequestByTmdb } from '@/lib/requests/monitor'
import { findSeasonPack, findArcPack, findCoveringPacks } from '@/lib/automation/grabber'
import { getSeasonEpisodeNumbers } from '@/lib/media-server/tmdb'
import { getClient } from '@/lib/download-client/registry'
import { getDb } from '@/lib/db/index'
import type { QualityProfile } from '@/lib/automation/types'

export const dynamic = 'force-dynamic'

const ANY_PROFILE: QualityProfile = { id: 0, name: 'Any', conditions: '[]' }

type Episode = { s: number; e: number }
type ArcInput = { name: string; episodes: Episode[] }

// Sanitize a client-supplied arc payload (admin-gated, but still shape-check before use).
function parseArc(raw: unknown): ArcInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { name?: unknown; episodes?: unknown }
  if (typeof r.name !== 'string' || !Array.isArray(r.episodes)) return null
  const episodes = r.episodes
    .filter((x): x is Episode => !!x && typeof (x as Episode).s === 'number' && typeof (x as Episode).e === 'number')
    .map((x) => ({ s: x.s, e: x.e }))
  if (episodes.length === 0) return null
  return { name: r.name.slice(0, 120), episodes }
}

type GrabScope =
  | { type: 'seasons'; seasons: number[]; label?: string }
  | { type: 'episodes'; episodes: Episode[]; label?: string }

// Create or update the media_requests row for an admin grab so it shows on the Requests page with
// the exact scope that was grabbed (season number, or arc episodes + label). Merges into an existing
// row for the same show rather than dropping a second grab. Never throws — a failed requests-row
// write must not fail the grab itself.
function recordGrabRequest(
  userId: string,
  tmdbId: number,
  title: string,
  year: number | undefined,
  scope: GrabScope,
): void {
  try {
    const existing = getRequestByTmdb(userId, tmdbId, 'tv') as
      | { id: number; scope_seasons?: string | null; scope_episodes?: string | null; scope_label?: string | null }
      | undefined

    if (existing) {
      if (scope.type === 'seasons') {
        let seasons: number[] = []
        try { if (existing.scope_seasons) seasons = JSON.parse(existing.scope_seasons) as number[] } catch {}
        for (const n of scope.seasons) if (!seasons.includes(n)) seasons.push(n)
        seasons.sort((a, b) => a - b)
        getDb().prepare('UPDATE media_requests SET scope_type = ?, scope_seasons = ?, updated_at = ? WHERE id = ?')
          .run('seasons', JSON.stringify(seasons), Date.now(), existing.id)
      } else {
        let eps: Episode[] = []
        try { if (existing.scope_episodes) eps = JSON.parse(existing.scope_episodes) as Episode[] } catch {}
        const key = (x: Episode) => `${x.s}:${x.e}`
        const have = new Set(eps.map(key))
        for (const ep of scope.episodes) if (!have.has(key(ep))) { eps.push(ep); have.add(key(ep)) }
        // Merge arc labels (distinct, comma-joined) so "Impel Down" + "Marineford" both show.
        const labels = new Set((existing.scope_label ?? '').split(', ').map((s) => s.trim()).filter(Boolean))
        if (scope.label) labels.add(scope.label)
        getDb().prepare('UPDATE media_requests SET scope_type = ?, scope_episodes = ?, scope_label = ?, updated_at = ? WHERE id = ?')
          .run('episodes', JSON.stringify(eps), labels.size ? [...labels].join(', ') : null, Date.now(), existing.id)
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
      ...(scope.type === 'seasons'
        ? { scopeType: 'seasons' as const, scopeSeasons: scope.seasons }
        : { scopeType: 'episodes' as const, scopeEpisodes: scope.episodes, scopeLabel: scope.label ?? null }),
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
    arc?: unknown
    language?: string
    qualityProfileId?: number
    mode?: 'auto' | 'episodes'
    override?: { magnetUrl?: string; downloadUrl?: string; title?: string; indexerName?: string; infoHash?: string }
  } | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const { tmdbId, title, year } = body
  const language = body.language || 'any'
  const mode = body.mode === 'episodes' ? 'episodes' : 'auto'
  const arc = parseArc(body.arc)
  const seasonNumber = typeof body.seasonNumber === 'number' ? body.seasonNumber : undefined

  if (typeof tmdbId !== 'number' || !title) {
    return NextResponse.json({ error: 'tmdbId and title are required' }, { status: 400 })
  }
  if (!arc && (seasonNumber === undefined || seasonNumber < 1)) {
    return NextResponse.json({ error: 'Either seasonNumber or arc is required' }, { status: 400 })
  }

  // Default to profile id=1 (the seeded "Any" profile); fall back to a transient Any if it's gone.
  const profile = getProfileById(body.qualityProfileId ?? 1) ?? ANY_PROFILE
  const profileId = profile.id || 1

  // Scope descriptor shared by createItem / recordGrabRequest for whichever target was chosen.
  const itemScope = arc
    ? { scope_type: 'episodes' as const, scope_episodes: arc.episodes, scope_label: arc.name }
    : { scope_type: 'seasons' as const, scope_seasons: [seasonNumber!] }
  const reqScope: GrabScope = arc
    ? { type: 'episodes', episodes: arc.episodes, label: arc.name }
    : { type: 'seasons', seasons: [seasonNumber!] }

  try {
    // --- Interactive override: admin chose a specific release from the candidate list. -----------
    if (body.override) {
      const url = (body.override.magnetUrl || body.override.downloadUrl || '').trim()
      if (!/^(magnet:\?|https?:\/\/)/i.test(url)) {
        return NextResponse.json({ error: 'Override URL must be a magnet link or http(s) URL' }, { status: 400 })
      }
      await getClient().addTorrent({ urls: url, category: 'tv' })
      const item = createItem({
        type: 'tv', title, tmdb_id: tmdbId, year: year ?? undefined,
        quality_profile_id: profileId, monitor_future: false, language, ...itemScope,
      })
      recordGrab({ item_id: item.id, indexer: body.override.indexerName ?? 'manual', release_title: body.override.title ?? 'manual override', info_hash: body.override.infoHash ?? '' })
      updateItem(item.id, { status: 'grabbed' })
      recordGrabRequest(session.userId, tmdbId, title, year, reqScope)
      return NextResponse.json({ result: 'grabbed', release: { title: body.override.title ?? 'manual override', indexer: body.override.indexerName ?? 'manual' } })
    }

    // --- Episode fan-out (Regression 1: prefer packs, fan out singles only for gaps). -------------
    if (mode === 'episodes') {
      const episodes: Episode[] = arc
        ? arc.episodes
        : (await getSeasonEpisodeNumbers(tmdbId, seasonNumber!)).map((e) => ({ s: seasonNumber!, e }))
      if (episodes.length === 0) {
        return NextResponse.json({ error: 'No episodes found for this scope on TMDB' }, { status: 404 })
      }

      // 1. Prefer packs: grab covering pack(s) first so we never fan out per-episode torrents for
      //    episodes a pack already contains. Each chosen pack becomes its own 'grabbed' monitored
      //    item (distinct scope_key) so the importer can locate every pack by its own info_hash.
      const { chosen, covered } = await findCoveringPacks(title, episodes, profile, language)
      let packsGrabbed = 0
      for (const { release: pack, covers } of chosen) {
        try {
          await getClient().addTorrent({ urls: pack.magnetUrl || pack.downloadUrl, category: 'tv' })
          const coveredEps = episodes.filter((ep) => covers.includes(ep.e))
          const item = createItem({
            type: 'tv', title, tmdb_id: tmdbId, year: year ?? undefined,
            quality_profile_id: profileId, monitor_future: false, language,
            scope_type: 'episodes', scope_episodes: coveredEps, scope_label: arc?.name ?? null,
          })
          recordGrab({ item_id: item.id, indexer: pack.indexerName, release_title: pack.title, info_hash: pack.infoHash })
          updateItem(item.id, { status: 'grabbed' })
          packsGrabbed++
        } catch (err) {
          const m = err instanceof Error ? err.message : String(err)
          process.stderr.write(`[grab/season] ${title.replace(/[\r\n]/g, ' ')} pack "${pack.title.replace(/[\r\n]/g, ' ')}": ${m}\n`)
        }
      }

      // 2. Fan out one 'wanted' item per UNCOVERED episode; the 5-min cron grabs each single.
      const gaps = episodes.filter((ep) => !covered.has(ep.e))
      let queued = 0
      const failed: Episode[] = []
      for (const ep of gaps) {
        try {
          createItem({
            type: 'tv', title, tmdb_id: tmdbId, year: year ?? undefined,
            quality_profile_id: profileId, monitor_future: false, language,
            scope_type: 'episodes', scope_episodes: [ep], scope_label: arc?.name ?? null,
          })
          queued++
        } catch (err) {
          failed.push(ep)
          const msg = err instanceof Error ? err.message : String(err)
          process.stderr.write(`[grab/season] ${title.replace(/[\r\n]/g, ' ')} S${ep.s}E${ep.e}: createItem failed: ${msg}\n`)
        }
      }

      recordGrabRequest(session.userId, tmdbId, title, year, reqScope)
      // status:'scheduled' makes it explicit that the GAP singles were queued for SEARCH, not
      // downloaded; packsGrabbed/coveredByPacks report the packs that ARE downloading now.
      return NextResponse.json({
        result: 'episodes_queued',
        status: 'scheduled',
        packsGrabbed,
        coveredByPacks: covered.size,
        queued,
        failed: failed.length,
        total: episodes.length,
      })
    }

    // --- Auto: one-shot pack search (season pack, or arc range pack). -----------------------------
    const pack = arc
      ? await findArcPack(title, arc.episodes, profile, language)
      : await findSeasonPack(title, seasonNumber!, profile, language)
    if (!pack) {
      const episodeCount = arc ? arc.episodes.length : (await getSeasonEpisodeNumbers(tmdbId, seasonNumber!).catch(() => [])).length
      return NextResponse.json({ result: 'no_pack', seasonNumber: seasonNumber ?? null, episodeCount })
    }
    await getClient().addTorrent({ urls: pack.magnetUrl || pack.downloadUrl, category: 'tv' })
    const item = createItem({
      type: 'tv', title, tmdb_id: tmdbId, year: year ?? undefined,
      quality_profile_id: profileId, monitor_future: false, language, ...itemScope,
    })
    recordGrab({ item_id: item.id, indexer: pack.indexerName, release_title: pack.title, info_hash: pack.infoHash })
    updateItem(item.id, { status: 'grabbed' })
    recordGrabRequest(session.userId, tmdbId, title, year, reqScope)
    return NextResponse.json({
      result: 'pack_grabbed',
      release: { title: pack.title, indexer: pack.indexerName, size: pack.size, seeders: pack.seeders },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const scopeLabel = arc ? `arc ${arc.name}` : `S${seasonNumber}`
    process.stderr.write(`[grab/season] ${title.replace(/[\r\n]/g, ' ')} ${scopeLabel} (${mode}): ${msg}\n`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
