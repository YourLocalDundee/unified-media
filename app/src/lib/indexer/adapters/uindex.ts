// Uindex adapter — general public tracker (movies/TV/music), Cloudflare-gated. Routes through
// FlareSolverr (fetchSolvedHtml — see _shared.ts). Confirmed solvable live 2026-07-12. Magnet
// links are inline on the search results page once solved — no detail-page hop needed. The site's
// live markup has drifted from Prowlarr's own Cardigann definition (newer UI, different classes)
// — selectors below match the live page, not the YAML.
import type { TorznabResult } from '../types'
import { fetchSolvedHtml, normalizeInfoHash } from './_shared'

const SEARCH_URL = 'https://uindex.org/search.php'

const CATEGORY_MAP: Record<string, string> = {
  '1': '2000', // Movies
  '2': '5000', // TV
  '3': '1000', // Games
  '4': '3000', // Music
  '5': '4000', // Apps
  '6': '6000', // XXX
  '7': '5070', // Anime
}

function parseSize(text: string): number {
  const match = text.match(/([\d.]+)\s*([KMGT]i?B)/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = { B: 1, KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2, GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4 }
  return Math.round(num * (multipliers[unit] ?? 1))
}

export async function searchUindex(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${SEARCH_URL}?search=${encodeURIComponent(q)}&c=0`
    const $ = await fetchSolvedHtml(url)

    const results: TorznabResult[] = []
    $('table.sr-table > tbody > tr').each((_i, el) => {
      const row = $(el)
      const magnetUrl = row.find('a.sr-magnet').attr('href')
      if (!magnetUrl) return
      const infoHashMatch = magnetUrl.match(/urn:btih:([0-9a-fA-F]{40}|[2-7A-Z]{32})/i)
      if (!infoHashMatch) return

      const title = row.find('a.sr-torrent-link').attr('title') || row.find('a.sr-torrent-link').text().trim()
      if (!title) return
      const catId = row.find('td.sr-col-cat a').attr('href')?.match(/c=(\d+)/)?.[1]

      results.push({
        title,
        infoHash: normalizeInfoHash(infoHashMatch[1]),
        magnetUrl,
        downloadUrl: '',
        size: parseSize(row.find('td.sr-col-size').text()),
        seeders: parseInt(row.find('td.sr-col-seeders').text().trim(), 10) || 0,
        leechers: parseInt(row.find('td.sr-col-leechers').text().trim(), 10) || 0,
        indexerName: 'Uindex',
        publishDate: row.find('td.sr-col-uploaded').attr('title') || row.find('td.sr-col-uploaded').text().trim(),
        categories: catId && CATEGORY_MAP[catId] ? [CATEGORY_MAP[catId]] : [],
      })
    })
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
