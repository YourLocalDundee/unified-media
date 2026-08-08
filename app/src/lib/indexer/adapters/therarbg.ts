// TheRARBG adapter — general public tracker, JSON API via the `:format:json` path segment. No
// account, no FlareSolverr (the plain .com host is Cloudflare-gated; the .to host with the JSON
// format suffix is not). Confirmed live 2026-08-07. Field names are single letters — see the
// interface below. Magnets are built from the hash; the API returns no magnet field.
import type { TorznabResult } from '../types'
import { fetchWithTimeout, normalizeInfoHash } from './_shared'

const BASE_URL = 'https://therarbg.to'

const TRACKERS = [
  'tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
  'tr=udp%3A%2F%2Fopen.stealth.si%3A80%2Fannounce',
  'tr=udp%3A%2F%2Ftracker.torrent.eu.org%3A451%2Fannounce',
].join('&')

const ADULT_PATTERN = /\b(xxx|porn|adult|hentai)\b/i

interface RarbgRow {
  n?: string    // name
  h?: string    // info hash
  s?: number    // size in bytes
  se?: number   // seeders
  le?: number   // leechers
  a?: number    // added, Unix seconds
  c?: string    // category
  i?: string | null  // imdb id
}

export async function searchTheRarbg(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${BASE_URL}/get-posts/keywords:${encodeURIComponent(q)}:format:json/`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as RarbgRow[] | { results?: RarbgRow[] }
    const rows = Array.isArray(data) ? data : data.results ?? []

    const results: TorznabResult[] = []
    for (const row of rows) {
      const title = row.n?.trim()
      const infoHash = normalizeInfoHash(row.h ?? '')
      if (!title || !infoHash) continue
      if (row.c && ADULT_PATTERN.test(row.c)) continue

      results.push({
        title,
        infoHash,
        magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}&${TRACKERS}`,
        downloadUrl: '',
        size: row.s ?? 0,
        seeders: row.se ?? 0,
        leechers: row.le ?? 0,
        indexerName: 'TheRARBG',
        publishDate: row.a ? new Date(row.a * 1000).toUTCString() : '',
        categories: [],
        imdbId: row.i ?? undefined,
      })
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
