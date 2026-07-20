// Cron scheduler for TMDB metadata enrichment.
//
// enrichAll() only ever ran when an admin clicked "Scan & Enrich" on /admin/media-server —
// there was no automatic pass. Any content that enters the library via direct filesystem
// scan (not through the app's own Request -> Grab -> Import flow, e.g. pre-existing files or
// content grabbed by an external tool) silently sat with no tmdb_id/poster_path/overview
// forever unless an admin remembered to trigger it by hand. Daily 4 AM run self-heals that,
// after the filesystem watcher scan settles the DB for the day (see media-server/scanner.ts).
import cron from 'node-cron'
import { enrichAll, enrichEpisodeStills } from './enricher'

let started = false

export function initMediaEnrichScheduler(): void {
  if (started) return
  started = true

  cron.schedule('0 4 * * *', async () => {
    try {
      console.log('[media-server] Starting TMDB enrichment pass...')
      const { enriched, failed } = await enrichAll()
      console.log(`[media-server] Show/movie enrichment complete: ${enriched} enriched, ${failed} failed`)
      const episodes = await enrichEpisodeStills()
      console.log(`[media-server] Episode enrichment complete: ${episodes.enriched} enriched, ${episodes.failed} failed`)
    } catch (err) {
      console.error('[media-server] Enrichment pass error:', err)
    }
  })

  console.log('[media-server] Enrichment scheduler started')
}
