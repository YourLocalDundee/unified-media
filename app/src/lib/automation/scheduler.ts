import cron from 'node-cron'
import { getWantedItems } from './monitor'
import { grabItem } from './grabber'
import { checkAvailability } from './availability'

let started = false

export function initScheduler(): void {
  if (started) return
  started = true

  // Run every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    const wanted = getWantedItems()
    if (wanted.length === 0) return
    console.log(`[automation] Poll tick: ${wanted.length} wanted items`)
    for (const item of wanted) {
      const result = await grabItem(item)
      console.log(`[automation] ${item.title}: ${result}`)
    }
  })

  // Availability check every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    const updated = await checkAvailability()
    if (updated > 0) {
      console.log(`[automation] Availability check: ${updated} item(s) now imported`)
    }
  })

  console.log('[automation] Scheduler started')
}
