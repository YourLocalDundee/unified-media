/**
 * Automation scheduler: registers the eight background cron jobs for the pipeline.
 *
 * Called once from src/instrumentation.ts (Next.js server startup hook).
 * The 'started' guard prevents double-registration on hot-reload in dev — Node module
 * cache resets between HMR cycles but instrumentation.ts can fire multiple times.
 *
 * Cron schedule summary:
 *   every 2 min   — import check: move completed torrents into the library, finish upgrades
 *   every 5 min   — grab loop: search indexers for all wanted items
 *   every 10 min  — reaper: blocklist and remove stalled torrents
 *   every 30 min  — availability check: promote grabbed -> imported
 *   every 6 h     — upgrade scan (:00) and import-list sync (:20)
 *   daily 03:40   — collection sync
 *   top of hour   — auth-table prune + auto-delete of expired quick-request content
 *
 * Every body goes through safeCron, which logs failures against the job's name. node-cron
 * already contains a throwing tick on its own (see safeCron below); the wrapper is there so
 * the log says which of the eight jobs failed. instrumentation.ts installs a process-level
 * backstop for detached promises outside these ticks.
 *
 * auto-delete is imported dynamically to avoid loading the 'server-only' fs module at
 * startup before the module graph is fully resolved.
 */

import cron from 'node-cron'
import { getDb } from '@/lib/db/index'
import { getWantedItems, releaseStaleGrabClaims } from './monitor'
import { grabItem } from './grabber'
import { checkAvailability } from './availability'
import { runImportCheck } from './importer'
import type { MonitoredItem } from './types'

// C-5: login_attempts and audit_log are otherwise never pruned (one row per attempt / per event,
// forever), so they bloat on a long-lived self-host. login_attempts only needs a 5-minute window
// for its failure count; audit_log keeps a longer history.
// How long a 'grabbing' claim may be held before the grab loop treats it as abandoned. Well above
// the seconds a real search + client add takes, well below the 5-minute-tick cost of a stuck row.
const STALE_CLAIM_MS = 15 * 60 * 1000                          // 15 minutes

const LOGIN_ATTEMPTS_RETENTION_MS = 24 * 60 * 60 * 1000        // 24 hours
const AUDIT_LOG_RETENTION_MS = 90 * 24 * 60 * 60 * 1000        // 90 days

// sessions and pending_registrations enforce their own expiry lazily, at the moment a row is
// used (getSession()'s `expires_at > ?` filter, verify-email's expiry check). That makes an
// expired row inert but never deletes it, so both tables grew without bound. These two are the
// grace period AFTER a row's own expires_at, not the lifetime: an expired session is already
// unusable, the tail just keeps it visible for a week in case someone is investigating.
const SESSIONS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000          // 7 days past expiry
const PENDING_REG_RETENTION_MS = 24 * 60 * 60 * 1000           // 24 hours past expiry

/**
 * Party guests get a throwaway `users` row (`is_guest=1`) plus an 8h session. The session is
 * pruned above; the user row used to outlive it forever.
 *
 * `foreign_keys=ON` is set per-connection, and `users(id)` has exactly two declared FK
 * referrers — `watch_parties.host_user_id` and `watch_party_members.user_id` — so a bare
 * DELETE would either fail or strand history. The rules below are deliberately conservative:
 * a guest that left any durable trace beyond membership of a finished party is kept.
 *
 *  - no sessions left at all. The sessions prune runs at expires_at + 7 days and a guest
 *    session lives 8 hours, so this alone means the guest has been gone about a week.
 *  - hosts no party, ended or active. Ended parties are kept as history and their
 *    host_user_id FK has to keep resolving. A guest hosting is an edge case; skipping it
 *    costs one stale row and avoids deciding what an ownerless party means.
 *  - not a member of any still-active party.
 *  - has no media_requests rows, which would represent real library work rather than a
 *    throwaway viewing session.
 *
 * watch_events / media_watch_state / push_subscriptions carry a user_id with no declared FK,
 * so they wouldn't block the delete, but they are cleared anyway rather than left orphaned.
 */
function pruneGuestUsers(): void {
  try {
    const db = getDb()
    const doomed = db.prepare(`
      SELECT u.id FROM users u
      WHERE u.is_guest = 1
        AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM watch_parties p WHERE p.host_user_id = u.id)
        AND NOT EXISTS (SELECT 1 FROM media_requests r WHERE r.user_id = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM watch_party_members m
          JOIN watch_parties p ON p.id = m.party_id
          WHERE m.user_id = u.id AND p.status = 'active'
        )
    `).all() as { id: string }[]

    if (doomed.length === 0) return

    const stmts = [
      db.prepare('DELETE FROM watch_party_members WHERE user_id = ?'),
      db.prepare('DELETE FROM watch_events WHERE user_id = ?'),
      db.prepare('DELETE FROM media_watch_state WHERE user_id = ?'),
      db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?'),
      // is_guest re-checked in the DELETE itself so this can never remove a real account even
      // if the SELECT above were ever loosened by mistake.
      db.prepare('DELETE FROM users WHERE id = ? AND is_guest = 1'),
    ]
    db.transaction((ids: string[]) => {
      for (const id of ids) for (const s of stmts) s.run(id)
    })(doomed.map((r) => r.id))

    console.log(`[maintenance] Pruned guest users=${doomed.length}`)
  } catch (err) {
    console.error('[maintenance] Guest-user prune failed:', err)
  }
}

function pruneAuthTables(): void {
  try {
    const db = getDb()
    const now = Date.now()
    const la = db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(now - LOGIN_ATTEMPTS_RETENTION_MS)
    const al = db.prepare('DELETE FROM audit_log WHERE created_at < ?').run(now - AUDIT_LOG_RETENTION_MS)
    const se = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now - SESSIONS_RETENTION_MS)
    const pr = db.prepare('DELETE FROM pending_registrations WHERE expires_at < ?').run(now - PENDING_REG_RETENTION_MS)
    if (la.changes > 0 || al.changes > 0 || se.changes > 0 || pr.changes > 0) {
      console.log(
        `[maintenance] Pruned login_attempts=${la.changes} audit_log=${al.changes} ` +
        `sessions=${se.changes} pending_registrations=${pr.changes}`
      )
    }
  } catch (err) {
    console.error('[maintenance] Auth-table prune failed:', err)
  }
}

/**
 * The housekeeping half of the hourly tick: prune the auth tables, then the guest users left
 * behind once their sessions are gone.
 *
 * Kept separate from auto-delete, which shares the tick but is unrelated work — that reclaims a
 * quick request's slot, these keep `sessions`, `login_attempts`, `audit_log`,
 * `pending_registrations` and guest `users` from growing without bound. Nothing else prunes them,
 * and nothing complains when they are not pruned; the only symptom is tables that grow.
 *
 * Order matters: auth tables first, so a guest whose session row is dropped on this same tick
 * becomes eligible immediately rather than waiting an extra hour.
 */
function runMaintenance(): void {
  pruneAuthTables()
  pruneGuestUsers()
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

/**
 * cron.schedule with a labelled error log.
 *
 * This is NOT crash protection: node-cron >= 4 already wraps each execution in try/catch
 * and routes failures to its own onError, which logs `[NODE-CRON][ERROR]`. A throwing tick
 * has not been able to escape as an unhandledRejection since the 4.x upgrade. (It could
 * under node-cron 3.x, which is what the 2026-06-13 audit's A17-4 finding was written
 * against; the dependency bump silently resolved it.)
 *
 * What this adds is attribution. node-cron's default handler prints a stack with no job
 * identity, so eight jobs share one indistinguishable error shape in the log; `label`
 * names the one that actually failed. It also keeps behaviour ours rather than inherited
 * from a library default that could change under a future bump.
 */
function safeCron(expression: string, label: string, body: () => Promise<void> | void): void {
  cron.schedule(expression, async () => {
    try {
      await body()
    } catch (err) {
      console.error(`[automation] ${label} tick failed:`, err)
    }
  })
}

export function initScheduler(): void {
  if (started) return
  started = true

  // Grab loop: search all indexers for every wanted item sequentially to avoid
  // hammering indexers with concurrent requests on large want lists
  safeCron('*/5 * * * *', 'grab', async () => {
    // A 'grabbing' claim is held for seconds; anything still holding one after STALE_CLAIM_MS
    // belongs to a claimer that died and would otherwise never be retried by this loop.
    const released = releaseStaleGrabClaims(STALE_CLAIM_MS)
    if (released > 0) console.log(`[automation] Released ${released} stale grab claim(s)`)

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
  safeCron('*/30 * * * *', 'availability', async () => {
    const updated = await checkAvailability()
    if (updated > 0) {
      console.log(`[automation] Availability check: ${updated} item(s) now imported`)
    }
  })

  // Import check: polls UMT for completed grabbed torrents and moves them
  // into the library path via setLocation, then triggers a media scan.
  // 2-minute interval keeps import lag short without hammering UMT.
  safeCron('*/2 * * * *', 'import', async () => {
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
  safeCron('0 */6 * * *', 'upgrade-scan', async () => {
    const { scanForUpgrades } = await import('./upgrade')
    const { scanned, upgraded } = await scanForUpgrades()
    if (upgraded > 0) console.log(`[upgrade] Scan: ${upgraded} upgrade(s) grabbed across ${scanned} item(s)`)
  })

  // Import lists: every 6 hours, pull each enabled Trakt/RSS list and auto-add new items as long-term
  // monitored items (never quick → never auto-deleted). Offset 20 min past the hour so it doesn't
  // contend with the upgrade scan on the same tick.
  safeCron('20 */6 * * *', 'import-lists', async () => {
    const { syncAllImportLists } = await import('./import-lists')
    const added = await syncAllImportLists()
    if (added > 0) console.log(`[import-lists] Sync added ${added} new item(s)`)
  })

  // Movie collections: every 24h at 03:40, re-sync all enabled monitored TMDB collections to pick
  // up any newly-added films (sequels, etc.) and add them as long-term monitored items.
  // Dynamic import keeps TMDB/server modules out of the initial graph.
  safeCron('40 3 * * *', 'collections', async () => {
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
  // keeps the UMT session module out of the initial graph.
  safeCron('*/10 * * * *', 'reaper', async () => {
    const { reapStalledTorrents } = await import('./reaper')
    const count = await reapStalledTorrents()
    if (count > 0) {
      console.log(`[reaper] Reaped ${count} stalled torrent(s)`)
    }
  })

  // Auto-delete: runs at the top of every hour; dynamic import keeps the fs-heavy
  // auto-delete module out of the initial module graph
  safeCron('0 * * * *', 'auto-delete', async () => {
    runMaintenance()
    const { runAutoDelete } = await import('./auto-delete')
    const count = await runAutoDelete()
    if (count > 0) {
      console.log(`[auto-delete] Cleaned up ${count} expired item(s)`)
    }
  })

  console.log('[automation] Scheduler started')
}
