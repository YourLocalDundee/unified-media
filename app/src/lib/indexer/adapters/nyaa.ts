// Nyaa adapter — anime-focused public indexer with an RSS feed.
// Parses the nyaa: namespace extensions for seeder/leecher/hash data.
import { parseStringPromise } from 'xml2js'
import type { TorznabResult } from '../types'

const NYAA_RSS = 'https://nyaa.si/?page=rss'

interface NyaaItem {
  title?: string[]
  link?: string[]
  guid?: string[]
  'nyaa:seeders'?: string[]
  'nyaa:leechers'?: string[]
  'nyaa:infoHash'?: string[]
  'nyaa:size'?: string[]
}

interface NyaaFeed {
  rss?: {
    channel?: Array<{
      item?: NyaaItem[]
    }>
  }
}

export async function searchNyaa(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${NYAA_RSS}&q=${encodeURIComponent(q)}&c=0_0&f=0`
    const res = await fetch(url)
    // Throw on a hard HTTP failure so the fan-out feeds it to indexer backoff; a 200 with no items
    // below is a healthy empty result (returns []), not a failure.
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml = await res.text()

    const parsed = await parseStringPromise(xml, { explicitArray: true }) as NyaaFeed
    const items = parsed?.rss?.channel?.[0]?.item
    if (!Array.isArray(items) || items.length === 0) return []

    const results: TorznabResult[] = []

    for (const item of items) {
      const title = item.title?.[0] ?? ''
      const downloadUrl = item.link?.[0] ?? ''
      const infoHash = (item['nyaa:infoHash']?.[0] ?? '').toLowerCase()
      const seeders = parseInt(item['nyaa:seeders']?.[0] ?? '0', 10) || 0
      const leechers = parseInt(item['nyaa:leechers']?.[0] ?? '0', 10) || 0
      const sizeStr = item['nyaa:size']?.[0] ?? ''

      // Parse size string like "1.0 GiB", "512 MiB" into bytes
      let size = 0
      const sizeMatch = sizeStr.match(/^([\d.]+)\s*(GiB|MiB|KiB|B)$/i)
      if (sizeMatch) {
        const num = parseFloat(sizeMatch[1])
        const unit = sizeMatch[2].toUpperCase()
        const multipliers: Record<string, number> = { GIB: 1024 ** 3, MIB: 1024 ** 2, KIB: 1024, B: 1 }
        size = Math.round(num * (multipliers[unit] ?? 1))
      }

      const magnetUrl = infoHash
        ? `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`
        : ''

      results.push({
        title,
        infoHash,
        magnetUrl,
        downloadUrl,
        size,
        seeders,
        leechers,
        indexerName: 'Nyaa',
        publishDate: '',
        categories: ['5070'],
      })
    }

    return results
  } catch (err) {
    // Propagate network/HTTP/parse failures so the fan-out records a backoff hit.
    throw err instanceof Error ? err : new Error(String(err))
  }
}
