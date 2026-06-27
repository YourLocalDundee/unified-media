/**
 * Stalled-torrent reaper (Regression 2 + stall detection / retry-to-next-candidate).
 *
 * A grabbed torrent can strand its monitored_item in status='grabbed' forever in two ways:
 *
 *   1. METADATA STALL — stuck in metaDL/forcedMetaDL with no peers. No data is ever written, so
 *      neither importer fallback (already-in-library by tmdb_id, completed-file-by-title) can
 *      rescue it. (The original reaper handled the delete+blocklist but NOT the item reset.)
 *   2. DOWNLOAD STALL — started downloading then stuck in stalledDL, or dropped into error /
 *      missingFiles. Again the item never imports and never retries another release.
 *
 * For BOTH classes the reaper now: blocklists the failed hash (so the gate-chain excludes it from
 * the next search — gates.ts), removes the torrent via the DownloadClient interface, and resets the
 * linked monitored_item back to 'wanted' so the next grab tick re-searches and grabs the next-best
 * candidate. A per-item retry ceiling (reaper_max_grab_attempts, default 3) stops the
 * search -> grab -> stall -> reap -> re-search loop by parking the item at terminal 'failed' once a
 * title has had that many releases fail, surfacing it to the admin instead of looping silently.
 *
 * Deliberately conservative — it never reaps a torrent that is making progress:
 *   - metadata class: ONLY metaDL/forcedMetaDL, ONLY 0 seeds AND 0 leechers, ONLY older than
 *     reaper_metadata_minutes (default 60). Unchanged. Reaped even when no monitored_item is linked
 *     (preserves the original pile-up cleanup contract).
 *   - download stall class: ONLY a torrent linked to a still-'grabbed' monitored_item, ONLY in
 *     stalledDL / error / missingFiles, ONLY older than reaper_stall_minutes (default 120) measured
 *     from the LATER of grab_history.grabbed_at and qBit added_on. A 'downloading'/'forcedDL' torrent
 *     (actively moving, however slowly) never reaches this branch, and a completed/seeding torrent is
 *     in an UP state, so the importer's un-stick fallbacks are never disturbed.
 *
 * qBit access — the read stays a single raw qbitFetch because the normalized DownloadClient.Torrent
 * omits peer counts and collapses stalledDL+stalledUP into one bucket, both of which this needs. No
 * NEW raw qbitFetch call is added; the destructive delete goes through DownloadClient.deleteTorrents.
 *
 * Called every 10 minutes by scheduler.ts (dynamic import keeps the qBit session module out of the
 * initial server module graph). Non-fatal per item: one bad item logs and the loop continues.
 */

import { getDb } from '@/lib/db/index'
import { getSetting } from '@/lib/settings'
import { getClient } from '@/lib/download-client/registry'
import { updateItem } from './monitor'
import { addToBlocklist } from './gates'

const REAPER_SETTING_KEY = 'reaper_metadata_minutes'
const DEFAULT_REAPER_MINUTES = 60
const STALL_SETTING_KEY = 'reaper_stall_minutes'
const DEFAULT_STALL_MINUTES = 120
const MAX_ATTEMPTS_SETTING_KEY = 'reaper_max_grab_attempts'
const DEFAULT_MAX_GRAB_ATTEMPTS = 3

function positiveIntSetting(key: string, def: number): number {
  const raw = parseInt(getSetting(key, String(def)), 10)
  return Number.isFinite(raw) && raw > 0 ? raw : def
}

/** metaDL/forcedMetaDL 0-peer age threshold in minutes. */
export function getReaperThresholdMinutes(): number {
  return positiveIntSetting(REAPER_SETTING_KEY, DEFAULT_REAPER_MINUTES)
}

/** stalledDL/error/missingFiles age threshold in minutes for a grabbed download. */
export function getStallThresholdMinutes(): number {
  return positiveIntSetting(STALL_SETTING_KEY, DEFAULT_STALL_MINUTES)
}

/** Per-title grab attempt ceiling before an item is parked at terminal 'failed'. */
export function getMaxGrabAttempts(): number {
  return positiveIntSetting(MAX_ATTEMPTS_SETTING_KEY, DEFAULT_MAX_GRAB_ATTEMPTS)
}

interface ReapTorrent {
  hash: string
  name: string
  state: string
  added_on: number   // unix SECONDS
  num_seeds: number
  num_leechs: number
  progress: number   // 0.0-1.0
}

// Hard-error states: a torrent here cannot recover on its own, so it is reaped past the stall
// threshold regardless of how far it got (the partial data is abandoned with a torrent-only delete).
const HARD_ERROR_STATES = new Set(['error', 'missingFiles'])

interface ReapTarget {
  torrent: ReapTorrent
  reason: string
}

export async function reapStalledTorrents(): Promise<number> {
  const metaThresholdMs = getReaperThresholdMinutes() * 60 * 1000
  const stallThresholdMs = getStallThresholdMinutes() * 60 * 1000
  const maxAttempts = getMaxGrabAttempts()
  const db = getDb()

  let torrents: ReapTorrent[]
  try {
    const { qbitFetch } = await import('@/lib/qbittorrent/session')
    torrents = await qbitFetch<ReapTorrent[]>('/api/v2/torrents/info')
  } catch (err) {
    process.stderr.write(`[reaper] qBittorrent unavailable: ${err instanceof Error ? err.message : String(err)}\n`)
    return 0
  }

  // Map lowercased info_hash -> the still-'grabbed' monitored_item it belongs to (latest grab per
  // item). Only these items get reset/failed; an item that already imported is not 'grabbed', so a
  // completed torrent (UP states / departed) is never reaped and the importer fallbacks are safe.
  type GrabbedRow = { item_id: number; info_hash: string; grabbed_at: number }
  const grabbedRows = db
    .prepare(`
      SELECT gh.item_id, gh.info_hash, gh.grabbed_at
      FROM grab_history gh
      INNER JOIN (
        SELECT item_id, MAX(grabbed_at) AS latest FROM grab_history GROUP BY item_id
      ) last ON gh.item_id = last.item_id AND gh.grabbed_at = last.latest
      INNER JOIN monitored_items mi ON mi.id = gh.item_id
      WHERE mi.status = 'grabbed'
    `)
    .all() as GrabbedRow[]

  const grabbedByHash = new Map<string, { itemId: number; grabbedAt: number }>()
  for (const r of grabbedRows) {
    if (r.info_hash) grabbedByHash.set(r.info_hash.toLowerCase(), { itemId: r.item_id, grabbedAt: r.grabbed_at })
  }

  const now = Date.now()
  const targets: ReapTarget[] = []

  for (const t of torrents) {
    const addedMs = typeof t.added_on === 'number' && t.added_on > 0 ? t.added_on * 1000 : 0
    const seeds = t.num_seeds ?? 0
    const leechs = t.num_leechs ?? 0

    // Class 1 (unchanged): metadata stuck with zero peers past the metadata threshold.
    if (
      (t.state === 'metaDL' || t.state === 'forcedMetaDL') &&
      seeds === 0 &&
      leechs === 0 &&
      addedMs > 0 &&
      now - addedMs > metaThresholdMs
    ) {
      targets.push({ torrent: t, reason: 'reaped: stalled metadata, 0 peers' })
      continue
    }

    // Class 2 (new): a grabbed download that stalled or errored. Gated on a live 'grabbed' link so a
    // manual download or a healthy seed is never touched; 'downloading'/'forcedDL' never reach here.
    const link = grabbedByHash.get(t.hash.toLowerCase())
    if (!link) continue

    const isHardError = HARD_ERROR_STATES.has(t.state)
    const isStalledDownload = t.state === 'stalledDL'
    if (!isHardError && !isStalledDownload) continue

    // Conservative age — require BOTH our grab time and qBit's add time older than the threshold
    // (start from the LATER of the two), so a freshly grabbed torrent is never reaped early.
    const start = Math.max(link.grabbedAt, addedMs)
    if (now - start <= stallThresholdMs) continue

    targets.push({
      torrent: t,
      reason: isHardError ? `reaped: ${t.state} (download error)` : 'reaped: stalled download, no progress',
    })
  }

  if (targets.length === 0) return 0

  // Resolve the download client once. If the configured client is unimplemented, there is nothing to
  // delete — log and bail rather than throwing per item.
  let client
  try {
    client = getClient()
  } catch (err) {
    process.stderr.write(`[reaper] download client unavailable: ${err instanceof Error ? err.message : String(err)}\n`)
    return 0
  }

  let reaped = 0
  for (const { torrent: t, reason } of targets) {
    const safeName = t.name.replace(/[\r\n]/g, ' ')
    try {
      // Blocklist first (idempotent, local) so the failed release is gated out of the next search
      // even if the qBit delete momentarily fails. Then remove the torrent via the DownloadClient
      // interface — torrent-only (deleteFiles=false), the partial/zero data is abandoned.
      addToBlocklist(t.hash, safeName, reason)
      await client.deleteTorrents([t.hash], false)

      const link = grabbedByHash.get(t.hash.toLowerCase())
      if (link) {
        // Each successful grab wrote one grab_history row, so the row count is how many distinct
        // releases this item has tried. At/above the ceiling, stop re-searching (terminal 'failed').
        const attempts = (
          db.prepare('SELECT COUNT(*) AS n FROM grab_history WHERE item_id = ?').get(link.itemId) as { n: number }
        ).n

        if (attempts >= maxAttempts) {
          updateItem(link.itemId, { status: 'failed' })
          process.stderr.write(
            `[reaper] item ${link.itemId} "${safeName}" hit max grab attempts (${attempts}/${maxAttempts}) — marked 'failed', no further auto-search\n`,
          )
        } else {
          // Re-searchable again — the blocklist gate guarantees the next-best candidate is chosen.
          updateItem(link.itemId, { status: 'wanted' })
          process.stderr.write(
            `[reaper] item ${link.itemId} "${safeName}" reset to 'wanted' for re-search (attempt ${attempts}/${maxAttempts}); ${reason}\n`,
          )
        }
      } else {
        process.stderr.write(`[reaper] removed "${safeName}" (${t.hash}) — ${reason}; blocklisted\n`)
      }
      reaped++
    } catch (err) {
      // Non-fatal per item — log and continue. The item stays 'grabbed' and is retried next tick;
      // the (idempotent) blocklist entry already prevents a re-grab of this hash.
      process.stderr.write(
        `[reaper] failed to reap "${safeName}" (${t.hash}): ${err instanceof Error ? err.message : String(err)}\n`,
      )
    }
  }

  return reaped
}
