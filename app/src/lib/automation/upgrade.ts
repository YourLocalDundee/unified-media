/**
 * Upgrade-until-cutoff (mining Tier-2 #5).
 *
 * Once an item is imported, if its quality profile has `upgrade_allowed=1` and the grabbed release is
 * still BELOW the profile cutoff, the upgrade scan keeps looking for a better release and replaces the
 * file when one is found. Once a release meets/exceeds the cutoff the item is "good enough" and left
 * alone — EXCEPT for a PROPER/REPACK, which replaces an at-cutoff copy too (Sonarr's "prefer and
 * upgrade propers"), bounded to PROPER_WINDOW_MS after the grab. "Better" and "cutoff" use the same
 * two-key ordering as Sonarr: quality-tier weight first, then custom-format score (so proper/repack/
 * HDR/etc. format bumps drive same-tier upgrades); proper/repack revision is also matched directly.
 *
 * v1 scope: MOVIES only. A movie is a single file, so replacement is a clean swap — `media_items` is
 * keyed by `file_path`, so the upgrade's new path is a DISTINCT row and the old row/file can be deleted
 * with zero risk to the new one. TV season-pack upgrades are multi-file (partial overlaps, mixed
 * episodes) and are deferred — see CLAUDE.md §19.
 *
 * Two phases, decoupled so a failed upgrade download never deletes the existing copy:
 *   1. scanForUpgrades()  — finds below-cutoff movies, grabs a strictly-better release, records the old
 *                           hash + old file paths in `pending_upgrades` (status 'pending'). Nothing is
 *                           deleted here.
 *   2. completeUpgrades() — once the upgrade has imported (a NEW media_items path appears for the tmdb),
 *                           deletes the OLD torrent (download client, with files) and the OLD library
 *                           file(s), then marks the row 'completed'. Old paths are only ever removed
 *                           after the new path is confirmed present.
 */

import fs from 'fs'
import { getDb } from '@/lib/db/index'
import { getClient } from '@/lib/download-client/registry'
import { searchAllIndexers } from '@/lib/indexer/index'
import { buildSearchParams, filterByScope, findBestRelease } from './grabber'
import { partitionByGates, loadBlocklist } from './gates'
import { scoreWithProfile, getProfileFull } from './quality'
import { getProfileById, recordGrab, updateItem } from './monitor'
import type { MonitoredItem } from './types'

// Don't re-grab an upgrade that has been pending (downloading) for too long — park it as 'failed' so it
// stops blocking future scans of that item. The old file is left untouched (never deleted on failure).
const PENDING_UPGRADE_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// Cap items scanned per run so a large library doesn't hammer indexers in one tick.
const DEFAULT_SCAN_LIMIT = 25
// PROPER/REPACK window: an item that already MEETS cutoff is normally left alone, but a PROPER or
// REPACK (a re-release fixing a broken encode) should still replace it — Sonarr's "prefer and upgrade
// propers". Bounded in time because propers surface within days of the original release, so we only
// keep searching at-cutoff items for this long after the grab; otherwise every at-cutoff movie would
// hit the indexers on every scan forever. Below-cutoff quality upgrades are NOT time-bounded.
const PROPER_WINDOW_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * Revision level of a release from PROPER/REPACK markers: 0 = original, 1 = a single proper/repack,
 * higher for numbered re-releases (PROPER2, REPACK3) and version tags (v2 = 1, v3 = 2). A candidate
 * with a strictly higher revision than the current copy at the same-or-better quality tier is a
 * proper upgrade even when the current copy already meets cutoff.
 */
export function revisionLevel(title: string): number {
  const t = title.toLowerCase()
  let level = 0
  const markers = t.match(/\b(?:proper|repack)(\d*)\b/g)
  if (markers) {
    for (const tok of markers) {
      const n = parseInt(tok.replace(/\D/g, ''), 10)
      level += Number.isFinite(n) && n > 1 ? n : 1
    }
  }
  const v = t.match(/\bv(\d)\b/)
  if (v) level = Math.max(level, parseInt(v[1], 10) - 1) // v2 -> revision 1
  return level
}

export interface QualitySnapshot {
  tierWeight: number
  formatScore: number
}

function snapshotFor(title: string, profileId: number, sizeBytes?: number): QualitySnapshot {
  const r = scoreWithProfile(title, profileId, sizeBytes)
  return { tierWeight: r.qualityTierWeight, formatScore: r.totalScore }
}

function cutoffSnapshot(cutoffQualityId: number | null, cutoffFormatScore: number): QualitySnapshot {
  let tierWeight = 0
  if (cutoffQualityId != null) {
    const row = getDb()
      .prepare('SELECT weight FROM quality_tiers WHERE id = ?')
      .get(cutoffQualityId) as { weight: number } | undefined
    tierWeight = row?.weight ?? 0
  }
  return { tierWeight, formatScore: cutoffFormatScore }
}

/** Current quality is at/above cutoff → no upgrade wanted. Tier weight first, then format score. */
export function meetsCutoff(current: QualitySnapshot, cutoff: QualitySnapshot): boolean {
  if (current.tierWeight > cutoff.tierWeight) return true
  if (current.tierWeight === cutoff.tierWeight) return current.formatScore >= cutoff.formatScore
  return false
}

/** Candidate is strictly better than the current release. Tier weight first, then format score. */
export function isUpgrade(candidate: QualitySnapshot, current: QualitySnapshot): boolean {
  if (candidate.tierWeight > current.tierWeight) return true
  if (candidate.tierWeight === current.tierWeight) return candidate.formatScore > current.formatScore
  return false
}

type GrabRow = { release_title: string; info_hash: string; grabbed_at: number }

function latestGrab(itemId: number): GrabRow | undefined {
  return getDb()
    .prepare('SELECT release_title, info_hash, grabbed_at FROM grab_history WHERE item_id = ? ORDER BY grabbed_at DESC LIMIT 1')
    .get(itemId) as GrabRow | undefined
}

function movieFilePaths(tmdbId: number): string[] {
  const rows = getDb()
    .prepare("SELECT file_path FROM media_items WHERE tmdb_id = ? AND type = 'movie' AND file_path IS NOT NULL")
    .all(tmdbId) as { file_path: string }[]
  return rows.map((r) => r.file_path)
}

export interface UpgradeScanResult {
  scanned: number
  upgraded: number
  skipped: number
}

/**
 * Find below-cutoff movie items and grab a strictly-better release for each. Records a pending_upgrades
 * row per grab; completeUpgrades() does the file replacement after the new release imports.
 */
export async function scanForUpgrades(
  opts: { itemId?: number; limit?: number } = {},
): Promise<UpgradeScanResult> {
  const db = getDb()
  const limit = opts.limit ?? DEFAULT_SCAN_LIMIT

  const items = (
    opts.itemId != null
      ? db.prepare("SELECT * FROM monitored_items WHERE id = ? AND type = 'movie' AND status = 'imported'").all(opts.itemId)
      : db
          .prepare(
            // NULLS FIRST so never-scanned items go before stale ones — rotates fairly through the library.
            "SELECT * FROM monitored_items WHERE type = 'movie' AND status = 'imported' AND tmdb_id IS NOT NULL ORDER BY last_upgrade_scan_at ASC NULLS FIRST LIMIT ?",
          )
          .all(limit)
  ) as MonitoredItem[]

  let upgraded = 0
  let skipped = 0

  for (const item of items) {
    try {
      // Advance the rotation cursor for every item we look at (direct column write — don't bump
      // updated_at, which sorts the admin queue).
      db.prepare('UPDATE monitored_items SET last_upgrade_scan_at = ? WHERE id = ?').run(Date.now(), item.id)

      // Skip items that already have an upgrade in flight — never stack two upgrade grabs.
      const inFlight = db
        .prepare("SELECT 1 FROM pending_upgrades WHERE item_id = ? AND status = 'pending' LIMIT 1")
        .get(item.id)
      if (inFlight) { skipped++; continue }

      const profileFull = getProfileFull(item.quality_profile_id)
      if (!profileFull || !profileFull.upgrade_allowed) { skipped++; continue }

      const grab = latestGrab(item.id)
      if (!grab) { skipped++; continue } // imported but no grab record — nothing to compare against

      const current = snapshotFor(grab.release_title, profileFull.id)
      const cutoff = cutoffSnapshot(profileFull.cutoff_quality_id, profileFull.cutoff_format_score)
      const meets = meetsCutoff(current, cutoff)
      // An at-cutoff item is "good enough" for quality, but still eligible for a PROPER/REPACK swap
      // while inside the proper window. Past the window with cutoff met, there is nothing to do.
      const properEligible = Date.now() - grab.grabbed_at <= PROPER_WINDOW_MS
      if (meets && !properEligible) { skipped++; continue }

      // Search + gate-filter exactly like the grab loop.
      const params = buildSearchParams(item)
      const raw = await searchAllIndexers(params)
      const scopeFiltered = filterByScope(raw, item)
      const results = scopeFiltered ?? []
      if (results.length === 0) { skipped++; continue }

      const blocked = loadBlocklist()
      const { passing } = partitionByGates(results, item.type, blocked)

      // Keep upgrade candidates, then auto-pick the healthiest. A candidate qualifies if it is a strict
      // quality/format upgrade (below cutoff only) OR a proper/repack of the same-or-better tier with a
      // higher revision than the current copy (allowed even at cutoff, within the proper window).
      const language = item.language ?? profileFull.language ?? 'any'
      const currentRevision = revisionLevel(grab.release_title)
      const upgrades = passing.filter((r) => {
        const cand = snapshotFor(r.title, profileFull.id, r.size)
        const properUpgrade =
          properEligible &&
          cand.tierWeight >= current.tierWeight &&
          revisionLevel(r.title) > currentRevision
        return meets ? properUpgrade : isUpgrade(cand, current) || properUpgrade
      })
      if (upgrades.length === 0) { skipped++; continue }

      const profile = getProfileById(item.quality_profile_id) ?? { id: profileFull.id, name: profileFull.name, conditions: '[]', delay_minutes: 0 }
      const best = findBestRelease(upgrades, profile, language)
      if (!best) { skipped++; continue } // all upgrade candidates dead (0 seeders)

      // Snapshot the old copy BEFORE grabbing, then grab the upgrade and record the pending replacement.
      const oldPaths = movieFilePaths(item.tmdb_id as number)
      await getClient().addTorrent({ urls: best.magnetUrl || best.downloadUrl, category: item.type })
      const grabbed = recordGrab({
        item_id: item.id,
        indexer: best.indexerName,
        release_title: best.title,
        info_hash: best.infoHash,
        urls: [best.magnetUrl, best.downloadUrl],
      })
      updateItem(item.id, { status: 'grabbed' }) // importer will import the upgrade

      db.prepare(
        `INSERT INTO pending_upgrades
           (item_id, tmdb_id, media_type, old_info_hash, old_file_paths, old_score, new_info_hash, new_release, status, created_at)
         VALUES (?, ?, 'movie', ?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(
        item.id,
        item.tmdb_id,
        grab.info_hash || null,
        JSON.stringify(oldPaths),
        current.tierWeight * 100000 + current.formatScore, // packed snapshot, logging only
        grabbed.info_hash,
        best.title,
        Date.now(),
      )

      console.log(`[upgrade] "${item.title}": grabbing upgrade "${best.title}" (replacing ${oldPaths.length} file(s))`)
      upgraded++
    } catch (err) {
      process.stderr.write(`[upgrade] scan error for "${item.title}": ${err}\n`)
      skipped++
    }
  }

  return { scanned: items.length, upgraded, skipped }
}

type PendingUpgradeRow = {
  id: number
  item_id: number
  tmdb_id: number
  old_info_hash: string | null
  old_file_paths: string
  new_info_hash: string
  created_at: number
}

/**
 * Finish upgrades whose replacement has imported: once a NEW media_items file path exists for the tmdb
 * (distinct from the recorded old paths), delete the old torrent + old file(s) and mark 'completed'.
 * Old paths are only ever removed after the new path is confirmed present, so a failed/slow upgrade
 * never destroys the existing copy. Returns the number completed.
 */
export async function completeUpgrades(): Promise<number> {
  const db = getDb()
  const pending = db
    .prepare("SELECT id, item_id, tmdb_id, old_info_hash, old_file_paths, new_info_hash, created_at FROM pending_upgrades WHERE status = 'pending'")
    .all() as PendingUpgradeRow[]
  if (pending.length === 0) return 0

  let completed = 0

  for (const row of pending) {
    let oldPaths: string[] = []
    try { oldPaths = JSON.parse(row.old_file_paths) as string[] } catch { oldPaths = [] }
    const oldSet = new Set(oldPaths)

    // The item must have re-imported (back to 'imported') and a NEW file path must exist for the tmdb.
    const item = db.prepare("SELECT status FROM monitored_items WHERE id = ?").get(row.item_id) as { status: string } | undefined
    if (!item || item.status !== 'imported') {
      // Still downloading — unless it's been stuck past the TTL, in which case give up (keep old file).
      if (Date.now() - row.created_at > PENDING_UPGRADE_TTL_MS) {
        db.prepare("UPDATE pending_upgrades SET status = 'failed', completed_at = ? WHERE id = ?").run(Date.now(), row.id)
        process.stderr.write(`[upgrade] pending upgrade ${row.id} timed out — old file kept\n`)
      }
      continue
    }

    const currentPaths = movieFilePaths(row.tmdb_id)
    const newPaths = currentPaths.filter((p) => !oldSet.has(p))
    if (newPaths.length === 0) {
      // Imported but the only path(s) are the old one(s) — same-name re-grab overwrote in place; nothing
      // to clean. Still drop the old torrent so the duplicate download isn't left seeding.
      if (row.old_info_hash) {
        try { await getClient().deleteTorrents([row.old_info_hash], true) } catch { /* best effort */ }
      }
      db.prepare("UPDATE pending_upgrades SET status = 'completed', completed_at = ? WHERE id = ?").run(Date.now(), row.id)
      completed++
      continue
    }

    // New file confirmed present → safe to remove the old copy.
    if (row.old_info_hash) {
      try { await getClient().deleteTorrents([row.old_info_hash], true) } catch (e) {
        process.stderr.write(`[upgrade] could not delete old torrent ${row.old_info_hash}: ${e}\n`)
      }
    }
    for (const p of oldPaths) {
      // Only delete a path that is NOT also a current/new path (defensive — should always hold).
      if (currentPaths.includes(p) && !newPaths.includes(p)) {
        try { if (fs.existsSync(p)) fs.unlinkSync(p) } catch (e) {
          process.stderr.write(`[upgrade] could not delete old file ${p}: ${e}\n`)
        }
      }
      const stale = db.prepare('SELECT id FROM media_items WHERE file_path = ?').get(p) as { id: string } | undefined
      if (stale) {
        db.prepare('DELETE FROM media_watch_state WHERE media_id = ?').run(stale.id)
        db.prepare('DELETE FROM media_items WHERE id = ?').run(stale.id)
      }
    }

    db.prepare("UPDATE pending_upgrades SET status = 'completed', completed_at = ? WHERE id = ?").run(Date.now(), row.id)
    console.log(`[upgrade] completed upgrade for item ${row.item_id} — removed ${oldPaths.length} old file(s)`)
    completed++
  }

  return completed
}

// ── admin read helpers ───────────────────────────────────────────────────────

export interface UpgradeRow {
  id: number
  item_id: number
  title: string | null
  new_release: string
  status: string
  created_at: number
  completed_at: number | null
}

export function listUpgrades(limit = 50): UpgradeRow[] {
  return getDb()
    .prepare(
      `SELECT pu.id, pu.item_id, mi.title, pu.new_release, pu.status, pu.created_at, pu.completed_at
         FROM pending_upgrades pu
         LEFT JOIN monitored_items mi ON mi.id = pu.item_id
        ORDER BY pu.created_at DESC
        LIMIT ?`,
    )
    .all(limit) as UpgradeRow[]
}
