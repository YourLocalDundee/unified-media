// YTS adapter — movie-only public indexer with a JSON API.
// No auth, no FlareSolverr needed.
//
// 2026-07-13: yts.mx stopped resolving entirely (confirmed NXDOMAIN from the real .mx TLD
// authority via a public resolver, not a local DNS/blocklist issue) — YTS has moved domains
// before and will likely move again. Following the mirror chain live: yts.mx dead -> yts.am/
// yts.ag/yts.lt all 301 to yts.gg -> yts.gg's own API response carries a notice that the base URL
// is moving to movies-api.accel.li, which already serves clean (non-deprecated-notice) responses.
// Using that as the current endpoint. If this ever breaks again, the same live-check approach
// (follow known mirrors' redirects, read the API's own migration notice) is the fastest way to
// find wherever it moved to next.
import type { TorznabResult } from '../types'
import { fetchWithTimeout } from './_shared'

const YTS_API = 'https://movies-api.accel.li/api/v2/list_movies.json'

const TRACKERS = [
  'tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80',
  'tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969',
].join('&')

interface YtsTorrent {
  url: string
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
    const res = await fetchWithTimeout(url)
    // Throw on a hard HTTP failure so the fan-out feeds it to indexer backoff; a 200 with no movies
    // below is a healthy empty result (returns []), not a failure.
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as YtsResponse
    if (data.status !== 'ok' || !data.data?.movies) return []

    const results: TorznabResult[] = []

    for (const movie of data.data.movies) {
      if (!movie.torrents) continue
      for (const torrent of movie.torrents) {
        const dn = encodeURIComponent(`${movie.title} ${torrent.quality}`)
        const magnetUrl = `magnet:?xt=urn:btih:${torrent.hash}&dn=${dn}&${TRACKERS}`
        // The API supplies the real download link directly — using it instead of hand-constructing
        // one against a hardcoded domain means this doesn't break again the next time the download
        // host (currently yts.gg, previously yts.mx) moves without the API host also moving.
        const downloadUrl = torrent.url

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
  } catch (err) {
    // Propagate network/HTTP/parse failures so the fan-out records a backoff hit.
    throw err instanceof Error ? err : new Error(String(err))
  }
}
