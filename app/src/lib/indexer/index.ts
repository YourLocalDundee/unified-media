// Core indexer logic for the native indexer system (Independence Build Phase 1).
// Provides Torznab XML parsing, per-indexer search with timeout, fan-out search
// across all enabled indexers with deduplication, and a health check capability.
// All network I/O here is direct from the Next.js server to the indexer URLs —
// not proxied through Prowlarr.
import { parseStringPromise } from 'xml2js'
import { getSearchableIndexers, recordIndexerResult, tryConsumeIndexerToken, checkQueryLimit, incrementDailyQueryCount } from './config'
import { resolveCategoriesForIndexer } from './categories'
import type { Indexer, TorznabResult, TorznabSearchParams, IndexerHealth, IndexerCategory } from './types'
import { searchYts } from './adapters/yts'
import { searchEztv } from './adapters/eztv'
import { searchNyaa } from './adapters/nyaa'
import { searchThePirateBay } from './adapters/thepiratebay'
import { searchBangumiMoe } from './adapters/bangumimoe'
import { searchInternetArchive } from './adapters/internetarchive'
import { searchSubsPlease } from './adapters/subsplease'
import { searchTorrentsCsv } from './adapters/torrentscsv'
import { searchLimeTorrents } from './adapters/limetorrents'
import { searchBtEtree } from './adapters/btetree'
import { searchShanaProject } from './adapters/shanaproject'
import { searchTorrentDownload } from './adapters/torrentdownload'
import { searchMikan } from './adapters/mikan'
import { searchDmhy } from './adapters/dmhy'
import { searchUindex } from './adapters/uindex'

// ---------------------------------------------------------------------------
// Native adapter registry
// ---------------------------------------------------------------------------
// Every non-Torznab search_type resolves here instead of a hardcoded switch case. 'torznab'
// deliberately has no entry — it stays on the searchIndexer() path below, which already
// self-records health and never throws; folding it into this registry's try/catch would
// double-record. Add one entry per new native adapter (see docs on the independence build).
export type AdapterFn = (indexer: Indexer, params: TorznabSearchParams) => Promise<TorznabResult[]>

// Exported read-only so compare.ts's probeIndexer can dispatch the same way testIndexer does,
// without duplicating the registry.
export const adapterRegistry: Record<string, AdapterFn> = {
  yts: (_indexer, params) => (params.q ? searchYts(params.q) : Promise.resolve([])),
  eztv: (_indexer, params) => (params.imdbid ? searchEztv(params.imdbid) : Promise.resolve([])),
  nyaa: (_indexer, params) => (params.q ? searchNyaa(params.q, 'https://nyaa.si/?page=rss', 'Nyaa') : Promise.resolve([])),
  sukebei: (_indexer, params) => (params.q ? searchNyaa(params.q, 'https://sukebei.nyaa.si/?page=rss', 'sukebei.nyaa.si') : Promise.resolve([])),
  thepiratebay: (_indexer, params) => (params.q ? searchThePirateBay(params.q) : Promise.resolve([])),
  bangumimoe: (_indexer, params) => (params.q ? searchBangumiMoe(params.q) : Promise.resolve([])),
  internetarchive: (_indexer, params) => (params.q ? searchInternetArchive(params.q) : Promise.resolve([])),
  subsplease: (_indexer, params) => (params.q ? searchSubsPlease(params.q) : Promise.resolve([])),
  torrentscsv: (_indexer, params) => (params.q ? searchTorrentsCsv(params.q) : Promise.resolve([])),
  limetorrents: (_indexer, params) => (params.q ? searchLimeTorrents(params.q) : Promise.resolve([])),
  btetree: (_indexer, params) => (params.q ? searchBtEtree(params.q) : Promise.resolve([])),
  shanaproject: (_indexer, params) => (params.q ? searchShanaProject(params.q) : Promise.resolve([])),
  torrentdownload: (_indexer, params) => (params.q ? searchTorrentDownload(params.q) : Promise.resolve([])),
  mikan: (_indexer, params) => (params.q ? searchMikan(params.q) : Promise.resolve([])),
  dmhy: (_indexer, params) => (params.q ? searchDmhy(params.q) : Promise.resolve([])),
  uindex: (_indexer, params) => (params.q ? searchUindex(params.q) : Promise.resolve([])),
}

// Tier A/B (plain fetch or HTML scrape) get a moderate cap; Tier C (FlareSolverr-backed) needs to
// outlast its own internal solve timeout (~35s, see adapters/_shared.ts fetchSolvedHtml) so that
// inner timeout is what actually fires, not a race against this outer one. The 5s margin between
// the two isn't padding for its own sake — uindex measured a real 27.7s solve on one run and
// 34s+ on another live-testing this session, so a tight outer cap turns ordinary FlareSolverr
// variance into spurious failures.
// Only dmhy and uindex are here — of the 8 Cloudflare-gated candidates checked live against
// FlareSolverr on 2026-07-12, those were the only 2 that actually solved. The rest (1337x,
// extratorrent.st: Turnstile timeout; kickasstorrents.to/.ws: connection timeout; torrentkitty:
// connection refused; magnetcat: explicit "IP banned" from Cloudflare) have no adapter — building
// one would just wrap a request that can never succeed.
const CLOUDFLARE_GATED_TYPES = new Set(['dmhy', 'uindex'])

export function timeoutForSearchType(searchType: string): number {
  return CLOUDFLARE_GATED_TYPES.has(searchType) ? 40_000 : 10_000
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
    promise
      .then(v => { clearTimeout(timer); resolve(v) })
      .catch(err => { clearTimeout(timer); reject(err) })
  })
}

// ---------------------------------------------------------------------------
// Simple concurrency limiter (semaphore) — p-limit v6+ is ESM-only and this
// project does not set "type":"module", so we implement the same primitive
// manually rather than risk a module-system mismatch at runtime.
// ---------------------------------------------------------------------------
function createLimit(concurrency: number) {
  let running = 0
  const queue: Array<() => void> = []

  function next() {
    if (running >= concurrency || queue.length === 0) return
    running++
    const run = queue.shift()!
    run()
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            running--
            next()
          })
      })
      next()
    })
  }
}

// ---------------------------------------------------------------------------
// parseXml
// ---------------------------------------------------------------------------

/**
 * Parse a Torznab RSS XML response into an array of TorznabResult objects.
 * @param xml        Raw XML string from the indexer
 * @param indexerName Human-readable name to stamp on every result
 */
// 5 MB is generous for any real Torznab response; reject larger payloads to
// bound memory and CPU cost of xml2js parsing on malformed/adversarial XML (A21-05).
const MAX_XML_BYTES = 5 * 1024 * 1024

export async function parseXml(xml: string, indexerName: string): Promise<TorznabResult[]> {
  if (xml.length > MAX_XML_BYTES) {
    process.stderr.write(
      `[indexer] XML response too large from ${indexerName} (${xml.length} bytes) — skipping\n`,
    )
    return []
  }
  let parsed: Record<string, unknown>
  try {
    parsed = await parseStringPromise(xml, { explicitArray: true })
  } catch (err) {
    process.stderr.write(`[indexer] XML parse error (${indexerName}): ${err}\n`)
    return []
  }

  const rss = parsed as {
    rss?: { channel?: Array<{ item?: unknown[] }> }
  }

  const items = rss?.rss?.channel?.[0]?.item
  if (!Array.isArray(items) || items.length === 0) return []

  const results: TorznabResult[] = []

  for (const raw of items) {
    const item = raw as Record<string, unknown>

    // Collect all torznab:attr elements into a map for quick lookup
    const attrs = item['torznab:attr']
    const attrMap = new Map<string, string>()
    const categoryValues: string[] = []

    if (Array.isArray(attrs)) {
      for (const a of attrs) {
        const obj = a as { $?: { name?: string; value?: string } }
        const name = obj.$?.name
        const value = obj.$?.value
        if (name && value !== undefined) {
          // An item can appear in multiple categories (e.g. 2000 and 2030);
          // collect all of them. For all other attrs keep only the first value.
          if (name === 'category') {
            categoryValues.push(value)
          } else if (!attrMap.has(name)) {
            attrMap.set(name, value)
          }
        }
      }
    }

    const title = String((item.title as string[] | undefined)?.[0] ?? '')

    // xml2js emits guid as { _: "text", $: { isPermaLink: "false" } } when the
    // element has attributes, or as a plain string when it has none.
    const guidRaw = (item.guid as Array<{ _?: string } | string> | undefined)?.[0]
    const guid = typeof guidRaw === 'object' && guidRaw !== null
      ? (guidRaw as { _?: string })._ ?? ''
      : String(guidRaw ?? '')

    const pubDate = String((item.pubDate as string[] | undefined)?.[0] ?? '')
    const downloadUrl = String((item.link as string[] | undefined)?.[0] ?? '')
    const sizeRaw = (item.size as string[] | undefined)?.[0]
    const size = sizeRaw ? parseInt(sizeRaw, 10) : 0

    const magnetUrl = attrMap.get('magneturl') ?? ''
    const seeders = parseInt(attrMap.get('seeders') ?? '0', 10) || 0
    const leechers = parseInt(attrMap.get('leechers') ?? '0', 10) || 0
    const imdbId = attrMap.get('imdbid')

    // Resolve infoHash: explicit attr → extract from magnet → extract from guid
    let infoHash = attrMap.get('infohash') ?? ''
    if (!infoHash && magnetUrl) {
      const match = magnetUrl.match(/urn:btih:([0-9a-fA-F]{40}|[2-7A-Z]{32})/i)
      if (match) infoHash = match[1].toLowerCase()
    }
    if (!infoHash) {
      // Some indexers put the hash in the guid URL
      const match = guid.match(/([0-9a-fA-F]{40})/i)
      if (match) infoHash = match[1].toLowerCase()
    }

    const result: TorznabResult = {
      title,
      infoHash,
      magnetUrl,
      downloadUrl,
      size: isNaN(size) ? 0 : size,
      seeders,
      leechers,
      indexerName,
      publishDate: pubDate,
      categories: categoryValues,
      ...(imdbId ? { imdbId } : {}),
    }

    results.push(result)
  }

  return results
}

// ---------------------------------------------------------------------------
// searchIndexer
// ---------------------------------------------------------------------------

/**
 * Build the request URL and perform a single timed Torznab `t=search` fetch + XML parse. Throws
 * on a non-2xx response, a network error, or a timeout — never records health/backoff itself, so
 * it's safe to call directly for a side-effect-free probe (see compare.ts). `searchIndexer` below
 * is the health-recording wrapper used by the live search fan-out.
 */
export async function fetchTorznabResults(
  indexer: Indexer,
  params: TorznabSearchParams,
  timeoutMs = 10_000,
): Promise<TorznabResult[]> {
  const url = new URL(indexer.torznab_url)

  url.searchParams.set('t', 'search')
  if (indexer.api_key) url.searchParams.set('apikey', indexer.api_key)
  if (params.q) url.searchParams.set('q', params.q)
  // Additive-only: never sends fewer categories than requested (see categories.ts).
  if (params.cats) url.searchParams.set('cat', resolveCategoriesForIndexer(indexer.caps_categories, params.cats))
  if (params.imdbid) url.searchParams.set('imdbid', params.imdbid)
  if (params.season) url.searchParams.set('season', params.season)
  if (params.ep) url.searchParams.set('ep', params.ep)

  // AbortController is the only cross-runtime cancellation mechanism; prevents a slow indexer
  // from blocking the entire fan-out.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }
    const xml = await res.text()
    return await parseXml(xml, indexer.name)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Search a single Torznab indexer. Returns an empty array on any error or
 * timeout — never throws.
 */
export async function searchIndexer(
  indexer: Indexer,
  params: TorznabSearchParams,
): Promise<TorznabResult[]> {
  try {
    const results = await fetchTorznabResults(indexer, params)
    recordIndexerResult(indexer.id, true)
    return results
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    process.stderr.write(
      `[indexer] ${indexer.name} ${isTimeout ? 'timed out' : `error: ${err}`}\n`,
    )
    // A non-2xx response, network error, or timeout is a real failure (auth/ratelimit/down) —
    // feed it to backoff. An empty result set from a 200 is NOT a failure (a healthy "no
    // matches"), so it records success (see the try branch above).
    recordIndexerResult(indexer.id, false)
    return []
  }
}

// ---------------------------------------------------------------------------
// searchAllIndexers
// ---------------------------------------------------------------------------

/**
 * Fan out a search query to all enabled indexers in parallel (concurrency 3),
 * deduplicate results by infoHash (keep higher seeder count), and return
 * results sorted descending by seeders.
 */
export async function searchAllIndexers(
  params: TorznabSearchParams,
): Promise<TorznabResult[]> {
  // getSearchableIndexers() excludes any indexer in active backoff so one flaky tracker can't keep
  // slowing every search (the torznab path feeds backoff via recordIndexerResult inside searchIndexer).
  const indexers = getSearchableIndexers()
  if (indexers.length === 0) return []

  const limit = createLimit(3)

  const settled = await Promise.allSettled(
    indexers.map(indexer => limit(async () => {
      // D1: per-indexer request-rate gate (rate_limit_per_min, 0 = unlimited). A throttled indexer is
      // skipped for this tick — that is NOT a failure, so it does not record a backoff hit.
      if (!tryConsumeIndexerToken(indexer.id, indexer.rate_limit_per_min)) return []
      // Daily query cap (rate_limit_queries_per_day, 0 = unlimited). Skipping is not a failure.
      if (!checkQueryLimit(indexer.id)) return []
      incrementDailyQueryCount(indexer.id)
      // The adapters now throw on a hard failure (D2), so they feed backoff just like the torznab path:
      // a thrown error here records a failure; a completed call (even with 0 results) records success.
      // searchIndexer records its own health and never throws, so it bypasses this try/catch's recording.
      try {
        const adapter = adapterRegistry[indexer.search_type]
        if (adapter) {
          const r = await withTimeout(adapter(indexer, params), timeoutForSearchType(indexer.search_type), indexer.name)
          recordIndexerResult(indexer.id, true)
          return r
        }
        // 'torznab' or any unrecognized type — Torznab path (records its own health, never throws)
        return await searchIndexer(indexer, params)
      } catch {
        recordIndexerResult(indexer.id, false)
        return []
      }
    })),
  )

  // Merge all results
  const all: TorznabResult[] = []
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      all.push(...outcome.value)
    }
  }

  // Deduplicate by infoHash — keep the entry with the higher seeder count.
  // Results with an empty infoHash are not deduplicated (they are kept as-is).
  const byHash = new Map<string, TorznabResult>()
  const noHash: TorznabResult[] = []

  for (const result of all) {
    if (!result.infoHash) {
      noHash.push(result)
      continue
    }
    const existing = byHash.get(result.infoHash)
    if (!existing || result.seeders > existing.seeders) {
      byHash.set(result.infoHash, result)
    }
  }

  const merged = [...byHash.values(), ...noHash]

  // Sort descending by seeders
  merged.sort((a, b) => b.seeders - a.seeders)

  return merged
}

// ---------------------------------------------------------------------------
// parseCapsXml
// ---------------------------------------------------------------------------

/**
 * Parse a Torznab `t=caps` XML response into the categories (and subcats) it
 * advertises. Returns [] on any parse error or missing <categories> block —
 * never throws. Closes the "no category management UI" MVP gap (Phase 1):
 * the admin UI can show what each indexer actually supports.
 */
export async function parseCapsXml(xml: string): Promise<IndexerCategory[]> {
  if (xml.length > MAX_XML_BYTES) return []
  let parsed: Record<string, unknown>
  try {
    parsed = await parseStringPromise(xml, { explicitArray: true })
  } catch {
    return []
  }

  const caps = parsed as { caps?: { categories?: Array<{ category?: unknown[] }> } }
  const rawCategories = caps?.caps?.categories?.[0]?.category
  if (!Array.isArray(rawCategories)) return []

  const categories: IndexerCategory[] = []
  for (const raw of rawCategories) {
    const cat = raw as {
      $?: { id?: string; name?: string }
      subcat?: Array<{ $?: { id?: string; name?: string } }>
    }
    const id = cat.$?.id
    const name = cat.$?.name
    if (!id || !name) continue

    const subcats = Array.isArray(cat.subcat)
      ? cat.subcat
          .map(s => ({ id: s.$?.id ?? '', name: s.$?.name ?? '' }))
          .filter(s => s.id && s.name)
      : []

    categories.push({ id, name, ...(subcats.length > 0 ? { subcats } : {}) })
  }
  return categories
}

// ---------------------------------------------------------------------------
// testIndexer
// ---------------------------------------------------------------------------

/**
 * Perform a caps check against an indexer and return its health status (plus
 * the categories it advertises, for torznab indexers). Never throws.
 */
export async function testIndexer(indexer: Indexer): Promise<IndexerHealth> {
  // Native adapters have no caps endpoint — actually run a probe search instead so the admin
  // "live test" button is a real check, not an automatic green light. 'the' is a near-universal
  // title-search hit; the stub imdbid covers eztv-shaped adapters that ignore q.
  const adapter = adapterRegistry[indexer.search_type]
  if (adapter) {
    const start = Date.now()
    try {
      const results = await withTimeout(
        adapter(indexer, { q: 'the', imdbid: 'tt0111161' }),
        timeoutForSearchType(indexer.search_type),
        indexer.name,
      )
      return { status: 'ok', responseTimeMs: Date.now() - start, resultCount: results.length }
    } catch (err) {
      return { status: 'error', responseTimeMs: Date.now() - start, errorMessage: err instanceof Error ? err.message : String(err) }
    }
  }

  // Only Torznab exposes a caps endpoint. Any other unrecognized search_type has nothing to probe.
  if (indexer.search_type !== 'torznab') {
    return { status: 'ok', responseTimeMs: 0 }
  }

  const url = new URL(indexer.torznab_url)
  url.searchParams.set('t', 'caps')
  if (indexer.api_key) url.searchParams.set('apikey', indexer.api_key)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5_000)
  const start = Date.now()

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    const responseTimeMs = Date.now() - start
    clearTimeout(timer)

    if (!res.ok) {
      return {
        status: 'error',
        responseTimeMs,
        errorMessage: `HTTP ${res.status} ${res.statusText}`,
      }
    }

    const xml = await res.text()
    const categories = await parseCapsXml(xml)
    return { status: 'ok', responseTimeMs, categories }
  } catch (err) {
    clearTimeout(timer)
    const responseTimeMs = Date.now() - start
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return {
      status: 'error',
      responseTimeMs,
      errorMessage: isTimeout ? 'Request timed out after 5 s' : String(err),
    }
  }
}
