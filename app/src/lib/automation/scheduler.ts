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
import { getWantedItems } from './monitor'
import { grabItem } from './grabber'
import { checkAvailability } from './availability'
import { runImportCheck } from './importer'
import type { MonitoredItem } from './types'

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
  })

  // Auto-delete: runs at the top of every hour; dynamic import keeps the fs-heavy
  // auto-delete module out of the initial module graph
  cron.schedule('0 * * * *', async () => {
    const { runAutoDelete } = await import('./auto-delete')
    const count = await runAutoDelete()
    if (count > 0) {
      console.log(`[auto-delete] Cleaned up ${count} expired item(s)`)
    }
  })

  console.log('[automation] Scheduler started')
}
