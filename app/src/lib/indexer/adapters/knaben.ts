// Knaben adapter — meta-search over a large set of public trackers, POST JSON API. No account, no
// FlareSolverr. Confirmed live 2026-08-07. Each hit carries a `cachedOrigin` naming the tracker it
// came from, so one query here covers sites this app can't reach directly (1337x and friends are
// Cloudflare-gated to a plain fetch, but Knaben's own crawler already holds their rows).
// `hide_unsafe` plus the adult-category drop below keep XXX results out.
import type { TorznabResult } from '../types'
import { fetchWithTimeout, normalizeInfoHash } from './_shared'

const API_URL = 'https://api.knaben.org/v1'

// Newznab-standard 6000000 block is XXX. Knaben also carries free-text categories, so both are
// checked — a hit is dropped if either signals adult content.
const ADULT_CATEGORY_ID = 6000000
const ADULT_PATTERN = /\b(xxx|porn|adult|hentai)\b/i

interface KnabenHit {
  title?: string
  hash?: string
  magnetUrl?: string | null
  link?: string | null
  bytes?: number
  seeders?: number
  peers?: number
  date?: string
  category?: string
  categoryId?: number[]
}

interface KnabenResponse {
  hits?: KnabenHit[]
}

export async function searchKnaben(q: string): Promise<TorznabResult[]> {
  try {
    const res = await fetchWithTimeout(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        search_type: 'score',
        search_field: 'title',
        query: q,
        order_by: 'seeders',
        order_direction: 'desc',
        size: 100,
        hide_unsafe: true,
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as KnabenResponse
    if (!data.hits) return []

    const results: TorznabResult[] = []
    for (const hit of data.hits) {
      const title = hit.title?.trim()
      if (!title) continue
      if (hit.categoryId?.some(id => Math.floor(id / 1000000) * 1000000 === ADULT_CATEGORY_ID)) continue
      if (hit.category && ADULT_PATTERN.test(hit.category)) continue

      const infoHash = normalizeInfoHash(hit.hash ?? '')
      const magnetUrl = hit.magnetUrl ?? ''
      if (!infoHash && !magnetUrl) continue

      results.push({
        title,
        infoHash,
        magnetUrl,
        downloadUrl: hit.link ?? '',
        size: hit.bytes ?? 0,
        seeders: hit.seeders ?? 0,
        leechers: hit.peers ?? 0,
        indexerName: 'Knaben',
        publishDate: hit.date ? new Date(hit.date).toUTCString() : '',
        categories: hit.categoryId?.map(String) ?? [],
      })
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
