// Bangumi Moe adapter — anime-focused public tracker with a JSON API (POST, not REST-GET).
// No account, no FlareSolverr. Confirmed live 2026-07-12: the real response includes a ready-made
// `magnet` field directly (Prowlarr's Cardigann definition doesn't map it, but it's there).
import type { TorznabResult } from '../types'
import { fetchWithTimeout } from './_shared'

const SEARCH_URL = 'https://bangumi.moe/api/v2/torrent/search'

// bangumi.moe's own category_tag_id values (Mongo ObjectIds), mapped onto the standard Torznab
// IDs this app already tracks — unrecognized tags fall through to unclassified [].
const CATEGORY_MAP: Record<string, string> = {
  '549ef207fe682f7549f1ea90': '5070', // Anime
  '54967e14ff43b99e284d0bf7': '5070', // Anime Pack
  '549cc9369310bc7d04cddf9f': '2000', // Anime Movie
  '549eef6ffe682f7549f1ea8b': '3000', // Music
  '549eefebfe682f7549f1ea8c': '7000', // Comic
}

function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*([KMGT]i?B)$/i)
  if (!match) return 0
  const num = parseFloat(match[1])
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000, KIB: 1024,
    MB: 1000 ** 2, MIB: 1024 ** 2,
    GB: 1000 ** 3, GIB: 1024 ** 3,
    TB: 1000 ** 4, TIB: 1024 ** 4,
  }
  return Math.round(num * (multipliers[unit] ?? 1))
}

interface BangumiTorrent {
  title: string
  magnet: string
  infoHash: string
  category_tag_id: string
  size: string
  seeders: number
  leechers: number
  publish_time: string
}

interface BangumiResponse {
  torrents?: BangumiTorrent[]
}

export async function searchBangumiMoe(q: string): Promise<TorznabResult[]> {
  try {
    const res = await fetchWithTimeout(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as BangumiResponse
    if (!data.torrents) return []

    return data.torrents.map(t => ({
      title: t.title,
      infoHash: t.infoHash.toLowerCase(),
      magnetUrl: t.magnet,
      downloadUrl: '',
      size: parseSize(t.size),
      seeders: t.seeders || 0,
      leechers: t.leechers || 0,
      indexerName: 'Bangumi Moe',
      publishDate: t.publish_time,
      categories: CATEGORY_MAP[t.category_tag_id] ? [CATEGORY_MAP[t.category_tag_id]] : [],
    }))
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}
