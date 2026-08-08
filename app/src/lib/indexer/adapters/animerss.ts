// Shared parser for the plain-RSS anime trackers (Tokyo Toshokan, ACG.RIP, ACGNX, Kisssub).
// Confirmed live 2026-08-07. Unlike nyaa.ts these feeds carry no namespaced swarm/hash extensions:
// the info hash has to be dug out of whichever field the site happens to expose it in — an
// <enclosure> magnet, a magnet link inside the CDATA description, or a 40-hex substring of the
// item URL. Seeder counts are absent everywhere here, so rows report 1/1 ("known listed") the same
// way internetarchive.ts and mikan.ts do; the swarm truth arrives when the client adds the magnet.
import { parseStringPromise } from 'xml2js'
import type { TorznabResult } from '../types'
import { fetchWithTimeout, normalizeInfoHash } from './_shared'

// Adult material is out of scope for this app's catalog. These feeds mix it into ordinary search
// results (Tokyo Toshokan in particular carries explicit categories), so every row is checked
// against its title and category text before being surfaced.
const ADULT_PATTERN = /\b(hentai|xxx|porn|adult|ecchi|18\+|r-?18)\b/i

interface RssItem {
  title?: (string | { _?: string })[]
  link?: string[]
  guid?: (string | { _?: string })[]
  description?: (string | { _?: string })[]
  category?: (string | { _?: string })[]
  pubDate?: string[]
  enclosure?: { $?: { url?: string; length?: string; fileSize?: string } }[]
  'torrent:contentLength'?: string[]
  'media:content'?: { $?: { fileSize?: string } }[]
}

interface RssFeed {
  rss?: { channel?: { item?: RssItem[] }[] }
}

/** xml2js hands back either a bare string or a {_: value} node depending on CDATA/attributes. */
function text(field: RssItem[keyof RssItem]): string {
  const first = Array.isArray(field) ? field[0] : field
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && '_' in first) return String(first._ ?? '')
  return ''
}

const HEX40 = /\b([0-9a-fA-F]{40})\b/
const MAGNET = /magnet:\?xt=urn:btih:[^"'\s&<]+(?:&(?:amp;)?[^"'\s<]*)*/

export async function searchAnimeRss(
  q: string,
  feedUrl: string,
  indexerName: string,
  timeoutMs = 10_000,
): Promise<TorznabResult[]> {
  try {
    const res = await fetchWithTimeout(feedUrl.replace('{q}', encodeURIComponent(q)), {}, timeoutMs)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const parsed = await parseStringPromise(await res.text(), { explicitArray: true }) as RssFeed
    const items = parsed?.rss?.channel?.[0]?.item
    if (!Array.isArray(items) || items.length === 0) return []

    const results: TorznabResult[] = []
    for (const item of items) {
      const title = text(item.title).trim()
      if (!title) continue
      const category = text(item.category)
      if (ADULT_PATTERN.test(title) || ADULT_PATTERN.test(category)) continue

      const description = text(item.description)
      const link = text(item.link)
      const guid = text(item.guid)
      const enclosureUrl = item.enclosure?.[0]?.$?.url ?? ''

      // Magnet: enclosure first (ACGNX puts it there), then the description body (Tokyo Toshokan).
      let magnetUrl = enclosureUrl.startsWith('magnet:') ? enclosureUrl : ''
      if (!magnetUrl) magnetUrl = description.match(MAGNET)?.[0].replace(/&amp;/g, '&') ?? ''

      // Hash: from the magnet, else a 40-hex run in any of the URLs (Kisssub/ACGNX slugs are the
      // hash itself). Base32 magnets are normalized to hex by normalizeInfoHash.
      let infoHash = normalizeInfoHash(magnetUrl.match(/urn:btih:([^&]+)/)?.[1] ?? '')
      if (!infoHash) {
        infoHash = normalizeInfoHash(
          enclosureUrl.match(HEX40)?.[1] ?? link.match(HEX40)?.[1] ?? guid.match(HEX40)?.[1] ?? '',
        )
      }
      if (!magnetUrl && infoHash) {
        magnetUrl = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`
      }

      // A row with neither a magnet nor a .torrent URL is unusable downstream — skip it rather
      // than emit a result the grabber would fail on.
      const downloadUrl = !enclosureUrl.startsWith('magnet:') ? enclosureUrl : ''
      if (!magnetUrl && !downloadUrl) continue

      // Take the largest candidate rather than the first: several of these feeds emit a
      // placeholder enclosure length of 0 or 1 while carrying the real size in the description
      // ("| 51.0GB |"), so first-wins would report a 1-byte torrent.
      const size = Math.max(
        parseInt(item['torrent:contentLength']?.[0] ?? '', 10) || 0,
        parseInt(item['media:content']?.[0]?.$?.fileSize ?? '', 10) || 0,
        parseInt(item.enclosure?.[0]?.$?.length ?? '', 10) || 0,
        parseSizeFromText(description),
      )

      results.push({
        title,
        infoHash,
        magnetUrl,
        downloadUrl,
        size,
        seeders: 1,
        leechers: 1,
        indexerName,
        publishDate: item.pubDate?.[0] ?? '',
        categories: ['5070'],
      })
    }
    return results
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err))
  }
}

/**
 * Last-resort size parse for feeds that only mention it in prose ("Size: 15.72MB", "| 51.0GB |").
 * Returns 0 rather than NaN on anything unparseable — the number field is a bare `[\d.]+`, so a
 * malformed run like "..MB" reaches parseFloat as NaN (seen live on Tokyo Toshokan), and a NaN
 * size propagates silently through the size-cap gate instead of failing loudly.
 */
function parseSizeFromText(text: string): number {
  const match = text.match(/([\d.]+)\s*([KMGT]i?B)/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  if (!Number.isFinite(value)) return 0
  const unit = match[2].toUpperCase()
  const multipliers: Record<string, number> = {
    B: 1, KB: 1024, KIB: 1024, MB: 1024 ** 2, MIB: 1024 ** 2,
    GB: 1024 ** 3, GIB: 1024 ** 3, TB: 1024 ** 4, TIB: 1024 ** 4,
  }
  return Math.round(value * (multipliers[unit] ?? 1))
}
