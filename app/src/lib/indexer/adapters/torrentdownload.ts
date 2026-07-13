// TorrentDownload adapter — general torrent meta-search engine, HTML scrape. Each row's detail
// link is literally "/{infoHash}/{slug}" — the hash is right there in the search results page, so
// (like limetorrents.ts) this needs no detail-page hop despite Prowlarr's own Cardigann definition
// using one. Confirmed live 2026-07-12.
import type { TorznabResult } from '../types'
import { fetchHtml } from './_shared'

const BASE_URL = 'https://www.torrentdownload.info'

const CATEGORY_MAP: Record<string, string> = {
  movies: '2000', movie: '2000',
  tv: '5000', television: '5000',
  anime: '5070',
  music: '3000', audio: '3000',
  games: '1000', game: '1000',
  apps: '4000', applications: '4000', software: '4000',
  books: '7000', ebooks: '7000',
  adult: '6000', xxx: '6000',
}

function parseSize(text: string): number {
  const match = text.match(/([\d.]+)\s*([KMGT]i?B)/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2, GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4 }
  return Math.round(num * (multipliers[unit] ?? 1))
}

export async function searchTorrentDownload(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${BASE_URL}/search?q=${encodeURIComponent(q)}`
    const $ = await fetchHtml(url)

    const results: TorznabResult[] = []
    $('table.table2 > tbody > tr:has(span.smallish)').each((_i, el) => {
      const row = $(el)
      const link = row.find('div.tt-name > a').first()
      const href = link.attr('href')
      const hashMatch = href?.match(/^\/([0-9a-fA-F]{40})\//)
      if (!hashMatch) return
      const infoHash = hashMatch[1].toLowerCase()
      const title = link.text().trim() || 'Untitled'
      const catText = row.find('span.smallish').text().replace(/[^A-Za-z]/g, '').toLowerCase()
      const cells = row.find('td')

      results.push({
        title,
        infoHash,
        magnetUrl: `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`,
        downloadUrl: '',
        size: parseSize(cells.eq(2).text()),
        seeders: parseInt(row.find('.tdseed').text().replace(/,/g, ''), 10) || 0,
        leechers: parseInt(row.find('.tdleech').text().replace(/,/g, ''), 10) || 0,
        indexerName: 'TorrentDownload',
        publishDate: cells.eq(1).text().trim(),
        categories: CATEGORY_MAP[catText] ? [CATEGORY_MAP[catText]] : [],
      })
    })
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
