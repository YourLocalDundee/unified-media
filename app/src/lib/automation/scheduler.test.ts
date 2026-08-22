import { describe, it, expect, afterEach, vi } from 'vitest'

// vi.mock factories are hoisted above the imports, so the array they push into has to be
// hoisted too (same reason as grabber.test.ts).
const { scheduled } = vi.hoisted(() => ({ scheduled: [] as string[] }))

// node-cron is replaced so registrations can be counted without a tick ever running.
vi.mock('node-cron', () => ({
  default: { schedule: (expression: string) => { scheduled.push(expression) } },
}))

// The job bodies never run here, but their modules are imported at load time and drag in the
// notification stack, which imports 'server-only' and cannot resolve outside Next.
vi.mock('@/lib/db/index', () => ({ getDb: () => { throw new Error('no job body should run') } }))
vi.mock('./monitor', () => ({ getWantedItems: vi.fn(), releaseStaleGrabClaims: vi.fn() }))
vi.mock('./grabber', () => ({ grabItem: vi.fn() }))
vi.mock('./availability', () => ({ checkAvailability: vi.fn() }))
vi.mock('./importer', () => ({ runImportCheck: vi.fn() }))

/**
 * What actually gets scheduled.
 *
 * node-cron is mocked so the registrations can be counted without any tick running.
 */
describe('initScheduler registration', () => {
  afterEach(() => {
    scheduled.length = 0
    vi.resetModules()
  })

  /** Fresh module instance each time — `started` is module-level and latches after one call. */
  async function register(): Promise<string[]> {
    scheduled.length = 0
    vi.resetModules()
    const { initScheduler } = await import('./scheduler')
    initScheduler()
    return [...scheduled]
  }

  it('registers all eight pipeline jobs', async () => {
    expect(await register()).toHaveLength(8)
  })

  it('schedules the hourly tick that prunes the auth tables', async () => {
    // Nothing else prunes sessions, login_attempts, audit_log or guest users, and nothing
    // complains when they are not pruned — the only symptom is tables that grow.
    expect(await register()).toContain('0 * * * *')
  })

  it('does not schedule twice when the startup hook fires more than once', async () => {
    scheduled.length = 0
    vi.resetModules()
    const { initScheduler } = await import('./scheduler')
    initScheduler()
    initScheduler()
    expect(scheduled).toHaveLength(8)
  })
})
