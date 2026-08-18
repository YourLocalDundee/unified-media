/**
 * One release per item — the finish-line guard.
 *
 * Hit for real on 2026-08-16: a single request produced two completed downloads of the same film
 * (the hand-picked 1080p release, plus a 4K release the auto-picker chose off the monitored item
 * that request created). The importer takes the LATEST grab row per item, so the release the user
 * had not chosen is the one that landed in the library, and ~14.6GB was spent on one movie.
 *
 * The double dispatch itself is fixed upstream (the approve route now claims the row synchronously
 * before firing the preferred grab, and POST /api/grab/confirm refuses to grab an item that already
 * has one in flight). This module is the guard that still holds when a race gets past that: before
 * the importer places anything, an item with more than one COMPLETED download keeps exactly one and
 * deletes the rest with their data.
 *
 * Selection order (pickWinner below):
 *   1. an explicit user pick always wins outright
 *   2. quality-profile match — the profile's conditions
 *   3. language / audio_mode preference, when one is set
 *   4. name proximity to the item's title + year
 *   5. custom-format (additive) score
 *   6. seeders, then the earliest grab as a deterministic final tiebreak
 * A profile with no conditions ("Any", id 1 — the profile in play during the incident) scores every
 * candidate 0 at step 2, so ranking FALLS THROUGH to the later keys rather than treating the
 * candidates as equally valid. That absence of conditions is what made the duplicate invisible.
 *
 * Two safety rules that must hold:
 *   - A torrent whose content already sits inside a MEDIA_ROOT is never a candidate. The importer's
 *     primary path is setLocation, i.e. the torrent's data IS the library file once imported —
 *     deleting one "with data" would delete the library copy. Only torrents still in the download
 *     tree can be deduped.
 *   - An item with a pending upgrade is skipped entirely. Two releases in flight is exactly what
 *     upgrade.ts means to do there, and completeUpgrades() owns removing the old one.
 *
 * Losers are NOT blocklisted: they are healthy releases that merely lost a ranking, and blocklisting
 * would gate them out of a future upgrade scan.
 *
 * Called at the top of runImportCheck() (every 2 minutes) so resolution always happens before
 * placement, never after.
 */

import path from 'path'
import { getDb } from '@/lib/db/index'
import { getClient } from '@/lib/download-client/registry'
import { getProfileById } from './monitor'
import { parseAudioMode, parseLanguage, parseReleaseName, scoreReleaseSoft } from './parser'
import { scoreWithProfile } from './quality'
import type { MonitoredItem, QualityCondition } from './types'

// Same library roots the scanner indexes and the importer places into — see the safety rule above.
const MEDIA_ROOTS = (process.env.MEDIA_ROOTS ?? '')
  .split(':')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p))

// UMT states that mean "download is complete, file is fully written" — kept identical to the
// importer's list, because this guard decides between releases the importer is about to place.
const COMPLETE_STATES = new Set([
  'uploading',
  'stalledUP',
  'forcedUP',
  'pausedUP',
  'stoppedUP',
  'queuedUP',
  'checkingUP',
])

const sanitizeLog = (s: string) => s.replace(/[\r\n]/g, ' ')

// ---------------------------------------------------------------------------
// Ranking (pure — no DB, no client, no I/O; formatScore is supplied by the caller)
// ---------------------------------------------------------------------------

export interface DuplicateCandidate {
  infoHash: string
  releaseTitle: string
  seeders: number
  grabbedAt: number
  /** scoreWithProfile(...).totalScore for this release under the item's profile. */
  formatScore: number
}

export interface DuplicateContext {
  title: string
  year: number | null
  /** Parsed profile conditions; empty for an "Any" profile, which then falls through. */
  conditions: QualityCondition[]
  /** ISO 639-1 code or 'any'. */
  language: string
  /** 'any' | 'dub' | 'sub'. */
  audioMode: string
  /** infoHash of the release the user explicitly picked, if this item came from such a request. */
  pickedHash: string | null
  /** Release title of that same pick — the fallback when the pick carried no usable hash. */
  pickedTitle: string | null
}

/** Lowercase, punctuation → spaces, collapse runs. Shared by the pick match and name proximity. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[._\-[\]()]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUserPick(c: DuplicateCandidate, ctx: DuplicateContext): boolean {
  if (ctx.pickedHash && c.infoHash && ctx.pickedHash.toLowerCase() === c.infoHash.toLowerCase()) return true
  // A magnet/URL add can reach grab_history without ever surfacing a hash; the release title the
  // user picked is then the only identity both sides share.
  if (ctx.pickedTitle && normalise(ctx.pickedTitle) === normalise(c.releaseTitle)) return true
  return false
}

/**
 * Fraction (0..1) of the item's title+year tokens present in the release name. Tokens shorter than
 * two characters are dropped as noise. 0 for every candidate when the item has no usable title,
 * which makes this key non-discriminating rather than arbitrary.
 */
export function nameProximity(releaseTitle: string, title: string, year: number | null): number {
  const tokens = normalise(`${title} ${year ?? ''}`)
    .split(' ')
    .filter((t) => t.length >= 2)
  if (tokens.length === 0) return 0
  const hay = normalise(releaseTitle)
  const hits = tokens.filter((t) => hay.includes(t)).length
  return hits / tokens.length
}

/** Count of the SET preferences this release satisfies. 'any' counts for nobody, so it ties out. */
function preferenceMatches(c: DuplicateCandidate, ctx: DuplicateContext): number {
  let n = 0
  if (ctx.language !== 'any' && parseLanguage(c.releaseTitle) === ctx.language) n += 1
  if (ctx.audioMode !== 'any') {
    const detected = parseAudioMode(c.releaseTitle)
    // Untagged is not a mismatch (many legitimate dubs ship with no tag) but it is not a match
    // either — mirrors audioModePenalty's soft treatment in grabber.ts.
    if (detected === ctx.audioMode) n += 1
  }
  return n
}

/** Ordered ranking keys, highest wins on the first key that differs. */
function rankKeys(c: DuplicateCandidate, ctx: DuplicateContext): number[] {
  const meta = parseReleaseName(c.releaseTitle)
  // An empty condition list scores 0 for everyone — the deliberate fall-through for "Any".
  const conditionScore = ctx.conditions.length > 0 ? scoreReleaseSoft(meta, ctx.conditions) : 0
  return [
    isUserPick(c, ctx) ? 1 : 0,
    conditionScore,
    preferenceMatches(c, ctx),
    nameProximity(c.releaseTitle, ctx.title, ctx.year),
    c.formatScore,
    c.seeders,
  ]
}

/**
 * The single release to keep. Never returns undefined for a non-empty list: ties fall through to
 * the earliest grab (and then the hash) so the same input always resolves the same way.
 */
export function pickWinner(
  candidates: DuplicateCandidate[],
  ctx: DuplicateContext,
): DuplicateCandidate | undefined {
  if (candidates.length === 0) return undefined

  return [...candidates].sort((a, b) => {
    const ka = rankKeys(a, ctx)
    const kb = rankKeys(b, ctx)
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i]
    }
    if (a.grabbedAt !== b.grabbedAt) return a.grabbedAt - b.grabbedAt
    return a.infoHash.localeCompare(b.infoHash)
  })[0]
}

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------

type GrabRow = {
  id: number
  item_id: number
  info_hash: string
  release_title: string
  grabbed_at: number
}

// Raw UMT torrent fields this guard needs. save_path/content_path are absent from the normalized
// DownloadClient.Torrent, and both are needed for the "already in the library" safety rule, so the
// read is a raw qbitFetch (same convention as reaper.ts); the destructive delete goes through
// DownloadClient.deleteTorrents.
interface RawTorrent {
  hash: string
  state: string
  progress: number
  size?: number
  num_seeds?: number
  num_complete?: number
  save_path?: string
  content_path?: string
}

/** True when the torrent's data lives inside a configured library root (i.e. it already imported). */
function isInLibrary(t: RawTorrent): boolean {
  const paths = [t.content_path, t.save_path].filter((p): p is string => !!p).map((p) => path.resolve(p))
  return paths.some((p) => MEDIA_ROOTS.some((root) => p === root || p.startsWith(root + path.sep)))
}

export interface DuplicateResolution {
  itemId: number
  itemTitle: string
  kept: { infoHash: string; releaseTitle: string }
  removed: Array<{ infoHash: string; releaseTitle: string; deleted: boolean }>
}

/**
 * Keep exactly one completed release per monitored item, delete the rest with their data.
 * Returns one entry per item that actually had a duplicate to resolve.
 */
export async function resolveDuplicateGrabs(): Promise<DuplicateResolution[]> {
  // Without MEDIA_ROOTS there is no way to tell a download apart from a library copy, and the "never
  // delete data that is already the library file" rule below depends entirely on that comparison.
  // The importer can't place anything in this state either (buildTargetPath returns undefined), so
  // resolving nothing here costs nothing.
  if (MEDIA_ROOTS.length === 0) return []

  const db = getDb()

  // Only items the importer is about to act on. An 'imported' item's extra release is either the
  // upgrade path's business or already in the library, and neither is this guard's to touch.
  const items = db
    .prepare("SELECT * FROM monitored_items WHERE status = 'grabbed'")
    .all() as MonitoredItem[]
  if (items.length === 0) return []

  const rowsByItem = new Map<number, GrabRow[]>()
  const grabRows = db
    .prepare(
      `SELECT id, item_id, info_hash, release_title, grabbed_at
         FROM grab_history
        WHERE superseded_at IS NULL AND info_hash <> ''
          AND item_id IN (${items.map(() => '?').join(',')})`,
    )
    .all(...items.map((i) => i.id)) as GrabRow[]

  for (const row of grabRows) {
    const list = rowsByItem.get(row.item_id) ?? []
    list.push(row)
    rowsByItem.set(row.item_id, list)
  }

  // Candidate items: more than one distinct hash recorded, and no upgrade in flight.
  const contested = items.filter((item) => {
    const rows = rowsByItem.get(item.id) ?? []
    if (new Set(rows.map((r) => r.info_hash.toLowerCase())).size < 2) return false
    const upgrading = db
      .prepare("SELECT 1 FROM pending_upgrades WHERE item_id = ? AND status = 'pending' LIMIT 1")
      .get(item.id)
    return !upgrading
  })
  if (contested.length === 0) return []

  const allHashes = [
    ...new Set(contested.flatMap((i) => (rowsByItem.get(i.id) ?? []).map((r) => r.info_hash.toLowerCase()))),
  ]

  let torrents: RawTorrent[]
  try {
    const { qbitFetch } = await import('@/lib/qbittorrent/session')
    torrents = await qbitFetch<RawTorrent[]>(`/api/v2/torrents/info?hashes=${allHashes.join('|')}`)
  } catch (err) {
    // UMT unavailable — resolve nothing this tick rather than guessing. The importer's own UMT
    // call is about to fail the same way, so nothing is placed either.
    process.stderr.write(`[dedupe] UMT unavailable: ${err instanceof Error ? err.message : String(err)}\n`)
    return []
  }

  const byHash = new Map<string, RawTorrent>()
  for (const t of torrents) byHash.set(t.hash.toLowerCase(), t)

  let client
  try {
    client = getClient()
  } catch (err) {
    process.stderr.write(
      `[dedupe] download client unavailable: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    return []
  }

  const resolutions: DuplicateResolution[] = []

  for (const item of contested) {
    const rows = rowsByItem.get(item.id) ?? []

    // One row per hash (the earliest grab of it), keeping only completed downloads that are still
    // in the download tree.
    const byInfoHash = new Map<string, GrabRow>()
    for (const row of rows) {
      const key = row.info_hash.toLowerCase()
      const torrent = byHash.get(key)
      if (!torrent) continue // departed from the client — nothing to keep or delete
      if (!COMPLETE_STATES.has(torrent.state) && torrent.progress < 1.0) continue
      if (isInLibrary(torrent)) continue // already placed — deleting its data would take the library copy
      const existing = byInfoHash.get(key)
      if (!existing || row.grabbed_at < existing.grabbed_at) byInfoHash.set(key, row)
    }
    if (byInfoHash.size < 2) continue // only one release finished — the normal case, nothing to do

    const profile = getProfileById(item.quality_profile_id)
    let conditions: QualityCondition[] = []
    try {
      const parsed = JSON.parse(profile?.conditions ?? '[]')
      if (Array.isArray(parsed)) conditions = parsed
    } catch { conditions = [] }

    // The explicit pick, if this item came from an interactive request.
    const pickRow = db
      .prepare(
        `SELECT preferred_release FROM media_requests
          WHERE tmdb_id = ? AND media_type = ? AND preferred_release IS NOT NULL
          ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(item.tmdb_id, item.type) as { preferred_release: string } | undefined
    let pickedHash: string | null = null
    let pickedTitle: string | null = null
    if (pickRow?.preferred_release) {
      try {
        const picked = JSON.parse(pickRow.preferred_release) as { infoHash?: string; releaseTitle?: string }
        pickedHash = picked.infoHash?.trim() || null
        pickedTitle = picked.releaseTitle?.trim() || null
      } catch { /* malformed column — rank without a pick */ }
    }

    const ctx: DuplicateContext = {
      title: item.title,
      year: item.year ?? null,
      conditions,
      language: item.language ?? 'any',
      audioMode: item.audio_mode ?? 'any',
      pickedHash,
      pickedTitle,
    }

    const candidates: DuplicateCandidate[] = [...byInfoHash.values()].map((row) => {
      const torrent = byHash.get(row.info_hash.toLowerCase())!
      return {
        infoHash: row.info_hash,
        releaseTitle: row.release_title,
        seeders: torrent.num_complete ?? torrent.num_seeds ?? 0,
        grabbedAt: row.grabbed_at,
        // Pass the size so 'size' custom formats can match, exactly as the grabber scores it.
        formatScore: scoreWithProfile(
          row.release_title,
          profile?.id ?? item.quality_profile_id,
          torrent.size,
        ).totalScore,
      }
    })

    const winner = pickWinner(candidates, ctx)
    if (!winner) continue

    const losers = candidates.filter((c) => c.infoHash !== winner.infoHash)
    const removed: DuplicateResolution['removed'] = []

    for (const loser of losers) {
      // Supersede FIRST so the importer has an unambiguous winner even if the delete below fails —
      // an orphaned torrent is a cleanup chore, importing the wrong release is the bug being fixed.
      db.prepare(
        'UPDATE grab_history SET superseded_at = ? WHERE item_id = ? AND lower(info_hash) = lower(?)',
      ).run(Date.now(), item.id, loser.infoHash)

      let deleted = true
      try {
        await client.deleteTorrents([loser.infoHash], true)
      } catch (err) {
        deleted = false
        process.stderr.write(
          `[dedupe] could not delete duplicate ${loser.infoHash} ("${sanitizeLog(loser.releaseTitle)}") — ` +
            `remove it by hand; it is no longer tracked: ${err instanceof Error ? err.message : String(err)}\n`,
        )
      }
      removed.push({ infoHash: loser.infoHash, releaseTitle: loser.releaseTitle, deleted })
    }

    console.log(
      `[dedupe] "${sanitizeLog(item.title)}" had ${candidates.length} completed releases — kept ` +
        `"${sanitizeLog(winner.releaseTitle)}", removed ${losers.length}`,
    )

    resolutions.push({
      itemId: item.id,
      itemTitle: item.title,
      kept: { infoHash: winner.infoHash, releaseTitle: winner.releaseTitle },
      removed,
    })
  }

  return resolutions
}
