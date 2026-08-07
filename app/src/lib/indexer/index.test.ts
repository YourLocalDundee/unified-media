import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseCapsXml, testIndexer, searchAllIndexers } from './index'
import type { Indexer } from './types'
import * as config from './config'

vi.mock('./config', () => ({
  getSearchableIndexers: vi.fn(),
  recordIndexerResult: vi.fn(),
  tryConsumeIndexerToken: vi.fn(() => true),
  checkQueryLimit: vi.fn(() => true),
  incrementDailyQueryCount: vi.fn(),
}))

function mockIndexer(overrides: Partial<Indexer> = {}): Indexer {
  return {
    id: 1,
    name: 'Test Indexer',
    torznab_url: 'https://example.com/torznab',
    api_key: 'key',
    enabled: 1,
    last_health_check: null,
    health_status: null,
    requires_auth: 0,
    requires_flaresolverr: 0,
    search_type: 'torznab',
    description: null,
    pending_credentials: null,
    base_url: null,
    consecutive_failures: 0,
    disabled_until: null,
    rate_limit_per_min: 0,
    rate_limit_queries_per_day: 0,
    rate_limit_grabs_per_day: 0,
    daily_query_count: 0,
    daily_grab_count: 0,
    daily_stats_date: '',
    caps_categories: null,
    caps_checked_at: null,
    ...overrides,
  }
}

const CAPS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.1" title="Test Tracker"/>
  <categories>
    <category id="2000" name="Movies">
      <subcat id="2010" name="Movies/Foreign"/>
      <subcat id="2030" name="Movies/SD"/>
    </category>
    <category id="5000" name="TV"/>
  </categories>
</caps>`

describe('parseCapsXml', () => {
  it('parses top-level categories with subcats', async () => {
    const categories = await parseCapsXml(CAPS_XML)
    expect(categories).toEqual([
      { id: '2000', name: 'Movies', subcats: [{ id: '2010', name: 'Movies/Foreign' }, { id: '2030', name: 'Movies/SD' }] },
      { id: '5000', name: 'TV' },
    ])
  })

  it('returns [] for malformed XML', async () => {
    expect(await parseCapsXml('not xml at all <<<')).toEqual([])
  })

  it('returns [] when there is no <categories> block', async () => {
    expect(await parseCapsXml('<caps><server version="1.1"/></caps>')).toEqual([])
  })
})

describe('testIndexer', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('actually probes a registered native adapter instead of auto-passing', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 'ok',
        data: { movies: [{ id: 1, title: 'The Matrix', year: 1999, imdb_code: 'tt0133093', torrents: [
          { quality: '1080p', type: 'bluray', seeds: 10, peers: 2, size: '2 GB', size_bytes: 2_000_000_000, hash: 'a'.repeat(40), date_uploaded_unix: 0 },
        ] }] },
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await testIndexer(mockIndexer({ search_type: 'yts', torznab_url: '' }))

    expect(result.status).toBe('ok')
    expect(result.resultCount).toBe(1)
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('reports an error status when a registered adapter throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const result = await testIndexer(mockIndexer({ search_type: 'yts', torznab_url: '' }))

    expect(result.status).toBe('error')
    expect(result.errorMessage).toBeTruthy()
  })

  it('skips the network call for an unrecognized, non-torznab search type', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await testIndexer(mockIndexer({ search_type: 'some-future-type', torznab_url: '' }))

    expect(result).toEqual({ status: 'ok', responseTimeMs: 0 })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('parses caps categories into the health result on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(CAPS_XML),
    }))

    const result = await testIndexer(mockIndexer())

    expect(result.status).toBe('ok')
    expect(result.categories).toEqual([
      { id: '2000', name: 'Movies', subcats: [{ id: '2010', name: 'Movies/Foreign' }, { id: '2030', name: 'Movies/SD' }] },
      { id: '5000', name: 'TV' },
    ])
  })

  it('reports an error status without categories on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' }))

    const result = await testIndexer(mockIndexer())

    expect(result.status).toBe('error')
    expect(result.categories).toBeUndefined()
  })
})

describe('searchAllIndexers — adapter registry dispatch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('dispatches a registered search_type to its adapter and records success', async () => {
    const indexer = mockIndexer({ id: 1, search_type: 'yts', torznab_url: '' })
    vi.mocked(config.getSearchableIndexers).mockReturnValue([indexer])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: 'ok',
        data: { movies: [{ id: 1, title: 'X', year: 2000, imdb_code: 'tt1', torrents: [
          { quality: '1080p', type: 'bluray', seeds: 5, peers: 1, size: '1 GB', size_bytes: 1, hash: 'b'.repeat(40), date_uploaded_unix: 0 },
        ] }] },
      }),
    }))

    const results = await searchAllIndexers({ q: 'x' })

    expect(results).toHaveLength(1)
    expect(config.recordIndexerResult).toHaveBeenCalledWith(1, true)
  })

  it('catches a thrown adapter error, records it as a failure, and yields no results for it', async () => {
    const indexer = mockIndexer({ id: 2, search_type: 'yts', torznab_url: '' })
    vi.mocked(config.getSearchableIndexers).mockReturnValue([indexer])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    const results = await searchAllIndexers({ q: 'x' })

    expect(results).toEqual([])
    expect(config.recordIndexerResult).toHaveBeenCalledWith(2, false)
  })

  it('times out a hung adapter and records it as a failure instead of stalling the batch', async () => {
    vi.useFakeTimers()
    const indexer = mockIndexer({ id: 3, search_type: 'yts', torznab_url: '' })
    vi.mocked(config.getSearchableIndexers).mockReturnValue([indexer])
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // never resolves

    const promise = searchAllIndexers({ q: 'x' })
    await vi.advanceTimersByTimeAsync(15_000)
    const results = await promise

    expect(results).toEqual([])
    expect(config.recordIndexerResult).toHaveBeenCalledWith(3, false)
  })

  it('falls through torznab/unregistered types to searchIndexer without double-recording', async () => {
    const indexer = mockIndexer({ id: 4, search_type: 'torznab', torznab_url: 'https://example.com/torznab' })
    vi.mocked(config.getSearchableIndexers).mockReturnValue([indexer])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<rss><channel></channel></rss>'),
    }))

    await searchAllIndexers({ q: 'x' })

    // searchIndexer() self-records — the registry dispatch must not record a second time on top of it.
    expect(config.recordIndexerResult).toHaveBeenCalledTimes(1)
    expect(config.recordIndexerResult).toHaveBeenCalledWith(4, true)
  })
})
