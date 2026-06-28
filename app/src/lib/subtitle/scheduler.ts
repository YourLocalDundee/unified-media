// Cron scheduler for the subtitle system.
// Runs two jobs: a library scan at 3 AM and a download pass at 3:30 AM.
// The 30-minute gap ensures the scan populates new 'wanted' rows before
// the downloader runs. initSubtitleScheduler() is called from instrumentation.ts
// and is guarded by `started` so hot-module-reload doesn't double-register crons.
import cron from 'node-cron'
import { scanLibrary } from './scanner'
import { downloadPendingSubtitles } from './downloader'

// Module-level guard prevents duplicate cron registration during Next.js
// dev-mode hot reloads, where instrumentation.ts can be re-executed.
let started = false

export function initSubtitleScheduler(): void {
  if (started) return
  started = true

  // Daily at 3 AM: scan the media library for missing subtitles
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[subtitle] Starting library scan...')
      const { scanned, created } = await scanLibrary()
      console.log(`[subtitle] Scan complete: ${scanned} items checked, ${created} new wanted`)
    } catch (err) {
      console.error('[subtitle] Library scan error:', err)
    }
  })

  // Daily at 3:30 AM: download pending subtitles
  cron.schedule('30 3 * * *', async () => {
    try {
      console.log('[subtitle] Starting subtitle downloads...')
      const result = await downloadPendingSubtitles()
      console.log(`[subtitle] Downloads: ${result.downloaded} ok, ${result.skipped} skipped, ${result.failed} failed`)
    } catch (err) {
      console.error('[subtitle] Download pass error:', err)
    }
  })

  console.log('[subtitle] Scheduler started')
}
