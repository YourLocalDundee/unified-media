/**
 * Release name parser and quality scorer for Torznab search results.
 *
 * parseReleaseName extracts structured metadata (resolution, codec, source, S/E, year, title)
 * from a scene/P2P filename using regex anchoring to known quality tags.
 *
 * scoreRelease applies a quality profile's conditions to ReleaseMeta and returns a numeric
 * score (higher = better) or null if the release fails a required condition.
 *
 * The scorer is intentionally simple — it rewards known high-quality sources and resolutions
 * without trying to replicate Sonarr/Radarr's full custom format system.
 */

import type { ReleaseMeta, QualityCondition } from './types'

// ── language patterns (ported from Sonarr LanguageParser.cs) ─────────────────
//
// Each entry maps a regex to an ISO 639-1 code. The regex is tested against the
// full release name (case-insensitive). First match wins — order matters for
// ambiguous abbreviations (e.g. NL before NOR so neither shadows the other).
// MULTI is explicitly excluded — it signals multiple audio tracks, not a language.
// Untagged releases (no match) return null; callers decide how to treat unknowns.

const LANGUAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(English|ENG)\b/i,                        'en'],
  [/\b(French|VF|VOSTFR|TRUEFRENCH)\b/i,        'fr'],
  [/\b(German|Deutsch)\b/i,                      'de'],
  [/\b(Spanish|Español|ESP)\b/i,                 'es'],
  [/\b(Italian|Italiano)\b/i,                    'it'],
  [/\b(Portuguese|Portugues)\b/i,                'pt'],
  [/\b(Dutch|NL)\b/i,                            'nl'],
  [/\b(Japanese|JPN)\b/i,                        'ja'],
  [/\b(Chinese|CHI)\b/i,                         'zh'],
  [/\b(Korean|KOR)\b/i,                          'ko'],
  [/\b(Russian|RUS)\b/i,                         'ru'],
  [/\b(Danish|DAN)\b/i,                          'da'],
  [/\b(Finnish|FIN)\b/i,                         'fi'],
  [/\b(Norwegian|NOR)\b/i,                       'no'],
  [/\b(Swedish|SWE)\b/i,                         'sv'],
  [/\b(Polish|POL)\b/i,                          'pl'],
  [/\b(Hungarian|HUN)\b/i,                       'hu'],
  [/\b(Czech|CZE)\b/i,                           'cs'],
  [/\b(Turkish|TUR)\b/i,                         'tr'],
  [/\b(Arabic|ARB)\b/i,                          'ar'],
  [/\b(Hindi|HIN)\b/i,                           'hi'],
  [/\b(Hebrew|HEB)\b/i,                          'he'],
]

// Returns the ISO 639-1 language code detected from explicit tags in a release name,
// or null if no tag is found. Null means "unknown", not "English".
export function parseLanguage(name: string): string | null {
  for (const [re, code] of LANGUAGE_PATTERNS) {
    if (re.test(name)) return code
  }
  return null
}

// ── regex constants ────────────────────────────────────────────────────────────

// Word-boundary anchors (\b) prevent partial matches like "480p" inside "1480p"
const RE_RESOLUTION = /\b(2160p|1080p|720p|480p|576p)\b/i
const RE_CODEC      = /\b(x265|x264|H\.265|H\.264|HEVC|AVC|xvid|divx)\b/i
const RE_SOURCE     = /\b(BluRay|Blu-Ray|BDRip|BDRemux|REMUX|WEB-DL|WEBRip|WEBRIP|WEBDL|HDTV|DVDRip|CAM|TS|HDCAM)\b/i
// Scene groups always appear after the last hyphen and are 2–10 uppercase alphanum chars
const RE_GROUP      = /-([A-Z0-9]{2,10})$/i
// SxxExx is the dominant scene format; NxNN (e.g. "3x04") is a common alt for older content
const RE_SE         = /S(\d{1,2})E(\d{1,2})/i
const RE_SE_ALT     = /(\d{1,2})x(\d{2})/i
// Global flag required because we run matchAll to collect all year occurrences
const RE_YEAR       = /\b(19\d{2}|20[012]\d)\b/g

// ── codec normalisation ────────────────────────────────────────────────────────

// Collapse the several scene aliases for H.265 and H.264 into the two canonical values
// used by the scorer's RESOLUTION_BONUS table so comparisons always work.
function normaliseCodec(raw: string): string {
  const l = raw.toLowerCase()
  if (l === 'h.265' || l === 'hevc') return 'x265'
  if (l === 'h.264' || l === 'avc')  return 'x264'
  return raw.toLowerCase().startsWith('x') ? raw.toLowerCase() : raw
}

// ── source normalisation ───────────────────────────────────────────────────────

// Multiple scene tokens map to the same canonical source so SOURCE_BONUS lookups are reliable.
// BDRip/BDRemux are treated as BluRay quality; REMUX specifically gets the "BluRay REMUX" bonus.
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

// Extracts the human-readable title by slicing the filename at the earliest quality tag.
// Scene releases use dots/underscores as word separators, so we convert them to spaces.
export function extractTitle(rawName: string): string | null {
  // Cap input length to bound regex execution time on crafted indexer releases (A21-04).
  const name = rawName.length > 512 ? rawName.slice(0, 512) : rawName
  // Collect the string position of every known "end of title" marker
  const positions: number[] = []

  const resMatch = RE_RESOLUTION.exec(name)
  if (resMatch) positions.push(resMatch.index)

  const codecMatch = RE_CODEC.exec(name)
  if (codecMatch) positions.push(codecMatch.index)

  const seMatch = RE_SE.exec(name)
  if (seMatch) positions.push(seMatch.index)

  // For title-cut purposes we need the EARLIEST year occurrence (which ends the title
  // portion), but parseReleaseName uses the LAST year occurrence for the year value
  // (to avoid capturing the content's release year when an encode year appears later).
  const yearMatches = [...name.matchAll(RE_YEAR)]
  for (const m of yearMatches) {
    positions.push(m.index!)
  }

  // If no anchors found, the filename is too ambiguous to extract a title
  if (positions.length === 0) return null

  const cutAt = Math.min(...positions)
  const raw   = name.slice(0, cutAt)

  // Scene filenames use dots and underscores as spaces (e.g. "The.Dark.Knight.2008.1080p")
  const title = raw.replace(/[._]+/g, ' ').trim()
  return title.length > 0 ? title : null
}

// ── main parser ────────────────────────────────────────────────────────────────

export function parseReleaseName(rawName: string): ReleaseMeta {
  // Cap input length to bound regex execution time on crafted indexer releases (A21-04).
  const name = rawName.length > 512 ? rawName.slice(0, 512) : rawName
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

  // detected language (null = untagged, not necessarily English)
  const language = parseLanguage(name)

  return { resolution, codec, source, group, season, episode, year, parsedTitle, language }
}

// ── scorer ────────────────────────────────────────────────────────────────────

// Resolution and source bonuses are additive on top of the per-condition match bonus (+10 each).
// Bonus values are intentionally spaced so resolution drives the primary ranking and source
// breaks ties within the same resolution tier.
const RESOLUTION_BONUS: Record<string, number> = {
  '2160p': 40,
  '1080p': 30,
  '720p':  20,
  '480p':  10,
}

const SOURCE_BONUS: Record<string, number> = {
  'BluRay REMUX': 15,  // lossless remux — highest quality per bit
  'BluRay':       10,
  'WEB-DL':        8,
  'WEBRip':        6,
  'HDTV':          4,
}

function conditionMatches(meta: ReleaseMeta, cond: QualityCondition): boolean {
  let hit: boolean
  switch (cond.type) {
    case 'resolution': hit = (meta.resolution ?? '').toLowerCase() === cond.value.toLowerCase(); break
    case 'codec':      hit = (meta.codec ?? '').toLowerCase() === cond.value.toLowerCase(); break
    case 'source':     hit = (meta.source ?? '').toLowerCase() === cond.value.toLowerCase(); break
    default:           hit = false
  }
  return cond.negate ? !hit : hit
}

// Returns null on hard rejection (failed required condition); caller must treat null as "skip",
// not as a low score — a null result must never win over a zero-scored result.
// Kept for callers that still want strict pass/fail semantics; auto-pick now uses
// scoreReleaseSoft (below), which de-prioritizes instead of removing.
export function scoreRelease(
  meta: ReleaseMeta,
  conditions: QualityCondition[],
): number | null {
  let score = 0

  for (const cond of conditions) {
    const matched = conditionMatches(meta, cond)
    if (cond.required && !matched) return null  // hard reject
    if (matched) score += 10
  }

  // Resolution bonus: unknown resolution still gets 5 so it isn't penalised below sourced-only results
  score += meta.resolution ? (RESOLUTION_BONUS[meta.resolution] ?? 5) : 5

  // Source bonus: unknown source gets 0 (omitted from SOURCE_BONUS is intentional — CAM/TS etc.)
  score += meta.source ? (SOURCE_BONUS[meta.source] ?? 0) : 0

  return score
}

// Penalty (not removal) for a failed REQUIRED condition under the soft auto-pick model.
// Large enough that a clean match (each matched required condition = +10, plus resolution/
// source bonuses) reliably out-ranks a miss, but small relative to SEED_DEAD_PENALTY so a
// healthy out-of-spec release still beats a dead in-spec one. See grabber.ts for the full
// weight table and ordering proof.
export const REQUIRED_MISS_PENALTY = -100

// Soft variant of scoreRelease for auto-pick ranking: NEVER returns null. A failed required
// condition applies REQUIRED_MISS_PENALTY (de-prioritize) instead of hard-rejecting, so the
// release stays rankable and grab-able. Returns the QUALITY component only — the caller layers
// on seed and language weighting (which aren't derivable from the parsed title meta alone).
export function scoreReleaseSoft(
  meta: ReleaseMeta,
  conditions: QualityCondition[],
): number {
  let score = 0

  for (const cond of conditions) {
    const matched = conditionMatches(meta, cond)
    if (matched) score += 10
    else if (cond.required) score += REQUIRED_MISS_PENALTY
  }

  score += meta.resolution ? (RESOLUTION_BONUS[meta.resolution] ?? 5) : 5
  score += meta.source ? (SOURCE_BONUS[meta.source] ?? 0) : 0

  return score
}
