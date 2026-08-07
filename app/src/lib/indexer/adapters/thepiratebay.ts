// The Pirate Bay adapter — general public tracker, unofficial JSON API at apibay.org (the same
// backend TPB's own site uses). No account, no FlareSolverr — apibay.org isn't Cloudflare-gated
// even though thepiratebay.org itself is (that's why this hits apibay.org directly, not a TPB
// domain). Confirmed live 2026-07-12.
import type { TorznabResult } from '../types'
import { fetchWithTimeout } from './_shared'

const APIBAY_URL = 'https://apibay.org/q.php'

// A no-match query returns a single sentinel row with id "0" — must be filtered out, not treated
// as a real (if useless) result.
const NO_RESULT_SENTINEL_ID = '0'

const TRACKERS = [
  'tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce',
  'tr=udp%3A%2F%2Fexodus.desync.com%3A6969%2Fannounce',
].join('&')

// TPB's own numeric category IDs, coarse-mapped onto the standard Torznab IDs this app already
// uses elsewhere (see categories.ts) — TPB spans far more categories than we track distinctly, so
// anything outside movies/TV/audio/books falls through to an unclassified [] rather than guessing.
const CATEGORY_MAP: Record<string, string> = {
  '207': '2040', // HD Movies
  '211': '2045', // UHD Movies
  '200': '2000', '201': '2000', '202': '2000', '204': '2000', '209': '2000', '210': '2000', '299': '2000',
  '208': '5040', // HD TV
  '212': '5045', // UHD TV
  '205': '5000', '206': '5000', // TV
  '101': '3000', '104': '3000', // Music / FLAC
  '601': '7000', // E-books
}

interface ApibayTorrent {
  id: string
  name: string
  info_hash: string
  leechers: string
  seeders: string
  size: string
  added: string
  category: string
  imdb?: string
}

export async function searchThePirateBay(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${APIBAY_URL}?q=${encodeURIComponent(q)}&cat=`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as ApibayTorrent[]
    if (!Array.isArray(data)) return []

    const results: TorznabResult[] = []
    for (const t of data) {
      if (t.id === NO_RESULT_SENTINEL_ID) continue
      const infoHash = t.info_hash.toLowerCase()
      const magnetUrl = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(t.name)}&${TRACKERS}`

      results.push({
        title: t.name,
        infoHash,
        magnetUrl,
        downloadUrl: '',
        size: parseInt(t.size, 10) || 0,
        seeders: parseInt(t.seeders, 10) || 0,
        leechers: parseInt(t.leechers, 10) || 0,
        indexerName: 'The Pirate Bay',
        publishDate: new Date(parseInt(t.added, 10) * 1000).toUTCString(),
        categories: CATEGORY_MAP[t.category] ? [CATEGORY_MAP[t.category]] : [],
        ...(t.imdb && t.imdb !== '0' ? { imdbId: t.imdb } : {}),
      })
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
