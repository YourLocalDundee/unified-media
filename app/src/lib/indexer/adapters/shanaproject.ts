// Shana Project adapter — anime tracker, HTML scrape. Each row's Download button links straight
// to a .torrent file on the search results page itself (`/download/{id}/`) — no magnet, no info
// hash, no detail-page hop needed. downloadUrl-only is expected here, same as btetree.ts.
// Confirmed live 2026-07-12.
import type { TorznabResult } from '../types'
import { fetchHtml } from './_shared'

const BASE_URL = 'https://www.shanaproject.com'

export async function searchShanaProject(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${BASE_URL}/search/?title=${encodeURIComponent(q)}&subber=&sort=date&dir=Descending`
    const $ = await fetchHtml(url)

    const results: TorznabResult[] = []
    $('div.grid_12 > div[id^="rel"]').each((_i, el) => {
      const row = $(el)
      const downloadHref = row.find('a[href^="/download/"]').attr('href')
      if (!downloadHref) return

      const title = row.find('div.release_leftover > div.release_text_contents').first().text().trim()
      if (!title) return
      const sizeText = row.find('div.release_size').text().trim()

      results.push({
        title,
        infoHash: '',
        magnetUrl: '',
        downloadUrl: `${BASE_URL}${downloadHref}`,
        size: parseSizeToBytes(sizeText),
        seeders: 1,
        leechers: 1,
        indexerName: 'Shana Project',
        publishDate: '',
        categories: ['5070'],
      })
    })
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

function parseSizeToBytes(text: string): number {
  const match = text.match(/([\d.]+)\s*([KMGT]i?B)/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2, GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4 }
  return Math.round(num * (multipliers[unit] ?? 1))
}
