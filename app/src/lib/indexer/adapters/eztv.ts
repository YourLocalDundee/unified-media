// EZTV adapter — TV-only public indexer with a JSON API.
// Searches by IMDB ID (strips "tt" prefix). Title search is unreliable — skip it.
import type { TorznabResult } from '../types'

const EZTV_API = 'https://eztv.re/api/get-torrents'

interface EztvTorrent {
  id: number
  hash: string
  filename: string
  torrent_url: string
  magnet_url: string
  title: string
  imdb_id: string
  seeds: number
  peers: number
  date_released_unix: number
  size_bytes: string
}

interface EztvResponse {
  torrents_count: number
  torrents?: EztvTorrent[]
}

export async function searchEztv(imdbId: string): Promise<TorznabResult[]> {
  try {
    // Strip the "tt" prefix for the EZTV API
    const numericId = imdbId.replace(/^tt/i, '')
    const url = `${EZTV_API}?imdb_id=${encodeURIComponent(numericId)}&limit=30&page=1`
    const res = await fetch(url)
    // Throw on a hard HTTP failure so the fan-out feeds it to indexer backoff; a 200 with no torrents
    // below is a healthy empty result (returns []), not a failure.
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as EztvResponse
    if (!data.torrents) return []

    return data.torrents.map(torrent => ({
      title: torrent.title || torrent.filename,
      infoHash: torrent.hash.toLowerCase(),
      magnetUrl: torrent.magnet_url,
      downloadUrl: torrent.torrent_url,
      size: parseInt(torrent.size_bytes, 10) || 0,
      seeders: torrent.seeds || 0,
      leechers: torrent.peers || 0,
      indexerName: 'EZTV',
      publishDate: new Date(torrent.date_released_unix * 1000).toUTCString(),
      categories: ['5000'],
      imdbId: `tt${torrent.imdb_id}`,
    }))
  } catch (err) {
    // Propagate network/HTTP/parse failures so the fan-out records a backoff hit.
    throw err instanceof Error ? err : new Error(String(err))
  }
}
