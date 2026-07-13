// LimeTorrents adapter — general public tracker, HTML scrape. Each row's download-icon link
// points straight at itorrents.net/torrent/{HASH}.torrent — the info hash is right there in the
// search results page, so this needs no detail-page hop despite Prowlarr's own Cardigann
// definition using one (it goes through the detail page for a .torrent URL; we just want the
// hash, which is cheaper to get directly). Confirmed live 2026-07-12.
import type { TorznabResult } from '../types'
import { fetchHtml } from './_shared'

const BASE_URL = 'https://www.limetorrents.fun'

const CATEGORY_MAP: Record<string, string> = {
  'tv shows': '5000',
  movies: '2000',
  music: '3000',
  anime: '5070',
  'e-books': '7000',
}

function parseSize(text: string): number {
  const match = text.match(/([\d.]+)\s*([KMGT]i?B)/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2, GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4 }
  return Math.round(num * (multipliers[unit] ?? 1))
}

export async function searchLimeTorrents(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${BASE_URL}/search/all/${encodeURIComponent(q)}/seeds/1/`
    const $ = await fetchHtml(url)

    const results: TorznabResult[] = []
    $('.table2 > tbody > tr[bgcolor]').each((_i, el) => {
      const row = $(el)
      const itorrentsHref = row.find('a[href*="itorrents"]').attr('href')
      const hashMatch = itorrentsHref?.match(/\/torrent\/([0-9a-fA-F]{40})/)
      if (!hashMatch) return
      const infoHash = hashMatch[1].toLowerCase()

      const titleLink = row.find('div.tt-name > a').last()
      const title = titleLink.text().trim() || 'Untitled'
      const cells = row.find('td')
      const dateText = cells.eq(1).text().trim()
      const sizeText = cells.eq(2).text().trim()
      const seeders = parseInt(row.find('.tdseed').text().replace(/,/g, ''), 10) || 0
      const leechers = parseInt(row.find('.tdleech').text().replace(/,/g, ''), 10) || 0
      const catMatch = dateText.match(/in (.+)$/i)
      const catKey = catMatch?.[1]?.trim().toLowerCase()

      results.push({
        title,
        infoHash,
        magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`,
        downloadUrl: '',
        size: parseSize(sizeText),
        seeders,
        leechers,
        indexerName: 'LimeTorrents',
        publishDate: dateText,
        categories: catKey && CATEGORY_MAP[catKey] ? [CATEGORY_MAP[catKey]] : [],
      })
    })
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
