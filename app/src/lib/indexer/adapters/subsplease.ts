// SubsPlease adapter — single-fansub-group anime tracker with a public JSON API. No account, no
// FlareSolverr. Confirmed live 2026-07-12. Response is an object keyed by show title, not an
// array, and doesn't expose seeders/leechers at all — 0/0 here is an honest "unknown", not a real
// zero, mirroring the internetarchive.ts precedent of documenting the API's own limitation rather
// than fabricating a number.
import type { TorznabResult } from '../types'
import { fetchWithTimeout, normalizeInfoHash } from './_shared'

const SEARCH_URL = 'https://subsplease.org/api/'

interface SubsPleaseDownload {
  res: string
  magnet: string
}

interface SubsPleaseEntry {
  show: string
  episode: string
  release_date: string
  downloads: SubsPleaseDownload[]
}

type SubsPleaseResponse = Record<string, SubsPleaseEntry>

function extractInfoHash(magnet: string): string {
  const match = magnet.match(/urn:btih:([0-9a-fA-F]{40}|[2-7A-Z]{32})/i)
  // SubsPlease's own magnets use Base32 BTIH (confirmed live 2026-07-13) — normalizeInfoHash
  // converts to canonical hex so this matches the same release's hash from any hex-encoded source.
  return match ? normalizeInfoHash(match[1]) : ''
}

function extractSize(magnet: string): number {
  const match = magnet.match(/[?&]xl=(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

export async function searchSubsPlease(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${SEARCH_URL}?f=search&tz=UTC&s=${encodeURIComponent(q)}`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as SubsPleaseResponse | []
    // The API returns `[]` (not `{}`) when there are zero matches.
    if (Array.isArray(data)) return []

    const results: TorznabResult[] = []
    for (const entry of Object.values(data)) {
      for (const dl of entry.downloads) {
        const infoHash = extractInfoHash(dl.magnet)
        if (!infoHash) continue
        results.push({
          title: `${entry.show} - ${entry.episode} [${dl.res}p]`,
          infoHash,
          magnetUrl: dl.magnet,
          downloadUrl: '',
          size: extractSize(dl.magnet),
          seeders: 0,
          leechers: 0,
          indexerName: 'SubsPlease',
          publishDate: entry.release_date,
          categories: ['5070'],
        })
      }
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
