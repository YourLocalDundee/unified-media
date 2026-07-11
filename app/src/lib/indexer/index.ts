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
 * Search a single Torznab indexer. Returns an empty array on any error or
 * timeout — never throws.
 */
export async function searchIndexer(
  indexer: Indexer,
  params: TorznabSearchParams,
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

  // 10-second timeout prevents a slow indexer from blocking the entire
  // fan-out. AbortController is the only cross-runtime cancellation mechanism.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) {
      process.stderr.write(
        `[indexer] ${indexer.name} returned HTTP ${res.status}\n`,
      )
      // A non-2xx response is a real failure (auth/ratelimit/down) — feed it to backoff. An empty
      // result set from a 200 below is NOT a failure (a healthy "no matches"), so it records success.
      recordIndexerResult(indexer.id, false)
      return []
    }
    const xml = await res.text()
    const results = await parseXml(xml, indexer.name)
    recordIndexerResult(indexer.id, true)
    return results
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    process.stderr.write(
      `[indexer] ${indexer.name} ${isTimeout ? 'timed out' : `error: ${err}`}\n`,
    )
    recordIndexerResult(indexer.id, false)
    return []
  } finally {
    clearTimeout(timer)
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
        switch (indexer.search_type) {
          case 'yts': {
            const r = params.q ? await searchYts(params.q) : []
            recordIndexerResult(indexer.id, true)
            return r
          }
          case 'eztv': {
            const r = params.imdbid ? await searchEztv(params.imdbid) : []
            recordIndexerResult(indexer.id, true)
            return r
          }
          case 'nyaa': {
            const r = params.q ? await searchNyaa(params.q) : []
            recordIndexerResult(indexer.id, true)
            return r
          }
          default:
            // 'torznab' or any unrecognized type — Torznab path (records its own health, never throws)
            return await searchIndexer(indexer, params)
        }
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
  // Only Torznab exposes a caps endpoint. The built-in yts/eztv/nyaa adapters are
  // fixed-purpose trackers with no torznab_url — nothing to probe over HTTP.
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
