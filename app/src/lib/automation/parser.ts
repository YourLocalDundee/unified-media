import type { ReleaseMeta, QualityCondition } from './types'

// ── regex constants ────────────────────────────────────────────────────────────

const RE_RESOLUTION = /\b(2160p|1080p|720p|480p|576p)\b/i
const RE_CODEC      = /\b(x265|x264|H\.265|H\.264|HEVC|AVC|xvid|divx)\b/i
const RE_SOURCE     = /\b(BluRay|Blu-Ray|BDRip|BDRemux|REMUX|WEB-DL|WEBRip|WEBRIP|WEBDL|HDTV|DVDRip|CAM|TS|HDCAM)\b/i
const RE_GROUP      = /-([A-Z0-9]{2,10})$/i
const RE_SE         = /S(\d{1,2})E(\d{1,2})/i
const RE_SE_ALT     = /(\d{1,2})x(\d{2})/i
const RE_YEAR       = /\b(19\d{2}|20[012]\d)\b/g

// ── codec normalisation ────────────────────────────────────────────────────────

function normaliseCodec(raw: string): string {
  const l = raw.toLowerCase()
  if (l === 'h.265' || l === 'hevc') return 'x265'
  if (l === 'h.264' || l === 'avc')  return 'x264'
  return raw.toLowerCase().startsWith('x') ? raw.toLowerCase() : raw
}

// ── source normalisation ───────────────────────────────────────────────────────

function normaliseSource(raw: string): string {
  const l = raw.toLowerCase()
  if (l === 'blu-ray')               return 'BluRay'
  if (l === 'bdrip' || l === 'bdremux') return 'BluRay'
  if (l === 'remux')                 return 'BluRay REMUX'
  if (l === 'webdl')                 return 'WEB-DL'
  if (l === 'webrip')                return 'WEBRip'
  // canonical casing for the rest
  const canonical: Record<string, string> = {
    bluray: 'BluRay',
    'web-dl': 'WEB-DL',
    webrip: 'WEBRip',
    hdtv: 'HDTV',
    dvdrip: 'DVDRip',
    cam: 'CAM',
    ts: 'TS',
    hdcam: 'HDCAM',
  }
  return canonical[l] ?? raw
}

// ── title extraction ───────────────────────────────────────────────────────────

export function extractTitle(name: string): string | null {
  // positions of each anchor
  const positions: number[] = []

  const resMatch = RE_RESOLUTION.exec(name)
  if (resMatch) positions.push(resMatch.index)

  const codecMatch = RE_CODEC.exec(name)
  if (codecMatch) positions.push(codecMatch.index)

  const seMatch = RE_SE.exec(name)
  if (seMatch) positions.push(seMatch.index)

  // collect ALL year matches, take last one (index is used for title extraction)
  const yearMatches = [...name.matchAll(RE_YEAR)]
  // for the title cut we want the FIRST occurrence that ends the title portion
  // but spec says prefer the LAST match for the year value — for cutting the title
  // we still want the earliest boundary among resolution/year/SxxExx/codec
  if (yearMatches.length > 0) {
    // add all year positions so the earliest one is caught
    for (const m of yearMatches) {
      positions.push(m.index!)
    }
  }

  if (positions.length === 0) return null

  const cutAt = Math.min(...positions)
  const raw   = name.slice(0, cutAt)

  const title = raw.replace(/[._]+/g, ' ').trim()
  return title.length > 0 ? title : null
}

// ── main parser ────────────────────────────────────────────────────────────────

export function parseReleaseName(name: string): ReleaseMeta {
  // resolution — first match
  const resMatch = RE_RESOLUTION.exec(name)
  const resolution = resMatch ? resMatch[1].toLowerCase() as ReleaseMeta['resolution'] : null

  // codec — first match, then normalise
  const codecMatch = RE_CODEC.exec(name)
  const codec = codecMatch ? normaliseCodec(codecMatch[1]) : null

  // source — first match, then normalise
  const srcMatch = RE_SOURCE.exec(name)
  const source = srcMatch ? normaliseSource(srcMatch[1]) : null

  // group — after final hyphen, alphanumeric 2-10 chars
  const groupMatch = RE_GROUP.exec(name)
  const group = groupMatch ? groupMatch[1] : null

  // season / episode — SxxExx first, then NxNN fallback
  let season: number | null = null
  let episode: number | null = null

  const seMatch = RE_SE.exec(name)
  if (seMatch) {
    season  = parseInt(seMatch[1], 10)
    episode = parseInt(seMatch[2], 10)
  } else {
    const seAltMatch = RE_SE_ALT.exec(name)
    if (seAltMatch) {
      season  = parseInt(seAltMatch[1], 10)
      episode = parseInt(seAltMatch[2], 10)
    }
  }

  // year — prefer LAST match
  const yearMatches = [...name.matchAll(RE_YEAR)]
  const year = yearMatches.length > 0
    ? parseInt(yearMatches[yearMatches.length - 1][1], 10)
    : null

  // parsed title
  const parsedTitle = extractTitle(name)

  return { resolution, codec, source, group, season, episode, year, parsedTitle }
}

// ── scorer ────────────────────────────────────────────────────────────────────

const RESOLUTION_BONUS: Record<string, number> = {
  '2160p': 40,
  '1080p': 30,
  '720p':  20,
  '480p':  10,
}

const SOURCE_BONUS: Record<string, number> = {
  'BluRay REMUX': 15,
  'BluRay':       10,
  'WEB-DL':        8,
  'WEBRip':        6,
  'HDTV':          4,
}

function conditionMatches(meta: ReleaseMeta, cond: QualityCondition): boolean {
  switch (cond.type) {
    case 'resolution':
      return (meta.resolution ?? '').toLowerCase() === cond.value.toLowerCase()
    case 'codec':
      return (meta.codec ?? '').toLowerCase() === cond.value.toLowerCase()
    case 'source':
      return (meta.source ?? '').toLowerCase() === cond.value.toLowerCase()
    default:
      return false
  }
}

export function scoreRelease(
  meta: ReleaseMeta,
  conditions: QualityCondition[],
): number | null {
  let score = 0

  for (const cond of conditions) {
    const matched = conditionMatches(meta, cond)
    if (cond.required && !matched) return null
    if (matched) score += 10
  }

  // resolution bonus
  score += meta.resolution ? (RESOLUTION_BONUS[meta.resolution] ?? 5) : 5

  // source bonus
  score += meta.source ? (SOURCE_BONUS[meta.source] ?? 0) : 0

  return score
}
