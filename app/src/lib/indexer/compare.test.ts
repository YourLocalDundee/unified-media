import { describe, it, expect, vi, afterEach } from 'vitest'
import { compareIndexers } from './compare'
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

function rssXml(items: Array<{ title: string; seeders: number; infohash?: string }>): string {
  const itemsXml = items.map(i => `
    <item>
      <title>${i.title}</title>
      <link>https://example.com/dl</link>
      <guid>https://example.com/${i.title}</guid>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      <torznab:attr name="seeders" value="${i.seeders}"/>
      <torznab:attr name="leechers" value="0"/>
      ${i.infohash ? `<torznab:attr name="infohash" value="${i.infohash}"/>` : ''}
    </item>`).join('')
  return `<?xml version="1.0"?><rss><channel>${itemsXml}</channel></rss>`
}

describe('compareIndexers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('runs both sides independently and never records health/backoff', async () => {
    const indexerA = mockIndexer({ id: 1, name: 'A', torznab_url: 'https://a.example.com/torznab' })
    const indexerB = mockIndexer({ id: 2, name: 'B', torznab_url: 'https://b.example.com/torznab' })

    const fetchSpy = vi.fn((url: string) => {
      if (url.startsWith('https://a.example.com')) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(rssXml([{ title: 'A1', seeders: 3, infohash: 'a'.repeat(40) }])) })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(rssXml([
        { title: 'B1', seeders: 5, infohash: 'a'.repeat(40) },
        { title: 'B2', seeders: 1, infohash: 'c'.repeat(40) },
      ])) })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await compareIndexers(indexerA, indexerB, { q: 'test' })

    expect(result.a.resultCount).toBe(1)
    expect(result.a.sample[0].title).toBe('A1')
    expect(result.b.resultCount).toBe(2)
    expect(result.b.sample.map(s => s.title)).toEqual(['B1', 'B2'])
    // A1 and B1 share an infohash; B2 doesn't.
    expect(result.hashOverlapCount).toBe(1)
    expect(config.recordIndexerResult).not.toHaveBeenCalled()
  })

  it('reports hashOverlapCount as null when a side has no hashed results', async () => {
    const indexerA = mockIndexer({ id: 1, name: 'A', torznab_url: 'https://a.example.com/torznab' })
    const indexerB = mockIndexer({ id: 2, name: 'B', torznab_url: 'https://b.example.com/torznab' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(rssXml([{ title: 'X', seeders: 1 }])), // no infohash on either side
    }))

    const result = await compareIndexers(indexerA, indexerB, { q: 'test' })

    expect(result.hashOverlapCount).toBeNull()
  })

  it('reports an error side without throwing when one indexer fails', async () => {
    const indexerA = mockIndexer({ id: 1, name: 'A', torznab_url: 'https://a.example.com/torznab' })
    const indexerB = mockIndexer({ id: 2, name: 'B', torznab_url: 'https://b.example.com/torznab' })

    const fetchSpy = vi.fn((url: string) => {
      if (url.startsWith('https://a.example.com')) {
        return Promise.resolve({ ok: false, status: 503 })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(rssXml([{ title: 'B1', seeders: 1 }])) })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await compareIndexers(indexerA, indexerB, { q: 'test' })

    expect(result.a.status).toBe('error')
    expect(result.a.errorMessage).toContain('503')
    expect(result.b.status).toBe('ok')
    expect(result.hashOverlapCount).toBeNull()
    expect(config.recordIndexerResult).not.toHaveBeenCalled()
  })

  it('dispatches a registered adapter type directly instead of hitting the torznab_url', async () => {
    const nativeIndexer = mockIndexer({ id: 3, name: 'YTS', search_type: 'yts', torznab_url: '' })
    const prowlarrIndexer = mockIndexer({ id: 4, name: 'Prowlarr: YTS', torznab_url: 'https://prowlarr.example.com/torznab' })

    const fetchSpy = vi.fn((url: string) => {
      if (url.includes('accel.li')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            status: 'ok',
            data: { movies: [{ id: 1, title: 'Movie', year: 2000, imdb_code: 'tt1', torrents: [
              { url: 'https://yts.gg/torrent/download/d'.padEnd(48, '0'), quality: '1080p', type: 'bluray', seeds: 7, peers: 2, size: '1 GB', size_bytes: 1, hash: 'd'.repeat(40), date_uploaded_unix: 0 },
            ] }] },
          }),
        })
      }
      return Promise.resolve({ ok: true, text: () => Promise.resolve(rssXml([])) })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const result = await compareIndexers(nativeIndexer, prowlarrIndexer, { q: 'movie' })

    expect(result.a.status).toBe('ok')
    expect(result.a.resultCount).toBe(1)
    expect(fetchSpy.mock.calls.some(c => String(c[0]).includes('accel.li'))).toBe(true)
  })
})
