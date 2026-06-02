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

  // Auto-delete expired auto-approved content hourly
  cron.schedule('0 * * * *', async () => {
    const { runAutoDelete } = await import('./auto-delete')
    const count = await runAutoDelete()
    if (count > 0) {
      console.log(`[auto-delete] Cleaned up ${count} expired item(s)`)
    }
  })

  console.log('[automation] Scheduler started')
}
