/**
 * Next.js server startup hook. Runs once per worker process on boot.
 * Guards on NEXT_RUNTIME to avoid executing in the Edge runtime (e.g. middleware).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const required = ['ADMIN_USERNAME', 'ADMIN_PASSWORD']
    const missing = required.filter((k) => !process.env[k])
    if (missing.length > 0) {
      console.error(`[config] Fatal: missing required env vars: ${missing.join(', ')}`)
      process.exit(1)
    }

    const { initScheduler } = await import('@/lib/automation/scheduler')
    initScheduler()

    const { initSubtitleScheduler } = await import('@/lib/subtitle/scheduler')
    initSubtitleScheduler()

    const { initWatcher } = await import('@/lib/media-server/scanner')
    initWatcher()

    const { initMediaEnrichScheduler } = await import('@/lib/media-server/scheduler')
    initMediaEnrichScheduler()

    const { initIndexerDiscovery } = await import('@/lib/indexer/discovery')
    initIndexerDiscovery().catch(err => {
      console.warn('[indexer] Discovery error (non-fatal):', err)
    })

    try {
      const { initPartyServer } = await import('@/lib/party/server')
      initPartyServer()
    } catch (err) {
      console.warn('[party] Party WebSocket server failed to start (non-fatal):', err)
    }
  }
}
