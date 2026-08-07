// Cron scheduler for the subtitle system.
// Runs three jobs: a weekly re-check of 'skipped' items at 2:30 AM Sunday, a library
// scan at 3 AM, and a download pass at 3:30 AM. The gaps ensure the re-check resets
// stale skips to 'wanted' before the scan runs, and the scan populates any new 'wanted'
// rows before the downloader runs. initSubtitleScheduler() is called from
// instrumentation.ts and is guarded by `started` so hot-module-reload doesn't double-
// register crons.
import cron from 'node-cron'
import { scanLibrary } from './scanner'
import { downloadPendingSubtitles } from './downloader'
import { resetSkippedToWanted } from './monitor'

// Module-level guard prevents duplicate cron registration during Next.js
// dev-mode hot reloads, where instrumentation.ts can be re-executed.
let started = false

export function initSubtitleScheduler(): void {
  if (started) return
  started = true

  // Weekly, Sunday 2:30 AM: 'skipped' means "no match at the time we searched", not
  // "never will be" — OpenSubtitles' catalog grows as fans upload more over time.
  // Resetting to 'wanted' here means the 3:30 AM download pass re-searches them same day.
  cron.schedule('30 2 * * 0', async () => {
    try {
      const reset = resetSkippedToWanted()
      console.log(`[subtitle] Re-check: ${reset} skipped items reset to wanted for retry`)
    } catch (err) {
      console.error('[subtitle] Skipped re-check error:', err)
    }
  })

  // Daily at 3 AM: scan the media library for missing subtitles
  cron.schedule('0 3 * * *', async () => {
    try {
      console.log('[subtitle] Starting library scan...')
      const { scanned, created, pruned } = await scanLibrary()
      console.log(`[subtitle] Scan complete: ${scanned} items checked, ${created} new wanted, ${pruned} orphaned wants pruned`)
    } catch (err) {
      console.error('[subtitle] Library scan error:', err)
    }
  })

  // Daily at 3:30 AM: download pending subtitles
  cron.schedule('30 3 * * *', async () => {
    try {
      console.log('[subtitle] Starting subtitle downloads...')
      const result = await downloadPendingSubtitles()
      console.log(
        `[subtitle] Downloads: ${result.downloaded} ok, ${result.skipped} skipped, ${result.failed} failed` +
          (result.quotaExhausted ? ' (stopped early: daily quota exhausted)' : '')
      )
    } catch (err) {
      console.error('[subtitle] Download pass error:', err)
    }
  })

  console.log('[subtitle] Scheduler started')
}
