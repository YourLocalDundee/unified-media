export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const required = ['ADMIN_USERNAME', 'ADMIN_PASSWORD']
    const missing = required.filter((k) => !process.env[k])
    if (missing.length > 0) {
      console.error(`[config] Fatal: missing required env vars: ${missing.join(', ')}`)
      process.exit(1)
    }

    const jellyfinVars = ['JELLYFIN_URL', 'JELLYFIN_API_KEY', 'JELLYFIN_USER_ID']
    const missingJellyfin = jellyfinVars.filter((k) => !process.env[k])
    if (missingJellyfin.length > 0) {
      console.warn(`[config] Warning: Jellyfin env vars not set: ${missingJellyfin.join(', ')} — Jellyfin features will be unavailable`)
    }

    const { initScheduler } = await import('@/lib/automation/scheduler')
    initScheduler()

    const { initSubtitleScheduler } = await import('@/lib/subtitle/scheduler')
    initSubtitleScheduler()

    const { initWatcher } = await import('@/lib/media-server/scanner')
    initWatcher()
  }
}
