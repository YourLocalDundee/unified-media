/**
 * Quality profile scoring (PIECE 1).
 *
 * scoreWithProfile(releaseTitle, profileId) replaces the bare scoreRelease()
 * call in grabber.ts. It:
 *   1. Parses the release filename with parseReleaseName()
 *   2. Determines which quality tier the release falls into
 *   3. Evaluates custom formats (regex, resolution, source, codec conditions)
 *   4. Sums format scores and returns a combined result
 *
 * All DB access is isolated here so parser.ts stays a pure utility module.
 */

import { getDb } from '@/lib/db/index'
import { parseReleaseName } from './parser'
import type { ReleaseMeta } from './types'

// ── types ─────────────────────────────────────────────────────────────────────

export interface CustomFormatSpec {
  type: 'title_regex' | 'resolution' | 'source' | 'codec'
  value: string
  required: boolean
  negate: boolean
}

export interface QualityTier {
  id: number
  name: string
  label: string
  weight: number
}

export interface ScoreResult {
  qualityTierId: number | null
  qualityTierWeight: number
  totalScore: number
  matchedFormats: Array<{ name: string; score: number }>
}

// ── quality tier mapping ───────────────────────────────────────────────────────

// Maps (resolution, source) pairs to quality tier IDs. Order matters: more specific
// entries are checked first. Falls back to resolution-only, then Unknown (id=1).
function resolveTier(meta: ReleaseMeta): { id: number; weight: number } | null {
  const db = getDb()
  const res   = meta.resolution?.toLowerCase() ?? ''
  const src   = meta.source?.toLowerCase() ?? ''

  const isRemux  = src.includes('remux')
  const isBluray = src.includes('bluray') || src.includes('blu-ray') || src.includes('bdrip')
  const isWebdl  = src.includes('web-dl') || src.includes('webdl')
  const isWebrip = src.includes('webrip')

  let tierName: string | null = null

  if (res === '2160p') {
    if (isRemux)        tierName = 'Bluray-2160p-Remux'
    else if (isBluray)  tierName = 'Bluray-2160p'
    else if (isWebdl)   tierName = 'WEBDL-2160p'
    else if (isWebrip)  tierName = 'WEBRip-2160p'
    else                tierName = 'Bluray-2160p'   // best guess for unknown src at 2160p
  } else if (res === '1080p') {
    if (isRemux)        tierName = 'Bluray-1080p-Remux'
    else if (isBluray)  tierName = 'Bluray-1080p'
    else if (isWebdl)   tierName = 'WEBDL-1080p'
    else if (isWebrip)  tierName = 'WEBRip-1080p'
    else                tierName = 'WEBDL-1080p'
  } else if (res === '720p') {
    if (isBluray)       tierName = 'Bluray-720p'
    else if (isWebdl)   tierName = 'WEBDL-720p'
    else if (isWebrip)  tierName = 'WEBRip-720p'
    else                tierName = 'HDTV-720p'
  } else if (res === '480p' || res === '576p') {
    if (isBluray)       tierName = 'Bluray-480p'
    else if (isWebdl)   tierName = 'WEBDL-480p'
    else if (isWebrip)  tierName = 'WEBRip-480p'
    else                tierName = 'DVD'
  } else if (src.includes('dvd') || src.includes('dvdrip')) {
    tierName = 'DVD'
  } else if (src.includes('sdtv') || src.includes('pdtv') || src.includes('dsr')) {
    tierName = 'SDTV'
  }

  if (!tierName) return null

  const row = db.prepare('SELECT id, weight FROM quality_tiers WHERE name = ?').get(tierName) as { id: number; weight: number } | undefined
  return row ?? null
}

// ── custom format matching ─────────────────────────────────────────────────────

function specMatches(spec: CustomFormatSpec, meta: ReleaseMeta, rawTitle: string): boolean {
  let matched: boolean
  switch (spec.type) {
    case 'title_regex': {
      try {
        matched = new RegExp(spec.value, 'i').test(rawTitle)
      } catch {
        matched = false
      }
      break
    }
    case 'resolution':
      matched = (meta.resolution ?? '').toLowerCase() === spec.value.toLowerCase()
      break
    case 'source':
      matched = (meta.source ?? '').toLowerCase().includes(spec.value.toLowerCase())
      break
    case 'codec':
      matched = (meta.codec ?? '').toLowerCase() === spec.value.toLowerCase()
      break
    default:
      matched = false
  }
  return spec.negate ? !matched : matched
}

// Returns true if all specs in the format match (AND logic, same as Sonarr)
function formatMatches(specs: CustomFormatSpec[], meta: ReleaseMeta, rawTitle: string): boolean {
  return specs.every(s => specMatches(s, meta, rawTitle))
}

// ── main scoring function ──────────────────────────────────────────────────────

export function scoreWithProfile(releaseTitle: string, profileId: number): ScoreResult {
  const db = getDb()
  const meta = parseReleaseName(releaseTitle)

  const tier = resolveTier(meta)

  // Load custom formats assigned to this profile with their scores
  type FormatRow = { format_id: number; name: string; specs: string; score: number }
  const formatRows = db.prepare(`
    SELECT qpf.format_id, cf.name, cf.specs, qpf.score
    FROM quality_profile_formats qpf
    JOIN custom_formats cf ON cf.id = qpf.format_id
    WHERE qpf.profile_id = ?
  `).all(profileId) as FormatRow[]

  let totalScore = 0
  const matchedFormats: ScoreResult['matchedFormats'] = []

  for (const row of formatRows) {
    let specs: CustomFormatSpec[] = []
    try { specs = JSON.parse(row.specs) as CustomFormatSpec[] } catch { continue }
    if (formatMatches(specs, meta, releaseTitle)) {
      totalScore += row.score
      matchedFormats.push({ name: row.name, score: row.score })
    }
  }

  return {
    qualityTierId: tier?.id ?? null,
    qualityTierWeight: tier?.weight ?? 0,
    totalScore,
    matchedFormats,
  }
}

// ── admin helpers ──────────────────────────────────────────────────────────────

export interface QualityProfileFull {
  id: number
  name: string
  upgrade_allowed: number
  cutoff_quality_id: number | null
  min_format_score: number
  cutoff_format_score: number
  // ISO 639-1 language code or 'any'. 'any' disables the language constraint on auto-pick grabs.
  language: string
  formats: Array<{ format_id: number; name: string; specs: string; score: number }>
  // Parsed quality conditions (resolution/source/codec filters)
  conditions: import('./types').QualityCondition[]
  // NULL = admin-shared profile visible to all users; non-null = private to that user.
  user_id: string | null
}

export function getProfileFull(profileId: number): QualityProfileFull | null {
  const db = getDb()
  const profile = db.prepare('SELECT * FROM quality_profiles WHERE id = ?').get(profileId) as Record<string, unknown> | undefined
  if (!profile) return null

  type FormatRow = { format_id: number; name: string; specs: string; score: number }
  const formats = db.prepare(`
    SELECT qpf.format_id, cf.name, cf.specs, qpf.score
    FROM quality_profile_formats qpf
    JOIN custom_formats cf ON cf.id = qpf.format_id
    WHERE qpf.profile_id = ?
    ORDER BY cf.name
  `).all(profileId) as FormatRow[]

  let conditions: import('./types').QualityCondition[] = []
  try {
    const raw = profile.conditions as string | null
    if (raw) conditions = JSON.parse(raw)
  } catch { /* malformed JSON — treat as no conditions */ }

  return {
    id: profile.id as number,
    name: profile.name as string,
    upgrade_allowed: (profile.upgrade_allowed as number) ?? 1,
    cutoff_quality_id: profile.cutoff_quality_id as number | null,
    min_format_score: (profile.min_format_score as number) ?? 0,
    cutoff_format_score: (profile.cutoff_format_score as number) ?? 0,
    language: (profile.language as string) ?? 'any',
    formats,
    conditions,
    user_id: (profile.user_id as string | null) ?? null,
  }
}

// Returns shared profiles (user_id IS NULL) plus any private profiles owned by userId.
// Pass userId=null (or omit) to get only shared profiles (e.g. for admin pages).
export function getAllProfiles(userId?: string | null): QualityProfileFull[] {
  const db = getDb()
  const rows = userId
    ? db.prepare('SELECT id FROM quality_profiles WHERE user_id IS NULL OR user_id = ? ORDER BY user_id NULLS FIRST, id')
        .all(userId) as { id: number }[]
    : db.prepare('SELECT id FROM quality_profiles WHERE user_id IS NULL ORDER BY id')
        .all() as { id: number }[]
  return rows.map(r => getProfileFull(r.id)).filter(Boolean) as QualityProfileFull[]
}

export function getAllTiers(): QualityTier[] {
  return getDb().prepare('SELECT * FROM quality_tiers ORDER BY weight DESC').all() as QualityTier[]
}

export function getAllCustomFormats(): Array<{ id: number; name: string; specs: string }> {
  return getDb().prepare('SELECT * FROM custom_formats ORDER BY name').all() as Array<{ id: number; name: string; specs: string }>
}
