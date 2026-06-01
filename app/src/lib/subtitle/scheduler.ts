import cron from 'node-cron'
import { scanLibrary } from './scanner'
import { downloadPendingSubtitles } from './downloader'

let started = false

export function initSubtitleScheduler(): void {
  if (started) return
  started = true

  // Daily at 3 AM: scan Jellyfin library for missing subtitles
  cron.schedule('0 3 * * *', async () => {
    console.log('[subtitle] Starting library scan...')
    const { scanned, created } = await scanLibrary()
    console.log(`[subtitle] Scan complete: ${scanned} items checked, ${created} new wanted`)
  })

  // Daily at 3:30 AM: download pending subtitles
  cron.schedule('30 3 * * *', async () => {
    console.log('[subtitle] Starting subtitle downloads...')
    const result = await downloadPendingSubtitles()
    console.log(`[subtitle] Downloads: ${result.downloaded} ok, ${result.skipped} skipped, ${result.failed} failed`)
  })

  console.log('[subtitle] Scheduler started')
}
