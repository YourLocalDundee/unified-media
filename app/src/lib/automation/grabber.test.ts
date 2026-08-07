import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TorznabResult } from '@/lib/indexer/types'
import type { MonitoredItem } from './types'
import type { ScoredCandidate } from './grab-results'

// vi.mock is hoisted above these imports at transform time, so anything a mock factory
// references must itself come from vi.hoisted() — a plain module-scope const would be
// executed too late ("ReferenceError: x is not defined" inside the factory).
const mocks = vi.hoisted(() => ({
  addTorrent: vi.fn().mockResolvedValue(undefined),
  recordGrab: vi.fn(),
  updateItem: vi.fn(),
  incrementDailyGrabCount: vi.fn(),
}))

vi.mock('@/lib/download-client/registry', () => ({
  getClient: () => ({ addTorrent: mocks.addTorrent }),
}))
vi.mock('@/lib/automation/monitor', () => ({
  recordGrab: mocks.recordGrab,
  updateItem: mocks.updateItem,
  getProfileById: vi.fn(),
}))
vi.mock('@/lib/indexer/config', () => ({
  incrementDailyGrabCount: mocks.incrementDailyGrabCount,
  checkGrabLimit: vi.fn(() => true),
}))
vi.mock('@/lib/db/index', () => ({
  getDb: () => ({
    prepare: () => ({ get: () => ({ id: 42 }) }),
  }),
}))

function mockResult(overrides: Partial<TorznabResult> = {}): TorznabResult {
  return {
    title: 'Test.Release.1080p.WEB-DL',
    infoHash: 'hash-' + Math.random().toString(36).slice(2),
    magnetUrl: 'magnet:?xt=urn:btih:abc',
    downloadUrl: '',
    size: 1_000_000_000,
    seeders: 10,
    leechers: 2,
    indexerName: 'TestIndexer',
    publishDate: new Date().toISOString(),
    categories: ['5000'],
    ...overrides,
  }
}

function candidate(
  overrides: Omit<Partial<ScoredCandidate>, 'result'> & { result?: Partial<TorznabResult> } = {},
): ScoredCandidate {
  const { result, ...rest } = overrides
  return {
    result: mockResult(result),
    score: 50,
    selected: false,
    ...rest,
  }
}

describe('splitTiers', () => {
  it('puts gate-passing, live releases in tier 1 sorted by score desc', async () => {
    const { splitTiers } = await import('./grabber')

    const low = candidate({ score: 10, result: { seeders: 5 } })
    const high = candidate({ score: 90, result: { seeders: 5 } })
    const mid = candidate({ score: 40, result: { seeders: 5 } })

    const { tier1, tier2 } = splitTiers([low, high, mid])

    expect(tier1.map(c => c.score)).toEqual([90, 40, 10])
    expect(tier2).toEqual([])
  })

  it('sinks dead (0-seed) releases to tier 2 even with a high score', async () => {
    const { splitTiers } = await import('./grabber')

    const dead = candidate({ score: 95, result: { seeders: 0 } })
    const alive = candidate({ score: 20, result: { seeders: 3 } })

    const { tier1, tier2 } = splitTiers([dead, alive])

    expect(tier1).toEqual([alive])
    expect(tier2).toEqual([dead])
  })

  it('sinks gated releases to tier 2 regardless of score or seeders', async () => {
    const { splitTiers } = await import('./grabber')

    const gated = candidate({ score: 99, result: { seeders: 50 }, gates: ['blocklisted'] })
    const clean = candidate({ score: 5, result: { seeders: 1 } })

    const { tier1, tier2 } = splitTiers([gated, clean])

    expect(tier1).toEqual([clean])
    expect(tier2).toEqual([gated])
  })

  it('sorts tier 2 by score desc as well, for a stable "next best within tier 2" walk', async () => {
    const { splitTiers } = await import('./grabber')

    const deadLow = candidate({ score: 5, result: { seeders: 0 } })
    const deadHigh = candidate({ score: 60, result: { seeders: 0 } })

    const { tier2 } = splitTiers([deadLow, deadHigh])

    expect(tier2.map(c => c.score)).toEqual([60, 5])
  })
})

describe('grabSpecificRelease', () => {
  beforeEach(() => {
    mocks.addTorrent.mockClear()
    mocks.recordGrab.mockClear()
    mocks.updateItem.mockClear()
    mocks.incrementDailyGrabCount.mockClear()
  })

  const item: MonitoredItem = {
    id: 7,
    tmdb_id: 123,
    tvdb_id: null,
    type: 'tv',
    title: 'Test Show',
    year: 2020,
    quality_profile_id: 1,
    root_path: '',
    monitored: 1,
    status: 'wanted',
    created_at: Date.now(),
    updated_at: Date.now(),
    scope_type: 'full',
    scope_seasons: null,
    scope_episodes: null,
    scope_key: 'tv:123:full',
    monitor_future: 0,
    language: 'any',
    audio_mode: 'any',
    scope_label: null,
    alternative_titles: null,
  } as MonitoredItem

  it('commits the given release: addTorrent with its magnet, recordGrab written, status set to grabbed', async () => {
    const { grabSpecificRelease } = await import('./grabber')

    const release = mockResult({
      title: 'Test.Show.S01.1080p.WEB-DL',
      infoHash: 'deadbeef',
      magnetUrl: 'magnet:?xt=urn:btih:deadbeef',
      indexerName: 'TestIndexer',
    })

    await grabSpecificRelease(item, release)

    expect(mocks.addTorrent).toHaveBeenCalledWith({ urls: release.magnetUrl, category: 'tv' })
    expect(mocks.incrementDailyGrabCount).toHaveBeenCalledWith(42)
    expect(mocks.recordGrab).toHaveBeenCalledWith({
      item_id: 7,
      indexer: 'TestIndexer',
      release_title: release.title,
      info_hash: 'deadbeef',
      urls: [release.magnetUrl, release.downloadUrl],
    })
    expect(mocks.updateItem).toHaveBeenCalledWith(7, { status: 'grabbed' })
  })

  it('falls back to the .torrent download URL when no magnet is present', async () => {
    const { grabSpecificRelease } = await import('./grabber')

    const release = mockResult({ magnetUrl: '', downloadUrl: 'https://indexer.example/dl/1' })
    await grabSpecificRelease(item, release)

    expect(mocks.addTorrent).toHaveBeenCalledWith({ urls: release.downloadUrl, category: 'tv' })
  })
})
