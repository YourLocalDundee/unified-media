// BT.etree adapter — live-music (bootleg FLAC) tracker, HTML scrape. This community serves plain
// .torrent files via download.php, not magnets, and there's no info hash anywhere on the page
// (would need to download and bencode-parse the .torrent itself to get one) — downloadUrl-only
// results are expected here, not a bug; they fall into searchAllIndexers' "no infoHash" bucket
// (skipped by hash-dedup, kept as-is). Confirmed live 2026-07-12.
import type { TorznabResult } from '../types'
import { fetchHtml } from './_shared'

const BASE_URL = 'https://bt.etree.org'

function parseSize(text: string): number {
  const match = text.match(/([\d.]+)\s*([KMGT]i?B)/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2, GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4 }
  return Math.round(num * (multipliers[unit] ?? 1))
}

export async function searchBtEtree(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${BASE_URL}/?searchzzzz=${encodeURIComponent(q)}&cat=0&sort=seeders`
    const $ = await fetchHtml(url)

    const results: TorznabResult[] = []
    $('table[bgcolor="#CCCCCC"] tbody tr').each((_i, el) => {
      const row = $(el)
      const downloadHref = row.find('a[href^="download.php"]').attr('href')
      if (!downloadHref) return

      const title = row.find('a.details_link').text().trim()
      if (!title) return
      const cells = row.find('td')

      results.push({
        title,
        infoHash: '',
        magnetUrl: '',
        downloadUrl: `${BASE_URL}/${downloadHref}`,
        size: parseSize(cells.eq(5).text()),
        seeders: parseInt(cells.eq(7).text().trim(), 10) || 0,
        leechers: parseInt(cells.eq(8).text().trim(), 10) || 0,
        indexerName: 'BT.etree',
        publishDate: cells.eq(4).text().trim(),
        categories: ['3000'],
      })
    })
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
