import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseCapsXml, testIndexer } from './index'
import type { Indexer } from './types'

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

  it('skips the network call for non-torznab search types', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await testIndexer(mockIndexer({ search_type: 'yts', torznab_url: '' }))

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
