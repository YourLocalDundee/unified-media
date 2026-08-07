// TorrentsCSV adapter — general-purpose public torrent search engine (not movie/TV-specific), JSON
// API. No account, no FlareSolverr. Confirmed live 2026-07-12. No category data at all — results
// are left unclassified ([]) rather than guessing a category the source doesn't provide.
import type { TorznabResult } from '../types'
import { fetchWithTimeout } from './_shared'

const SEARCH_URL = 'https://torrents-csv.com/service/search'

const TRACKERS = [
  'tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce',
].join('&')

interface TorrentsCsvRow {
  infohash: string
  name: string
  size_bytes: number
  created_unix: number
  seeders: number
  leechers: number
}

interface TorrentsCsvResponse {
  torrents?: TorrentsCsvRow[]
}

export async function searchTorrentsCsv(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${SEARCH_URL}?q=${encodeURIComponent(q)}`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as TorrentsCsvResponse
    if (!data.torrents) return []

    return data.torrents.map(t => {
      const infoHash = t.infohash.toLowerCase()
      return {
        title: t.name,
        infoHash,
        magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(t.name)}&${TRACKERS}`,
        downloadUrl: '',
        size: t.size_bytes || 0,
        seeders: t.seeders || 0,
        leechers: t.leechers || 0,
        indexerName: 'TorrentsCSV',
        publishDate: new Date(t.created_unix * 1000).toUTCString(),
        categories: [],
      }
    })
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
