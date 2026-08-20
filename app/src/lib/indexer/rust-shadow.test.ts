import { describe, it, expect, afterEach } from 'vitest'
import { diffResults, indexerMode } from './rust-shadow'
import type { TorznabResult } from './types'

const result = (infoHash: string, title: string, seeders = 1): TorznabResult => ({
  title,
  infoHash,
  magnetUrl: '',
  downloadUrl: '',
  size: 0,
  seeders,
  leechers: 0,
  indexerName: 'test',
  publishDate: '',
  categories: [],
})

describe('indexerMode', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('is off without a service URL, whatever the mode says', () => {
    delete process.env.UM_INDEXER_URL
    process.env.UM_INDEXER_MODE = 'primary'
    expect(indexerMode()).toBe('off')
  })

  it('is off by default even when the service is configured', () => {
    process.env.UM_INDEXER_URL = 'http://um-indexer:8081'
    delete process.env.UM_INDEXER_MODE
    expect(indexerMode()).toBe('off')
  })

  it('treats an unrecognised mode as off rather than guessing', () => {
    process.env.UM_INDEXER_URL = 'http://um-indexer:8081'
    process.env.UM_INDEXER_MODE = 'shadwo'
    expect(indexerMode()).toBe('off')
  })

  it('honours the two real modes', () => {
    process.env.UM_INDEXER_URL = 'http://um-indexer:8081'
    process.env.UM_INDEXER_MODE = 'shadow'
    expect(indexerMode()).toBe('shadow')
    process.env.UM_INDEXER_MODE = 'primary'
    expect(indexerMode()).toBe('primary')
  })
})

describe('diffResults', () => {
  it('reports two identical answers as identical', () => {
    const both = [result('aa', 'A'), result('bb', 'B')]
    const diff = diffResults(both, [...both])
    expect(diff.onlyTs).toEqual([])
    expect(diff.onlyRust).toEqual([])
    expect(diff.topMatch).toBe(true)
    expect(diff.topTenAgreement).toBe(2)
  })

  it('names the releases only one side found', () => {
    const diff = diffResults(
      [result('aa', 'A'), result('bb', 'B')],
      [result('aa', 'A'), result('cc', 'C')],
    )
    expect(diff.onlyTs).toEqual(['bb'])
    expect(diff.onlyRust).toEqual(['cc'])
  })

  it('catches a reordering even when both sides return the same set', () => {
    // The case that matters most: automation grabs the first result, so the same set in a
    // different order is still a different grab.
    const diff = diffResults(
      [result('aa', 'A'), result('bb', 'B')],
      [result('bb', 'B'), result('aa', 'A')],
    )
    expect(diff.onlyTs).toEqual([])
    expect(diff.onlyRust).toEqual([])
    expect(diff.topMatch).toBe(false)
    expect(diff.topTenAgreement).toBe(0)
  })

  it('falls back to the title for a result with no infohash', () => {
    const diff = diffResults([result('', 'Some.Release')], [result('', 'Some.Release')])
    expect(diff.onlyTs).toEqual([])
    expect(diff.topMatch).toBe(true)
  })

  it('does not call two empty answers a match', () => {
    const diff = diffResults([], [])
    expect(diff.topMatch).toBe(false)
    expect(diff.topTenAgreement).toBe(0)
  })
})
