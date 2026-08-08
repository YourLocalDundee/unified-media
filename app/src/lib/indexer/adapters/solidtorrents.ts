// SolidTorrents adapter — general public torrent search engine, JSON API. No account, no
// FlareSolverr. Confirmed live 2026-08-07. The API returns an info hash but no magnet, so one is
// built from the hash plus the standard tracker set (same approach as torrentscsv.ts).
import type { TorznabResult } from '../types'
import { fetchWithTimeout, normalizeInfoHash } from './_shared'

const SEARCH_URL = 'https://solidtorrents.to/api/v1/search'

const TRACKERS = [
  'tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce',
].join('&')

// category 5 is the site's XXX bucket — dropped rather than surfaced.
const ADULT_CATEGORY = 5

interface SolidTorrentsRow {
  infohash?: string
  title?: string
  size?: number
  seeders?: number
  leechers?: number
  category?: number
  createdAt?: string
}

interface SolidTorrentsResponse {
  results?: SolidTorrentsRow[]
}

export async function searchSolidTorrents(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}&sort=seeders`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as SolidTorrentsResponse
    if (!data.results) return []

    const results: TorznabResult[] = []
    for (const row of data.results) {
      const title = row.title?.trim()
      const infoHash = normalizeInfoHash(row.infohash ?? '')
      if (!title || !infoHash) continue
      if (row.category === ADULT_CATEGORY) continue

      results.push({
        title,
        infoHash,
        magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}&${TRACKERS}`,
        downloadUrl: '',
        size: row.size ?? 0,
        seeders: row.seeders ?? 0,
        leechers: row.leechers ?? 0,
        indexerName: 'SolidTorrents',
        publishDate: row.createdAt ? new Date(row.createdAt).toUTCString() : '',
        categories: [],
      })
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
