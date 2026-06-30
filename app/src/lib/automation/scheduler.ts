/**
 * Automation scheduler: registers the three background cron jobs for the pipeline.
 *
 * Called once from src/instrumentation.ts (Next.js server startup hook).
 * The 'started' guard prevents double-registration on hot-reload in dev — Node module
 * cache resets between HMR cycles but instrumentation.ts can fire multiple times.
 *
 * Cron schedule summary:
 *   every 15 min  — grab loop: search indexers for all wanted items
 *   every 30 min  — availability check: promote grabbed -> imported
 *   top of hour   — auto-delete: remove expired quick-request content
 *
 * auto-delete is imported dynamically to avoid loading the 'server-only' fs module at
 * startup before the module graph is fully resolved.
 */

import cron from 'node-cron'
import { getDb } from '@/lib/db/index'
import { getWantedItems } from './monitor'
import { grabItem } from './grabber'
import { checkAvailability } from './availability'
import { runImportCheck } from './importer'
import type { MonitoredItem } from './types'

// C-5: login_attempts and audit_log are otherwise never pruned (one row per attempt / per event,
// forever), so they bloat on a long-lived self-host. login_attempts only needs a 5-minute window
// for its failure count; audit_log keeps a longer history.
const LOGIN_ATTEMPTS_RETENTION_MS = 24 * 60 * 60 * 1000        // 24 hours
const AUDIT_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000        // 90 days

function pruneAuthTables(): void {
  try {
    const db = getDb()
    const now = Date.now()
    const la = db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(now - LOGIN_ATTEMPTS_RETENTION_MS)
    const al = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(now - AUDIT_LOG_RETENTION_MS)
    if (la.changes > 0 || al.changes > 0) {
      console.log(`[maintenance] Pruned login_attempts=${la.changes} audit_log=${al.changes}`)
    }
  } catch (err) {
    console.error('[maintenance] Auth-table prune failed:', err)
  }
}

// Produce a short scope suffix like " S13E521" or " S02+03" for log lines so
// 101 identical "One Piece: not_found" entries are distinguishable per episode.
function fmtScope(item: MonitoredItem): string {
  try {
    if (item.scope_episodes) {
      const eps = JSON.parse(item.scope_episodes) as Array<{ s: number; e: number }>
      if (Array.isArray(eps) && eps.length > 0)
        return ` S${String(eps[0].s).padStart(2, '0')}E${String(eps[0].e).padStart(2, '0')}`
    }
    if (item.scope_seasons) {
      const ss = JSON.parse(item.scope_seasons) as number[]
      if (Array.isArray(ss) && ss.length > 0)
        return ` S${ss.map((n) => String(n).padStart(2, '0')).join('+')}`
    }
  } catch { /* malformed DB column — emit no suffix */ }
  return ''
}

// Module-level flag prevents double-scheduling if initScheduler is called more than once
let started = false

export function initScheduler(): void {
  if (started) return
  started = true

  // Grab loop: search all indexers for every wanted item sequentially to avoid
  // hammering indexers with concurrent requests on large want lists
  cron.schedule('*/5 * * * *', async () => {
    const wanted = getWantedItems()
    if (wanted.length === 0) return
    console.log(`[automation] Poll tick: ${wanted.length} wanted items`)
    for (const item of wanted) {
      // Honor the item's chosen language on background grabs (defaults to 'any').
      const result = await grabItem(item, { language: item.language })
      console.log(`[automation] ${item.title}${fmtScope(item)}: ${result}`)
    }
  })

  // Availability check: polls media_items for items that have been grabbed but not
  // yet confirmed imported; 30 minutes matches a typical download + scan cycle
  cron.schedule('*/30 * * * *', async () => {
    const updated = await checkAvailability()
    if (updated > 0) {
      console.log(`[automation] Availability check: ${updated} item(s) now imported`)
    }
  })

  // Import check: polls qBittorrent for completed grabbed torrents and moves them
  // into the library path via setLocation, then triggers a media scan.
  // 2-minute interval keeps import lag short without hammering qBit.
  cron.schedule('*/2 * * * *', async () => {
    await runImportCheck()
    // Finish any upgrade whose replacement has now imported: delete the old torrent + old file.
    // Dynamic import keeps the fs/download-client modules out of the initial graph.
    const { completeUpgrades } = await import('./upgrade')
    const done = await completeUpgrades()
    if (done > 0) console.log(`[upgrade] Completed ${done} upgrade replacement(s)`)
  })

  // Upgrade-until-cutoff scan: every 6 hours, look for a strictly-better release for imported movies
  // whose profile allows upgrades and whose current release is still below cutoff. Grabs the upgrade;
  // the importer + completeUpgrades() above do the file replacement once it lands.
  cron.schedule('0 */6 * * *', async () => {
    const { scanForUpgrades } = await import('./upgrade')
    const { scanned, upgraded } = await scanForUpgrades()
    if (upgraded > 0) console.log(`[upgrade] Scan: ${upgraded} upgrade(s) grabbed across ${scanned} item(s)`)
  })

  // Import lists: every 6 hours, pull each enabled Trakt/RSS list and auto-add new items as long-term
  // monitored items (never quick → never auto-deleted). Offset 20 min past the hour so it doesn't
  // contend with the upgrade scan on the same tick.
  cron.schedule('20 */6 * * *', async () => {
    const { syncAllImportLists } = await import('./import-lists')
    const added = await syncAllImportLists()
    if (added > 0) console.log(`[import-lists] Sync added ${added} new item(s)`)
  })

  // Movie collections: every 24h at 03:40, re-sync all enabled monitored TMDB collections to pick
  // up any newly-added films (sequels, etc.) and add them as long-term monitored items.
  // Dynamic import keeps TMDB/server modules out of the initial graph.
  cron.schedule('40 3 * * *', async () => {
    const { syncAllCollections } = await import('./collections')
    const added = await syncAllCollections()
    if (added > 0) console.log(`[collections] Sync added ${added} new film(s)`)
  })

  // Stalled-torrent reaper: every 10 min, two failure classes — (1) metaDL/forcedMetaDL stuck with
  // 0 peers past 'reaper_metadata_minutes' (default 60), and (2) a grabbed download stalled in
  // stalledDL/error/missingFiles past 'reaper_stall_minutes' (default 120). Each reaped torrent is
  // blocklisted + removed (DownloadClient), and its monitored_item is reset to 'wanted' to re-search
  // the next-best candidate — or parked at 'failed' after 'reaper_max_grab_attempts' (default 3).
  // Torrent-only delete; an actively downloading or seeding torrent is never touched. Dynamic import
  // keeps the qBit session module out of the initial graph.
  cron.schedule('*/10 * * * *', async () => {
    const { reapStalledTorrents } = await import('./reaper')
    const count = await reapStalledTorrents()
    if (count > 0) {
      console.log(`[reaper] Reaped ${count} stalled torrent(s)`)
    }
  })

  // Auto-delete: runs at the top of every hour; dynamic import keeps the fs-heavy
  // auto-delete module out of the initial module graph
  cron.schedule('0 * * * *', async () => {
    pruneAuthTables()
    const { runAutoDelete } = await import('./auto-delete')
    const count = await runAutoDelete()
    if (count > 0) {
      console.log(`[auto-delete] Cleaned up ${count} expired item(s)`)
    }
  })

  console.log('[automation] Scheduler started')
}
