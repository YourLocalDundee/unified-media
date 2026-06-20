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
import { parseReleaseName, parseLanguage, scoreRelease } from './parser'
import { scoreWithProfile } from './quality'
import { getProfileById, recordGrab, updateItem } from './monitor'
import { recordGrabResults, type ScoredCandidate } from './grab-results'
import type { MonitoredItem, QualityProfile, QualityCondition } from './types'
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

  if (scopeType === 'full' || scopeType === 'movie') return results

  if (scopeType === 'episodes' && item.scope_episodes) {
    let eps: Array<{ s: number; e: number }> = []
    try { const p = JSON.parse(item.scope_episodes); if (Array.isArray(p)) eps = p } catch { return null }
    if (eps.length === 0) return null
    // Build a combined OR pattern for all requested episodes, e.g. S01E05|S01E06
    const patterns = eps.map(ep => {
      const s = String(ep.s).padStart(2, '0')
      const e = String(ep.e).padStart(2, '0')
      // Accept SxxExx or x×xx (e.g. 1x05) notations
      return `S${s}E${e}|${ep.s}x${String(ep.e).padStart(2, '0')}`
    })
    const re = new RegExp(patterns.join('|'), 'i')
    const filtered = results.filter(r => re.test(r.title))
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

    const matching = results.filter(r => seasonRe.test(r.title))
    if (matching.length === 0) return null

    // Prefer season packs (no S##E## pattern); fall back to individual episodes only if no packs found
    const packs = matching.filter(r => !episodeRe.test(r.title))
    return packs.length > 0 ? packs : matching
  }

  return results
}

// ---------------------------------------------------------------------------
// findBestRelease
// ---------------------------------------------------------------------------

/**
 * Given a list of Torznab results and a quality profile, return the result
 * that passes all required conditions and has the highest score, or null if
 * none qualify.
 *
 * scoreRelease returns null (not 0) for hard rejections so a zero-score release
 * that passes all conditions still beats a result that fails a required condition.
 *
 * language: ISO 639-1 code or 'any'. When not 'any', releases with a detected
 * language that doesn't match are hard-rejected. Untagged releases (parseLanguage
 * returns null) are also rejected unless language is 'any' — callers that want
 * to accept unlabeled releases should pass 'any'.
 */
export function findBestRelease(
  results: TorznabResult[],
  profile: QualityProfile,
  language = 'any',
): TorznabResult | null {
  let conditions: QualityCondition[] = []
  try { const p = JSON.parse(profile.conditions); if (Array.isArray(p)) conditions = p } catch { return null }

  let bestResult: TorznabResult | null = null
  let bestScore = -Infinity

  for (const result of results) {
    const meta = parseReleaseName(result.title)

    // Language hard constraint — applied before quality scoring
    if (language !== 'any') {
      const detected = parseLanguage(result.title)
      if (detected !== language) continue // null (unknown) also rejected when language is set
    }

    const base = scoreRelease(meta, conditions)
    if (base === null) continue // hard reject from a required condition
    // Add custom format score on top of the base quality/source score
    const fmt = scoreWithProfile(result.title, profile.id)
    const combined = base + fmt.totalScore
    if (combined > bestScore) {
      bestScore = combined
      bestResult = result
    }
  }

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
  return findBestRelease(packs, profile, language)
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
          releaseClaim()
          return 'not_found'
        }
      }
    }

    const rawResults = await searchAllIndexers(params)

    // 3. Pre-filter results to only those matching the requested scope.
    //    filterByScope returns null when no results match — treat as not_found rather than
    //    falling back to random content which is the original bug being fixed.
    const scopeFiltered = filterByScope(rawResults, item)
    if (scopeFiltered === null) {
      // No results matched the scope pattern — record and bail without grabbing anything
      recordGrabResults(item.id, rawResults.map(r => ({ result: r, score: -1, selected: false })), null)
      releaseClaim()
      return 'not_found'
    }
    const results = scopeFiltered

    // 4. Score ALL (scope-filtered) results for UI display (combined base + custom format score)
    let conditions: QualityCondition[] = []
    try { const p = JSON.parse(profile.conditions); if (Array.isArray(p)) conditions = p } catch {}
    const scored: ScoredCandidate[] = results.map(r => {
      const meta = parseReleaseName(r.title)
      const base = scoreRelease(meta, conditions)
      const fmt  = scoreWithProfile(r.title, profile.id)
      const combined = base === null ? -1 : base + fmt.totalScore
      return { result: r, score: combined, selected: false }
    })

    // 5. Pick the best result according to the quality profile (language is a hard constraint)
    const result = findBestRelease(results, profile, language)

    // Mark the winning candidate and record all results before touching the download client
    if (result) {
      const idx = scored.findIndex(c => c.result.infoHash === result.infoHash && c.result.title === result.title)
      if (idx >= 0) scored[idx].selected = true
    }

    recordGrabResults(item.id, scored, result?.infoHash ?? null)

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
