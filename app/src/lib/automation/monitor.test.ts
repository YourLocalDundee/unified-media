import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_QUALITY_PROFILE_ID } from './types'

// Captures the named params handed to the INSERT so we can assert on the defaults createItem
// applies. Only the insert path matters here; the fetch-or-create fallback is not exercised.
const runCalls: Array<Record<string, unknown>> = []

vi.mock('@/lib/db/index', () => ({
  getDb: () => ({
    prepare: () => ({
      run: (params: Record<string, unknown>) => {
        runCalls.push(params)
        return { changes: 1, lastInsertRowid: 1 }
      },
      get: () => ({ id: 1 }),
      all: () => [],
    }),
  }),
}))

describe('createItem — quality profile default', () => {
  beforeEach(() => {
    runCalls.length = 0
  })

  it('defaults to the 1080p profile, NOT "Any"', async () => {
    const { createItem } = await import('./monitor')
    createItem({ type: 'movie', title: 'Some Film', tmdb_id: 1, year: 2001 })

    expect(runCalls).toHaveLength(1)
    expect(runCalls[0].quality_profile_id).toBe(DEFAULT_QUALITY_PROFILE_ID)
  })

  it('pins that default to profile 2', () => {
    // Profile 1 is "Any", which carries no conditions and therefore accepts an 80GB 4K remux for a
    // request the user meant as 1080p. That is how one request ended up with two completed
    // downloads on 2026-08-16. If this assertion is ever changed, read the comment on
    // DEFAULT_QUALITY_PROFILE_ID in types.ts first.
    expect(DEFAULT_QUALITY_PROFILE_ID).toBe(2)
    expect(DEFAULT_QUALITY_PROFILE_ID).not.toBe(1)
  })

  it('still honours an explicitly requested profile, including "Any"', async () => {
    const { createItem } = await import('./monitor')
    createItem({ type: 'movie', title: 'Some Film', tmdb_id: 2, year: 2001, quality_profile_id: 1 })

    expect(runCalls[0].quality_profile_id).toBe(1)
  })
})
