/**
 * Next.js server startup hook. Runs once per worker process on boot.
 * Guards on NEXT_RUNTIME to avoid executing in the Edge runtime (e.g. middleware).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Last-resort backstop for the background work below. The schedulers wrap their own
    // ticks, but detached promises elsewhere (fire-and-forget imports, the party server,
    // the fs watcher) can still reject with nobody listening — and Node's default for an
    // unhandled rejection is to terminate the process, taking the web server down with a
    // failure that had nothing to do with serving requests.
    //
    // The two cases are deliberately not treated alike. A stray rejection is recoverable,
    // so log it and keep serving. An uncaught exception leaves the process in an undefined
    // state, so log it and exit non-zero — compose restarts the container (restart:
    // unless-stopped) into a clean one. Either way the reason reaches the logs first,
    // which is the part that was missing.
    process.on('unhandledRejection', (reason) => {
      console.error('[process] Unhandled promise rejection:', reason)
    })
    process.on('uncaughtException', (err) => {
      console.error('[process] Uncaught exception — exiting for a clean restart:', err)
      process.exit(1)
    })

    // Route all outbound HTTP through gluetun's proxy when configured.
    // EnvHttpProxyAgent (not ProxyAgent) so NO_PROXY keeps container-to-container
    // traffic off the tunnel — a missing NO_PROXY entry hangs, it doesn't error.
    const { setGlobalDispatcher, EnvHttpProxyAgent } = await import('undici')
    if (process.env.HTTPS_PROXY) {
      setGlobalDispatcher(new EnvHttpProxyAgent())
      console.log('[net] Outbound HTTP via', process.env.HTTPS_PROXY)
    }

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
