// dmhy adapter — Taiwanese anime tracker, Cloudflare-gated. Routes through FlareSolverr
// (fetchSolvedHtml — see _shared.ts). Confirmed solvable live 2026-07-12 (unlike several other
// Tier C candidates that were dropped: FlareSolverr actually clears dmhy's challenge). Magnet
// links are inline on the search results page once solved — no detail-page hop needed.
import type { TorznabResult } from '../types'
import { fetchSolvedHtml, normalizeInfoHash } from './_shared'

const SEARCH_URL = 'https://share.dmhy.org/topics/list'

const CATEGORY_MAP: Record<string, string> = {
  '2': '5070', '31': '5070', '7': '5070', // Anime / Quarterly Complete / RAW
  '3': '7000', // Manga
  '4': '3000', '43': '3000', '44': '3000', '15': '3000', // Music
  '6': '5000', '41': '5000', '42': '5000', // TV drama
  '9': '1000', '17': '1000', '18': '1000', '19': '1000', '20': '1000', '21': '1000', // Games
}

export async function searchDmhy(q: string): Promise<TorznabResult[]> {
  try {
    const url = `${SEARCH_URL}?keyword=${encodeURIComponent(q)}&sort_id=0&team_id=0&order=date-desc`
    const $ = await fetchSolvedHtml(url)

    const results: TorznabResult[] = []
    $('table tbody tr').each((_i, el) => {
      const row = $(el)
      const magnetUrl = row.find('a[href^="magnet:?"]').attr('href')
      if (!magnetUrl) return
      const infoHashMatch = magnetUrl.match(/urn:btih:([0-9a-fA-F]{40}|[2-7A-Z]{32})/i)
      if (!infoHashMatch) return

      const title = row.find('a[href^="/topics/view/"]').text().trim()
      if (!title) return
      const cells = row.find('td')
      const fullDate = cells.eq(0).find('span').text().trim() // hidden span: "2026/07/12 14:27"
      const catId = row.find('td:nth-child(2) a').attr('href')?.match(/\/(\d+)$/)?.[1]
      const size = cells.eq(4).text().trim()
      const seeders = parseInt(cells.eq(5).text().trim(), 10) || 0
      const leechers = parseInt(cells.eq(6).text().trim(), 10) || 0

      results.push({
        title,
        infoHash: normalizeInfoHash(infoHashMatch[1]),
        magnetUrl: magnetUrl.replace(/dn=(&|$)/, `dn=${encodeURIComponent(title)}$1`),
        downloadUrl: '',
        size: parseSizeToBytes(size),
        seeders,
        leechers,
        indexerName: 'dmhy',
        publishDate: fullDate ? `${fullDate} +08:00` : '',
        categories: catId && CATEGORY_MAP[catId] ? [CATEGORY_MAP[catId]] : [],
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
