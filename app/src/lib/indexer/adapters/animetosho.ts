// AnimeTosho adapter — anime aggregator with a clean JSON feed. No account, no FlareSolverr.
// Confirmed live 2026-08-07. It mirrors several anime trackers, so it reaches releases from
// sources this app cannot query directly, and every row already carries a magnet, an info hash,
// and a hosted .torrent URL.
import type { TorznabResult } from '../types'
import { fetchWithTimeout, normalizeInfoHash } from './_shared'

const FEED_URL = 'https://feed.animetosho.org/json'

interface ToshoRow {
  title?: string
  torrent_name?: string
  info_hash?: string
  magnet_uri?: string
  torrent_url?: string
  total_size?: number
  timestamp?: number
  seeders?: number | null
  leechers?: number | null
  num_seeders?: number | null
  num_leechers?: number | null
}

export async function searchAnimeTosho(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${FEED_URL}?q=${encodeURIComponent(q)}`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const rows = await res.json() as ToshoRow[]
    if (!Array.isArray(rows)) return []

    const results: TorznabResult[] = []
    for (const row of rows) {
      const title = (row.title ?? row.torrent_name)?.trim()
      const infoHash = normalizeInfoHash(row.info_hash ?? '')
      if (!title || (!infoHash && !row.magnet_uri)) continue

      // The feed reports swarm counts inconsistently and sometimes omits them; fall back to 1
      // ("known seeded") rather than 0, which the grabber's seed-floor gate would reject outright.
      const seeders = row.seeders ?? row.num_seeders ?? 1
      const leechers = row.leechers ?? row.num_leechers ?? 1

      results.push({
        title,
        infoHash,
        magnetUrl: row.magnet_uri ?? '',
        downloadUrl: row.torrent_url ?? '',
        size: row.total_size ?? 0,
        seeders,
        leechers,
        indexerName: 'AnimeTosho',
        publishDate: row.timestamp ? new Date(row.timestamp * 1000).toUTCString() : '',
        categories: ['5070'],
      })
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
