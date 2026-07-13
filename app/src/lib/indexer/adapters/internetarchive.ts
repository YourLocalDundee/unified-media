// Internet Archive adapter — archive.org's own advancedsearch.php JSON API, filtered to items
// that actually have a BitTorrent file. No account, no FlareSolverr. Confirmed live 2026-07-12.
// Archive.org doesn't expose real per-item seeder/leecher counts via this API (Prowlarr's own
// Cardigann definition hardcodes 1/1 too) — its own seed infrastructure guarantees availability,
// so 1/1 here signals "known seeded", not a literal swarm count.
import type { TorznabResult } from '../types'
import { fetchWithTimeout } from './_shared'

const SEARCH_URL = 'https://archive.org/advancedsearch.php'

const MEDIATYPE_CATEGORY_MAP: Record<string, string> = {
  movies: '2000',
  audio: '3000',
  etree: '3000',
  texts: '7000',
}

interface ArchiveDoc {
  identifier: string
  title?: string
  mediatype?: string
  item_size?: number
  btih?: string
  publicdate?: string
}

interface ArchiveResponse {
  response?: { docs?: ArchiveDoc[] }
}

export async function searchInternetArchive(q: string): Promise<TorznabResult[]> {
  try {
    const query = `title:(${q}) AND format:("Archive BitTorrent")`
    const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}` +
      `&fl[]=${encodeURIComponent('identifier,title,mediatype,item_size,btih,publicdate')}` +
      `&sort=-publicdate&rows=100&output=json`
    const res = await fetchWithTimeout(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as ArchiveResponse
    const docs = data.response?.docs
    if (!Array.isArray(docs)) return []

    const results: TorznabResult[] = []
    for (const doc of docs) {
      if (!doc.btih) continue // no torrent file on this item — nothing to grab
      const infoHash = doc.btih.toLowerCase()
      const title = doc.title || doc.identifier
      results.push({
        title,
        infoHash,
        magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`,
        downloadUrl: `https://archive.org/download/${doc.identifier}/${doc.identifier}_archive.torrent`,
        size: doc.item_size ?? 0,
        seeders: 1,
        leechers: 1,
        indexerName: 'Internet Archive',
        publishDate: doc.publicdate ?? '',
        categories: doc.mediatype && MEDIATYPE_CATEGORY_MAP[doc.mediatype] ? [MEDIATYPE_CATEGORY_MAP[doc.mediatype]] : [],
      })
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
