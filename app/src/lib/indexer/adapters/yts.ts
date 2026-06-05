// YTS adapter — movie-only public indexer with a JSON API.
// No auth, no FlareSolverr needed.
import type { TorznabResult } from '../types'

const YTS_API = 'https://yts.mx/api/v2/list_movies.json'

const TRACKERS = [
  'tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80',
  'tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969',
].join('&')

interface YtsTorrent {
  quality: string
  type: string
  seeds: number
  peers: number
  size: string
  size_bytes: number
  hash: string
  date_uploaded_unix: number
}

interface YtsMovie {
  id: number
  title: string
  year: number
  imdb_code: string
  torrents?: YtsTorrent[]
}

interface YtsResponse {
  status: string
  data?: {
    movies?: YtsMovie[]
  }
}

export async function searchYts(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${YTS_API}?query_term=${encodeURIComponent(q)}&limit=20&sort_by=seeds`
    const res = await fetch(url)
    if (!res.ok) return []
    const data = await res.json() as YtsResponse
    if (data.status !== 'ok' || !data.data?.movies) return []

    const results: TorznabResult[] = []

    for (const movie of data.data.movies) {
      if (!movie.torrents) continue
      for (const torrent of movie.torrents) {
        const dn = encodeURIComponent(`${movie.title} ${torrent.quality}`)
        const magnetUrl = `magnet:?xt=urn:btih:${torrent.hash}&dn=${dn}&${TRACKERS}`
        const downloadUrl = `https://yts.mx/torrent/download/${torrent.hash}.torrent`

        results.push({
          title: `${movie.title} (${movie.year}) [${torrent.quality}] [${torrent.type}]`,
          infoHash: torrent.hash.toLowerCase(),
          magnetUrl,
          downloadUrl,
          size: torrent.size_bytes,
          seeders: torrent.seeds,
          leechers: torrent.peers,
          indexerName: 'YTS',
          publishDate: new Date(torrent.date_uploaded_unix * 1000).toUTCString(),
          categories: ['2000'],
          imdbId: movie.imdb_code,
        })
      }
    }

    return results
  } catch {
    return []
  }
}
