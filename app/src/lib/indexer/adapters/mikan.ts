// Mikan adapter — Chinese anime tracker, HTML scrape. Magnet links are inline on the search
// results page (data-clipboard-text attribute) — single request per search, no detail-page hop.
// No real seeders/leechers exposed by the site at all (Prowlarr's own Cardigann definition
// hardcodes 1/1 too) — same "known seeded, not a literal count" caveat as internetarchive.ts.
// Confirmed live 2026-07-12.
import type { TorznabResult } from '../types'
import { fetchHtml, normalizeInfoHash } from './_shared'

const SEARCH_URL = 'https://mikanani.me/Home/Search'

export async function searchMikan(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${SEARCH_URL}?searchstr=${encodeURIComponent(q)}`
    const $ = await fetchHtml(url)

    const results: TorznabResult[] = []
    $('table.table-striped tbody tr').each((_i, el) => {
      const row = $(el)
      const magnetUrl = row.find('a[data-clipboard-text]').attr('data-clipboard-text')
      if (!magnetUrl) return
      const infoHashMatch = magnetUrl.match(/urn:btih:([0-9a-fA-F]{40}|[2-7A-Z]{32})/i)
      if (!infoHashMatch) return

      const title = row.find('a[href^="/Home/Episode/"]').text().trim()
      const rowText = row.text()
      const sizeMatch = rowText.match(/([\d.]+)\s*([KMGT]i?B)/i)
      const dateMatch = rowText.match(/(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2})/)

      let size = 0
      if (sizeMatch) {
        const num = parseFloat(sizeMatch[1])
        const unit = sizeMatch[2].toUpperCase()
        const multipliers: Record<string, number> = { B: 1, KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2, GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4 }
        size = Math.round(num * (multipliers[unit] ?? 1))
      }

      results.push({
        title: title || 'Untitled',
        infoHash: normalizeInfoHash(infoHashMatch[1]),
        magnetUrl,
        downloadUrl: '',
        size,
        seeders: 1,
        leechers: 1,
        indexerName: 'Mikan',
        publishDate: dateMatch ? dateMatch[1] : '',
        categories: ['5070'],
      })
    })
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
