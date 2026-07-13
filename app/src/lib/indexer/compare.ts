// Head-to-head comparison of two indexers (typically a native adapter and its `Prowlarr: <name>`
// bridge twin) run independently, with no merge/dedup — the evidence the independence build's
// cutover step needs before disabling any Prowlarr bridge row.
import { adapterRegistry, fetchTorznabResults, timeoutForSearchType, withTimeout } from './index'
import type { Indexer, TorznabResult, TorznabSearchParams } from './types'

export interface CompareSideResult {
  indexerId: number
  indexerName: string
  searchType: string
  status: 'ok' | 'error'
  responseTimeMs: number
  errorMessage?: string
  resultCount: number
  sample: Array<{ title: string; seeders: number; leechers: number; size: number; hasHash: boolean }>
}

export interface CompareResult {
  a: CompareSideResult
  b: CompareSideResult
  // null when either side returned zero results with a non-empty infoHash — hash overlap isn't a
  // meaningful signal for downloadUrl-only trackers (e.g. BT.etree, Shana Project).
  hashOverlapCount: number | null
}

type RawProbe =
  | { ok: true; results: TorznabResult[]; responseTimeMs: number }
  | { ok: false; errorMessage: string; responseTimeMs: number }

/**
 * Run a search against a single indexer without recording health/backoff or consuming rate-limit
 * tokens — mirrors testIndexer's dispatch (adapterRegistry lookup, else Torznab) so a comparison
 * can't corrupt the very signals it's trying to read, and is safe to run repeatedly.
 */
async function fetchRaw(indexer: Indexer, params: TorznabSearchParams): Promise<RawProbe> {
  const start = Date.now()
  const adapter = adapterRegistry[indexer.search_type]
  try {
    const results = adapter
      ? await withTimeout(adapter(indexer, params), timeoutForSearchType(indexer.search_type), indexer.name)
      : await fetchTorznabResults(indexer, params, timeoutForSearchType(indexer.search_type))
    return { ok: true, results, responseTimeMs: Date.now() - start }
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : String(err), responseTimeMs: Date.now() - start }
  }
}

function toSample(results: TorznabResult[]): CompareSideResult['sample'] {
  return [...results]
    .sort((a, b) => b.seeders - a.seeders)
    .slice(0, 5)
    .map(r => ({ title: r.title, seeders: r.seeders, leechers: r.leechers, size: r.size, hasHash: Boolean(r.infoHash) }))
}

function toSideResult(indexer: Indexer, probe: RawProbe): CompareSideResult {
  const base = {
    indexerId: indexer.id,
    indexerName: indexer.name,
    searchType: indexer.search_type,
    responseTimeMs: probe.responseTimeMs,
  }
  if (!probe.ok) {
    return { ...base, status: 'error', errorMessage: probe.errorMessage, resultCount: 0, sample: [] }
  }
  return { ...base, status: 'ok', resultCount: probe.results.length, sample: toSample(probe.results) }
}

export async function compareIndexers(
  indexerA: Indexer,
  indexerB: Indexer,
  params: TorznabSearchParams,
): Promise<CompareResult> {
  const [probeA, probeB] = await Promise.all([
    fetchRaw(indexerA, params),
    fetchRaw(indexerB, params),
  ])

  const hashesA = probeA.ok ? new Set(probeA.results.filter(r => r.infoHash).map(r => r.infoHash)) : new Set<string>()
  const hashesB = probeB.ok ? probeB.results.filter(r => r.infoHash).map(r => r.infoHash) : []
  const hashOverlapCount = hashesA.size > 0 && hashesB.length > 0
    ? hashesB.filter(h => hashesA.has(h)).length
    : null

  return {
    a: toSideResult(indexerA, probeA),
    b: toSideResult(indexerB, probeB),
    hashOverlapCount,
  }
}
