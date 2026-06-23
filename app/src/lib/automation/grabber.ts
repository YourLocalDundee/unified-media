/**
 * Grabber: orchestrates the full search-and-grab flow for a single monitored item.
 *
 * Responsibilities:
 *   - Build Torznab search params from the item's title and media type
 *   - Fan out to all enabled indexers via searchAllIndexers
 *   - Score each result against the item's quality profile and pick the best
 *   - Push the winner to the active download client (qBittorrent by default)
 *   - Record the grab in grab_history and transition the item status to 'grabbed'
 *
 * The scheduler calls grabItem() for every wanted item on a 15-minute cron.
 * The admin API at /api/automation/items/[id]/grab also calls it for on-demand grabs.
 */

import { getClient } from '@/lib/download-client/registry'
import { searchAllIndexers } from '@/lib/indexer/index'
import { parseReleaseName, parseLanguage, scoreReleaseSoft } from './parser'
import { scoreWithProfile } from './quality'
import { getProfileById, recordGrab, updateItem } from './monitor'
import { recordGrabResults, type ScoredCandidate, type SkipReason } from './grab-results'
import { partitionByGates, gateKey, loadBlocklist, getGateConfig, evaluateGates } from './gates'
import type { MonitoredItem, QualityProfile, QualityCondition, MediaType } from './types'
import type { TorznabResult } from '@/lib/indexer/types'
import { getDb } from '@/lib/db/index'

// Strip CR/LF so DB-sourced title strings cannot forge additional log lines (A21-07).
const sanitizeLog = (s: string) => s.replace(/[\r\n]/g, ' ')

// ---------------------------------------------------------------------------
// buildSearchParams
// ---------------------------------------------------------------------------

/**
 * Build Torznab search params from a monitored item.
 * Category 2000 = Movies, 5000 = TV — these are the standard Newznab/Torznab category IDs.
 * Using a top-level category (2000 vs 2030) lets each indexer decide which sub-cats to include.
 *
 * For TV, the search query is refined based on scope_type so the indexer returns relevant results:
 *   - 'episodes': "Title S01E05" (specific episode)
 *   - 'seasons' with one season: "Title S01" (season pack)
 *   - 'seasons' with multiple seasons or 'full': title only (caller should filter or accept any)
 */
export function buildSearchParams(item: MonitoredItem): { q: string; cats: string } {
  const cats = item.type === 'movie' ? '2000' : '5000'

  if (item.type === 'tv') {
    const scopeType = item.scope_type ?? 'full'

    if (scopeType === 'episodes' && item.scope_episodes) {
      let eps: Array<{ s: number; e: number }> = []
      try { eps = JSON.parse(item.scope_episodes) } catch { /* malformed DB column — skip scope */ }
      if (Array.isArray(eps) && eps.length > 0) {
        const ep = eps[0]
        // ep.e > 99 means TMDB is using absolute episode numbering (e.g. One Piece ep 422
        // stored as S13E422 in TMDB, but released on Nyaa as "One Piece - 422").
        // Build a bare absolute-number query so Nyaa/anime indexers find it.
        if (ep.e > 99) {
          return { q: `${item.title} ${ep.e}`, cats }
        }
        const s = String(ep.s).padStart(2, '0')
        const e = String(ep.e).padStart(2, '0')
        return { q: `${item.title} S${s}E${e}`, cats }
      }
    }

    if (scopeType === 'seasons' && item.scope_seasons) {
      let seasons: number[] = []
      try { const p = JSON.parse(item.scope_seasons); if (Array.isArray(p)) seasons = p } catch { /* malformed DB column — skip scope */ }
      if (seasons.length === 1) {
        // Season pack search — "Title S01" finds both individual episodes and packs;
        // filterByScope below will prefer packs and reject stray episodes from other seasons.
        const s = String(seasons[0]).padStart(2, '0')
        return { q: `${item.title} S${s}`, cats }
      }
    }
  }

  // 'full', multiple seasons, movies: search by title only
  return { q: item.title, cats }
}

/**
 * Filter Torznab results to only those whose release title plausibly matches the requested scope.
 * Returns null (not_found sentinel) when the filtered list is empty so the caller never falls back
 * to random content.
 *
 * For 'full' or 'movie' scope — no filtering; return all results unchanged.
 * For 'seasons'              — keep only releases that contain S##/Season N and do NOT look like
 *                              individual episode releases (S##E##), preferring season packs.
 * For 'episodes'             — keep only releases whose title contains the exact S##E## identifier.
 */
export function filterByScope(
  results: TorznabResult[],
  item: MonitoredItem,
): TorznabResult[] | null {
  const scopeType = item.scope_type ?? (item.type === 'movie' ? 'movie' : 'full')

  // Title/year pin for ALL scopes: a release whose embedded 4-digit year contradicts the
  // item's known year is a different production (e.g. the 2023 live-action One Piece vs the
  // 1999 anime). Applied before every scope branch so full/seasons/episodes all exclude it.
  // A 'full' or 'seasons' search is title-only, so without this guard the 2023 live-action
  // releases sail straight through and tie on score with the real anime.
  const itemYear = item.year ?? null
  const yearRe = /\b(19|20)\d{2}\b/
  const pool = itemYear
    ? results.filter(r => {
        const m = r.title.match(yearRe)
        return !m || parseInt(m[0], 10) === itemYear
      })
    : results

  if (scopeType === 'full' || scopeType === 'movie') return pool

  if (scopeType === 'episodes' && item.scope_episodes) {
    let eps: Array<{ s: number; e: number }> = []
    try { const p = JSON.parse(item.scope_episodes); if (Array.isArray(p)) eps = p } catch { return null }
    if (eps.length === 0) return null

    const candidatesForScope = pool

    // Build scope-match pattern. When ep.e > 99 the episode number is TMDB absolute
    // (e.g. S13E422 for One Piece), so releases use bare absolute numbering on Nyaa:
    // "[Group] One Piece - 422 [1080p]". Accept BOTH the S##E## form AND a delimited bare number.
    const patterns = eps.map(ep => {
      const s = String(ep.s).padStart(2, '0')
      const e = String(ep.e).padStart(2, '0')
      const standard = `S${s}E${e}|${ep.s}x${String(ep.e).padStart(2, '0')}`
      if (ep.e > 99) {
        // Bare absolute number. Left: not preceded by a digit (so "1422" doesn't match 422, while
        // "EP422"/"E422" still do). Right: not a digit, hex char, OR '-', so a CRC tag "[422CDD99]"
        // and a range endpoint ("422-458") can't false-match this single episode. Real single forms
        // ("422 ", "(422)", "422.") still match. Range/batch packs are also excluded outright below.
        return `${standard}|(?<![0-9])${ep.e}(?![0-9a-fA-F-])`
      }
      return standard
    })
    const re = new RegExp(patterns.join('|'), 'i')

    // Regression 1(b): a single-episode item must NEVER match a multi-episode RANGE/BATCH pack — the
    // "422 matching 422-458" substring bug. Exclude pack-shaped titles outright (numeric ranges like
    // "422-458", season ranges "S01-S03", episode ranges "E01-E12", and batch/complete/season-pack
    // markers), then match the exact episode in what remains. Covering packs are grabbed up front by
    // the route's prefer-pack fan-out (findCoveringPacks); per-episode items only fill the true gaps.
    const rangePackRe =
      /(?<![0-9])\d{1,4}\s*[-–~]\s*\d{1,4}(?![0-9])|\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b|\bE\d{1,3}\s*[-–]\s*E?\d{1,3}\b|\b(?:batch|complete|season\s*pack)\b/i
    const filtered = candidatesForScope.filter(r => !rangePackRe.test(r.title) && re.test(r.title))
    return filtered.length > 0 ? filtered : null
  }

  if (scopeType === 'seasons' && item.scope_seasons) {
    let seasons: number[] = []
    try { const p = JSON.parse(item.scope_seasons); if (Array.isArray(p)) seasons = p } catch { return null }
    if (seasons.length === 0) return null

    // For each requested season, accept releases that include S## or "Season N".
    // Prefer packs (no SxxExx in the title) but still accept individual episodes as fallback.
    const seasonPatterns = seasons.map(n => {
      const s = String(n).padStart(2, '0')
      return `S${s}|Season.?${n}(?!\\d)`
    })
    const seasonRe = new RegExp(seasonPatterns.join('|'), 'i')
    // Individual episode pattern — used to partition results into packs vs. episodes
    const episodeRe = /S\d{2}E\d{2}/i

    const matching = pool.filter(r => seasonRe.test(r.title))
    if (matching.length === 0) return null

    // Prefer season packs (no S##E## pattern); fall back to individual episodes only if no packs found
    const packs = matching.filter(r => !episodeRe.test(r.title))
    return packs.length > 0 ? packs : matching
  }

  return pool
}

// ---------------------------------------------------------------------------
// Auto-pick scoring (Bug 2: de-prioritize, never hard-reject)
// ---------------------------------------------------------------------------

// A dead release (0 seeds) is ungrabbable, so it must sink below ANY live release regardless of
// quality. Live releases rank by quality (scoreReleaseSoft: profile conditions + resolution +
// source bonuses, with REQUIRED_MISS_PENALTY for a missed required condition) plus a language
// preference penalty, plus a seed bonus capped so seeds never dominate quality among live releases.
//
// Worked ordering for a "1080p-required" profile (matched cond +10, res: 1080p +30/720p +20/480p +10,
// source: WEB-DL +8/WEBRip +6, REQUIRED_MISS_PENALTY -100):
//   A healthy in-range 1080p WEB-DL, 7 seeds  = +10 +30 +8 +7            = +55
//   B healthy in-range 480p  WEBRip, 7 seeds  = -100 +10 +6 +7           = -77
//   C dead   in-range 1080p WEB-DL, 0 seeds   = +10 +30 +8 -1000         = -952
//   => A > B > C  (healthy-correct > healthy-wrong > dead-correct), and among live releases a
//      720p miss (-73) still ranks above a 480p miss (-77), so higher quality wins when alive.
const SEED_DEAD_PENALTY = -1000   // 0-seed sink; dominates the entire quality range
const SEED_CAP = 100              // cap seed contribution so seeds never out-weigh quality among live releases
const LANG_MISS_PENALTY = -100    // language mismatch when a preference is set (soften: was a hard skip)

function seedScore(seeders: number): number {
  return seeders > 0 ? Math.min(seeders, SEED_CAP) : SEED_DEAD_PENALTY
}

function languagePenalty(title: string, language: string): number {
  if (language === 'any') return 0
  return parseLanguage(title) === language ? 0 : LANG_MISS_PENALTY
}

/**
 * Full auto-pick rank for one release: soft quality + custom-format + seeds + language preference.
 * NEVER hard-rejects — a release that fails a required condition or the language preference is
 * de-prioritized, not removed. Exported so the grab-results display and the cron rank identically.
 */
export function autoPickScore(
  result: TorznabResult,
  conditions: QualityCondition[],
  profileId: number,
  language: string,
): number {
  const meta = parseReleaseName(result.title)
  const quality = scoreReleaseSoft(meta, conditions)
  // Pass the release size so 'size' custom formats can match (other format types ignore it).
  const fmt = scoreWithProfile(result.title, profileId, result.size).totalScore
  return quality + fmt + seedScore(result.seeders) + languagePenalty(result.title, language)
}

/**
 * Pick the highest-ranked release for AUTO-grab, or null if none is grabbable.
 *
 * Uses autoPickScore (soft, never hard-rejects). Because SEED_DEAD_PENALTY dominates the quality
 * range, every live (seeders>0) release out-ranks every dead one — so if the best result is still
 * dead, EVERY scope-matched candidate is dead and we return null (auto must not enqueue an
 * undownloadable 0-seed torrent). Those releases remain in the interactive admin list and stay
 * grab-able by manual override.
 */
export function findBestRelease(
  results: TorznabResult[],
  profile: QualityProfile,
  language = 'any',
  // When provided, releases that fail a hard gate (blocklist/sample/oversize/dead) are excluded
  // from the auto-pick. Callers that have already gate-filtered their pool can omit it.
  gateOpts?: { type: MediaType; blocked?: Set<string> },
): TorznabResult | null {
  let conditions: QualityCondition[] = []
  try { const p = JSON.parse(profile.conditions); if (Array.isArray(p)) conditions = p } catch { conditions = [] }

  const gateConfig = gateOpts ? getGateConfig(gateOpts.type) : null
  const blocked = gateConfig ? gateOpts!.blocked ?? loadBlocklist() : null

  let bestResult: TorznabResult | null = null
  let bestScore = -Infinity

  for (const result of results) {
    // Hard gates exclude a release from auto-pick entirely (it stays in the interactive list).
    if (gateConfig && blocked && evaluateGates(result, gateConfig, blocked).length > 0) continue
    const s = autoPickScore(result, conditions, profile.id, language)
    if (s > bestScore) {
      bestScore = s
      bestResult = result
    }
  }

  if (bestResult && bestResult.seeders <= 0) return null // best is dead → nothing grabbable for auto
  return bestResult
}

// ---------------------------------------------------------------------------
// findSeasonPack — availability probe for the admin season-grab (no side effects)
// ---------------------------------------------------------------------------

/**
 * Search indexers for a SEASON PACK of one season and return the best release that
 * passes the quality profile + language, or null if no pack qualifies. Pack-only:
 * releases naming the season but NOT an individual S##E## episode (mirrors the
 * pack-preference in filterByScope). Read-only — used to decide pack vs. episode
 * fallback before anything is grabbed.
 */
export async function findSeasonPack(
  title: string,
  seasonNumber: number,
  profile: QualityProfile,
  language = 'any',
): Promise<TorznabResult | null> {
  const s = String(seasonNumber).padStart(2, '0')
  const raw = await searchAllIndexers({ q: `${title} S${s}`, cats: '5000' })
  const seasonRe = new RegExp(`S${s}|Season.?${seasonNumber}(?!\\d)`, 'i')
  const episodeRe = /S\d{2}E\d{2}/i
  const packs = raw.filter((r) => seasonRe.test(r.title) && !episodeRe.test(r.title))
  if (packs.length === 0) return null
  return findBestRelease(packs, profile, language, { type: 'tv' })
}

/**
 * Search indexers for an ARC PACK covering a TMDB-episode-group arc (Bug 7), e.g. One Piece
 * "Impel Down" = absolute eps 422–456. Anime arcs are released as absolute-numbered range packs
 * ("One Piece 422-456"), so we query the range and the start episode, then keep releases that
 * reference an overlapping numeric range (or, failing that, any of the arc's episode numbers).
 * Read-only — mirrors findSeasonPack; the caller decides pack vs. episode fan-out.
 */
export async function findArcPack(
  title: string,
  episodes: Array<{ s: number; e: number }>,
  profile: QualityProfile,
  language = 'any',
): Promise<TorznabResult | null> {
  const nums = episodes.map((e) => e.e).filter((n) => typeof n === 'number' && n > 0).sort((a, b) => a - b)
  if (nums.length === 0) return null
  const start = nums[0]
  const end = nums[nums.length - 1]

  // De-duplicated union of the range query and the start-episode query.
  const seen = new Set<string>()
  const raw: TorznabResult[] = []
  for (const q of [`${title} ${start}-${end}`, `${title} ${start}`]) {
    for (const r of await searchAllIndexers({ q, cats: '5000' })) {
      const k = r.infoHash || r.title
      if (!seen.has(k)) { seen.add(k); raw.push(r) }
    }
  }
  if (raw.length === 0) return null

  // Prefer releases that name a numeric range overlapping the arc (a real pack).
  const rangeRe = /(?<![0-9])(\d{2,4})\s*[-–]\s*(\d{2,4})(?![0-9])/
  const packs = raw.filter((r) => {
    const m = r.title.match(rangeRe)
    if (!m) return false
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10)
    return a <= end && b >= start // overlaps the arc range
  })
  // Fallback: any release whose title contains one of the arc's absolute episode numbers
  // (bare number, not a CRC hex tail).
  const numbered = raw.filter((r) =>
    nums.some((n) => new RegExp(`(?<![0-9])${n}(?![0-9a-fA-F])`).test(r.title)),
  )
  const pool = packs.length > 0 ? packs : numbered
  if (pool.length === 0) return null
  return findBestRelease(pool, profile, language, { type: 'tv' })
}

// ---------------------------------------------------------------------------
// findCoveringPacks — prefer-pack fan-out (Regression 1)
// ---------------------------------------------------------------------------

// A real pack names a numeric range in its title ("One Piece 422-458"). 2-4 digit endpoints, not
// adjacent to other digits, so a CRC tag or resolution doesn't read as a range.
const PACK_RANGE_RE = /(?<![0-9])(\d{2,4})\s*[-–~]\s*(\d{2,4})(?![0-9])/

/**
 * Pure pack-selection (Regression 1). Given the requested absolute episode numbers and a list of
 * candidate releases (title + seeders + auto-pick score), pick a MINIMAL set of HEALTHY packs whose
 * title range covers the most requested episodes — widest coverage first, ties broken by quality
 * score. Dead (0-seed) releases and non-range singles are ignored. Returns the chosen packs (each
 * with the requested episode numbers it covers) and the union of covered numbers; the caller fans
 * out per-episode singles only for the rest. Exported pure so the coverage math is unit-verifiable.
 */
export function selectCoveringPacks<T>(
  requestedNums: number[],
  candidates: Array<{ title: string; seeders: number; score: number; release: T }>,
): { chosen: Array<{ release: T; covers: number[] }>; covered: Set<number> } {
  const req = [...new Set(requestedNums)].filter((n) => n > 0).sort((a, b) => a - b)
  if (req.length === 0) return { chosen: [], covered: new Set() }

  type Pack = { release: T; covers: number[]; score: number }
  const packs: Pack[] = []
  for (const c of candidates) {
    if (c.seeders <= 0) continue // never auto-grab a dead pack
    const m = c.title.match(PACK_RANGE_RE)
    if (!m) continue
    const lo = Math.min(parseInt(m[1], 10), parseInt(m[2], 10))
    const hi = Math.max(parseInt(m[1], 10), parseInt(m[2], 10))
    const covers = req.filter((n) => n >= lo && n <= hi)
    if (covers.length >= 2) packs.push({ release: c.release, covers, score: c.score }) // a real multi-ep pack
  }
  // Widest coverage first so we grab "a pack or two", then highest quality on ties.
  packs.sort((a, b) => b.covers.length - a.covers.length || b.score - a.score)

  const covered = new Set<number>()
  const chosen: Array<{ release: T; covers: number[] }> = []
  for (const p of packs) {
    if (!p.covers.some((n) => !covered.has(n))) continue // adds no new coverage — skip
    chosen.push({ release: p.release, covers: p.covers })
    for (const n of p.covers) covered.add(n)
    if (covered.size >= req.length) break
  }
  return { chosen, covered }
}

/**
 * Search indexers for PACKS that cover a requested absolute-episode range and select a minimal
 * covering set (Regression 1). Mirrors findArcPack's queries but returns a SET of packs plus the
 * episode numbers they cover, so the episode fan-out can grab the packs and only queue singles for
 * the uncovered gaps. Read-only.
 */
export async function findCoveringPacks(
  title: string,
  episodes: Array<{ s: number; e: number }>,
  profile: QualityProfile,
  language = 'any',
): Promise<{ chosen: Array<{ release: TorznabResult; covers: number[] }>; covered: Set<number> }> {
  const nums = episodes.map((e) => e.e).filter((n) => typeof n === 'number' && n > 0).sort((a, b) => a - b)
  if (nums.length === 0) return { chosen: [], covered: new Set() }
  const start = nums[0]
  const end = nums[nums.length - 1]

  const seen = new Set<string>()
  const raw: TorznabResult[] = []
  for (const q of [`${title} ${start}-${end}`, `${title} ${start}`]) {
    for (const r of await searchAllIndexers({ q, cats: '5000' })) {
      const k = r.infoHash || r.title
      if (!seen.has(k)) { seen.add(k); raw.push(r) }
    }
  }
  if (raw.length === 0) return { chosen: [], covered: new Set() }

  let conditions: QualityCondition[] = []
  try { const p = JSON.parse(profile.conditions); if (Array.isArray(p)) conditions = p } catch {}

  // Drop hard-gated releases (blocklist/sample/oversize/dead) before pack selection so a covering
  // pack is never auto-grabbed if it's a sample, oversized, or a previously-failed (blocklisted) hash.
  const { passing } = partitionByGates(raw, 'tv')

  const candidates = passing.map((r) => ({
    title: r.title,
    seeders: r.seeders,
    score: autoPickScore(r, conditions, profile.id, language),
    release: r,
  }))
  return selectCoveringPacks(nums, candidates)
}

// ---------------------------------------------------------------------------
// grabItem
// ---------------------------------------------------------------------------

/**
 * Full grab flow for a single monitored item.
 *
 * Returns:
 *   'grabbed'    — a release was found and sent to the download client
 *   'not_found'  — search returned no results that pass the quality profile
 *   'error'      — an unexpected error occurred (logged to stderr)
 *
 * options.language: ISO 639-1 code or 'any' (default). Passed through to
 * findBestRelease as a hard constraint for auto-pick paths.
 *
 * options.force: when true, skip the atomic 'wanted'→'grabbing' claim (D3) and grab
 * regardless of current status. Used by the admin "Grab Now" / re-search routes that
 * are explicit manual actions and must work on already-grabbed items. The default
 * (false) path is taken by the cron and the non-awaited approve/auto-approve grabs:
 * the first caller to flip the row to 'grabbing' wins, the rest see changes===0 and
 * bail, closing the double-grab race (the cron's getWantedItems only sees 'wanted').
 */
export async function grabItem(
  item: MonitoredItem,
  options: { language?: string; force?: boolean } = {},
): Promise<'grabbed' | 'not_found' | 'error'> {
  const { language = 'any', force = false } = options

  // D3: atomically claim the row before doing any work. If another grab (cron or the
  // fire-and-forget approve grab) already claimed it, changes===0 and we skip — never
  // grab the same wanted row twice. Manual force-grabs bypass the claim.
  let claimed = false
  if (!force) {
    const claim = getDb()
      .prepare("UPDATE monitored_items SET status = 'grabbing', updated_at = ? WHERE id = ? AND status = 'wanted'")
      .run(Date.now(), item.id)
    if (claim.changes === 0) return 'not_found'
    claimed = true
  }

  // D3: release the 'grabbing' claim back to 'wanted' on any non-grab outcome so the
  // cron retries it next tick. Only reverts a row we actually claimed and only if it's
  // still 'grabbing' (a concurrent transition must not be clobbered).
  const releaseClaim = (): void => {
    if (!claimed) return
    getDb()
      .prepare("UPDATE monitored_items SET status = 'wanted', updated_at = ? WHERE id = ? AND status = 'grabbing'")
      .run(Date.now(), item.id)
  }

  try {
    // 1. Resolve quality profile; fall back to an "Any" profile if missing so a deleted
    //    profile doesn't permanently block an item from being grabbed
    const profile: QualityProfile =
      getProfileById(item.quality_profile_id) ?? {
        id: 0,
        name: 'Any',
        conditions: '[]',
      }

    // 2. Build search params — guard against degenerate scopes before hitting indexers.
    //    If scope_type='episodes' with an empty episode list, or scope_type='seasons' with an
    //    empty season list, buildSearchParams silently falls back to a title-only query which
    //    would return unrelated results. Bail out immediately instead.
    const params = buildSearchParams(item)

    if (item.type === 'tv') {
      const scopeType = item.scope_type ?? 'full'

      if (scopeType === 'episodes') {
        let eps: Array<{ s: number; e: number }> = []
        try { if (item.scope_episodes) { const p = JSON.parse(item.scope_episodes); if (Array.isArray(p)) eps = p } } catch {}
        if (eps.length === 0) {
          process.stderr.write(
            `[grabber] "${sanitizeLog(item.title)}" has scope_type='episodes' but scope_episodes is empty or null — skipping indexer query\n`,
          )
          recordGrabResults(item.id, [], null, 'degenerate_scope')
          releaseClaim()
          return 'not_found'
        }
      }

      if (scopeType === 'seasons') {
        let seasons: number[] = []
        try { if (item.scope_seasons) { const p = JSON.parse(item.scope_seasons); if (Array.isArray(p)) seasons = p } } catch {}
        if (seasons.length === 0) {
          process.stderr.write(
            `[grabber] "${sanitizeLog(item.title)}" has scope_type='seasons' but scope_seasons is empty or null — skipping indexer query\n`,
          )
          recordGrabResults(item.id, [], null, 'degenerate_scope')
          releaseClaim()
          return 'not_found'
        }
      }
    }

    const rawResults = await searchAllIndexers(params)

    // 3a. No indexer hits at all — record and bail.
    if (rawResults.length === 0) {
      recordGrabResults(item.id, [], null, 'no_results')
      releaseClaim()
      return 'not_found'
    }

    // 3b. Pre-filter results to only those matching the requested scope.
    //     filterByScope returns null when no results match — treat as not_found rather than
    //     falling back to random content which is the original bug being fixed.
    const scopeFiltered = filterByScope(rawResults, item)
    if (scopeFiltered === null) {
      // Results found but none matched the scope pattern
      recordGrabResults(item.id, rawResults.map(r => ({ result: r, score: -1, selected: false })), null, 'scope_mismatch')
      releaseClaim()
      return 'not_found'
    }
    const results = scopeFiltered

    // 3c. Decision gate-chain (feature 1): split scope-matched results into those that PASS every
    //     hard gate (blocklist/sample/oversize/dead) and those that fail. Only passing releases are
    //     eligible for auto-pick; the gated ones are still recorded (with reasons) so the admin can
    //     see "why didn't this download" in the interactive picker.
    const blocked = loadBlocklist()
    const { passing, gatesByKey } = partitionByGates(results, item.type, blocked)

    // 4. Score ALL (scope-filtered) results for UI display using the SAME soft auto-pick rank
    //    the cron uses, so the displayed order matches the pick. Gated releases carry their reasons.
    let conditions: QualityCondition[] = []
    try { const p = JSON.parse(profile.conditions); if (Array.isArray(p)) conditions = p } catch {}
    const scored: ScoredCandidate[] = results.map(r => ({
      result: r,
      score: autoPickScore(r, conditions, profile.id, language),
      selected: false,
      gates: gatesByKey.get(gateKey(r)) ?? [],
    }))

    // 5. Pick the best release for AUTO-grab from the gate-passing pool only. result is null when
    //    nothing survived the gates — distinguish "all dead" (every gate failure was a seed floor)
    //    from "all gated" (sample/oversize/blocklist also involved) so the admin gets a clear reason.
    const result = findBestRelease(passing, profile, language)
    let skipReason: SkipReason | undefined
    if (!result) {
      if (passing.length === 0 && gatesByKey.size > 0) {
        const allReasons = [...gatesByKey.values()].flat()
        skipReason = allReasons.every(r => r === 'dead') ? 'no_seeders' : 'gated'
      } else {
        skipReason = 'no_seeders'
      }
    }

    // Mark the winning candidate and record all results before touching the download client
    if (result) {
      const idx = scored.findIndex(c => c.result.infoHash === result.infoHash && c.result.title === result.title)
      if (idx >= 0) scored[idx].selected = true
    }

    recordGrabResults(item.id, scored, result?.infoHash ?? null, skipReason)

    if (!result) { releaseClaim(); return 'not_found' }

    // 6. Prefer magnet link over .torrent URL — magnets don't require an extra HTTP fetch
    //    and work even when the indexer's download endpoint is behind auth
    await getClient().addTorrent({
      urls: result.magnetUrl || result.downloadUrl,
      category: item.type,
    })

    // 7. Record and transition status; order matters — recordGrab first so the history row
    //    exists if a crash happens between the two writes
    recordGrab({
      item_id: item.id,
      indexer: result.indexerName,
      release_title: result.title,
      info_hash: result.infoHash,
      urls: [result.magnetUrl, result.downloadUrl],
    })

    updateItem(item.id, { status: 'grabbed' })

    return 'grabbed'
  } catch (err) {
    // Errors are non-fatal to the cron loop — log and continue to next item
    process.stderr.write(`[grabber] Error grabbing "${sanitizeLog(item.title)}": ${err}\n`)
    releaseClaim()
    return 'error'
  }
}
