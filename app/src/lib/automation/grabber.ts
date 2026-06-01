import { getClient } from '@/lib/download-client/registry'
import { searchAllIndexers } from '@/lib/indexer/index'
import { parseReleaseName, scoreRelease } from './parser'
import { getProfileById, recordGrab, updateItem } from './monitor'
import type { MonitoredItem, QualityProfile, QualityCondition } from './types'
import type { TorznabResult } from '@/lib/indexer/types'

// ---------------------------------------------------------------------------
// buildSearchParams
// ---------------------------------------------------------------------------

/**
 * Build Torznab search params from a monitored item.
 */
export function buildSearchParams(item: MonitoredItem): { q: string; cats: string } {
  const cats = item.type === 'movie' ? '2000' : '5000'
  return { q: item.title, cats }
}

// ---------------------------------------------------------------------------
// findBestRelease
// ---------------------------------------------------------------------------

/**
 * Given a list of Torznab results and a quality profile, return the result
 * that passes all required conditions and has the highest score, or null if
 * none qualify.
 */
export function findBestRelease(
  results: TorznabResult[],
  profile: QualityProfile,
): TorznabResult | null {
  const conditions = JSON.parse(profile.conditions) as QualityCondition[]

  let bestResult: TorznabResult | null = null
  let bestScore = -Infinity

  for (const result of results) {
    const meta = parseReleaseName(result.title)
    const score = scoreRelease(meta, conditions)
    if (score === null) continue // failed a required condition
    if (score > bestScore) {
      bestScore = score
      bestResult = result
    }
  }

  return bestResult
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
 */
export async function grabItem(
  item: MonitoredItem,
): Promise<'grabbed' | 'not_found' | 'error'> {
  try {
    // 1. Resolve quality profile; fall back to an "Any" profile if missing
    const profile: QualityProfile =
      getProfileById(item.quality_profile_id) ?? {
        id: 0,
        name: 'Any',
        conditions: '[]',
      }

    // 2. Search all enabled indexers
    const params = buildSearchParams(item)
    const results = await searchAllIndexers(params)

    // 3. Pick the best result according to the quality profile
    const result = findBestRelease(results, profile)
    if (!result) return 'not_found'

    // 4. Send to download client
    await getClient().addTorrent({
      urls: result.magnetUrl || result.downloadUrl,
      category: item.type,
    })

    // 5. Record the grab and mark item as grabbed
    recordGrab({
      item_id: item.id,
      indexer: result.indexerName,
      release_title: result.title,
      info_hash: result.infoHash,
    })

    updateItem(item.id, { status: 'grabbed' })

    return 'grabbed'
  } catch (err) {
    process.stderr.write(`[grabber] Error grabbing "${item.title}": ${err}\n`)
    return 'error'
  }
}
