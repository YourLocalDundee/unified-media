import { describe, it, expect, afterEach, vi } from 'vitest'
import { automationOwner } from './scheduler'

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

describe('automationOwner', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('is ts by default, so an unconfigured deployment keeps automating', () => {
    delete process.env.UM_AUTOMATION_MODE
    expect(automationOwner()).toBe('ts')
  })

  it('hands the pipeline to um-automation on the one recognised value', () => {
    process.env.UM_AUTOMATION_MODE = 'rust'
    expect(automationOwner()).toBe('rust')
  })

  it('treats an unrecognised value as ts rather than silently stopping the pipeline', () => {
    process.env.UM_AUTOMATION_MODE = 'rsut'
    expect(automationOwner()).toBe('ts')
  })

  it('ignores surrounding whitespace, which a compose file makes easy to leave in', () => {
    process.env.UM_AUTOMATION_MODE = ' rust '
    expect(automationOwner()).toBe('rust')
  })

  it('does not accept a different case, so the value in the runbook is the only one that works', () => {
    process.env.UM_AUTOMATION_MODE = 'Rust'
    expect(automationOwner()).toBe('ts')
  })
})

/**
 * What actually gets scheduled in each mode.
 *
 * The registration list is the cutover: getting it wrong means either both sides grabbing the
 * same titles, or a deployment that quietly automates nothing. node-cron is mocked so the
 * schedule calls can be counted without any tick running.
 */
describe('initScheduler registration', () => {
  const saved = { ...process.env }

  afterEach(() => {
    process.env = { ...saved }
    scheduled.length = 0
    vi.resetModules()
  })

  /** Fresh module instance each time — `started` is module-level and latches after one call. */
  async function registerWith(mode: string | undefined): Promise<string[]> {
    scheduled.length = 0
    vi.resetModules()
    if (mode === undefined) delete process.env.UM_AUTOMATION_MODE
    else process.env.UM_AUTOMATION_MODE = mode
    const { initScheduler } = await import('./scheduler')
    initScheduler()
    return [...scheduled]
  }

  it('registers all eight pipeline jobs when it owns the pipeline', async () => {
    expect(await registerWith(undefined)).toHaveLength(8)
  })

  it('registers only the hourly maintenance tick once the pipeline is handed over', async () => {
    expect(await registerWith('rust')).toEqual(['0 * * * *'])
  })

  it('keeps pruning the auth tables after standing down', async () => {
    // The hourly tick is shared: in ts mode it prunes and then auto-deletes, in rust mode it
    // only prunes. Either way the expression is present, because sessions, login_attempts,
    // audit_log and guest users are this app's to clean up and um-automation never touches them.
    expect(await registerWith('rust')).toContain('0 * * * *')
    expect(await registerWith(undefined)).toContain('0 * * * *')
  })

  it('does not schedule twice when the startup hook fires more than once', async () => {
    scheduled.length = 0
    vi.resetModules()
    delete process.env.UM_AUTOMATION_MODE
    const { initScheduler } = await import('./scheduler')
    initScheduler()
    initScheduler()
    expect(scheduled).toHaveLength(8)
  })
})
