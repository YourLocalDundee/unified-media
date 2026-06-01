import { parseStringPromise } from 'xml2js'
import { getEnabledIndexers } from './config'
import type { Indexer, TorznabResult, TorznabSearchParams, IndexerHealth } from './types'

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
export async function parseXml(xml: string, indexerName: string): Promise<TorznabResult[]> {
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
          // Collect all category values into an array; other attrs take first value
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
  if (params.cats) url.searchParams.set('cat', params.cats)
  if (params.imdbid) url.searchParams.set('imdbid', params.imdbid)
  if (params.season) url.searchParams.set('season', params.season)
  if (params.ep) url.searchParams.set('ep', params.ep)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)

  try {
    const res = await fetch(url.toString(), { signal: controller.signal })
    if (!res.ok) {
      process.stderr.write(
        `[indexer] ${indexer.name} returned HTTP ${res.status}\n`,
      )
      return []
    }
    const xml = await res.text()
    return await parseXml(xml, indexer.name)
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    process.stderr.write(
      `[indexer] ${indexer.name} ${isTimeout ? 'timed out' : `error: ${err}`}\n`,
    )
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
  const indexers = getEnabledIndexers()
  if (indexers.length === 0) return []

  const limit = createLimit(3)

  const settled = await Promise.allSettled(
    indexers.map(indexer => limit(() => searchIndexer(indexer, params))),
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
// testIndexer
// ---------------------------------------------------------------------------

/**
 * Perform a caps check against an indexer and return its health status.
 * Never throws.
 */
export async function testIndexer(indexer: Indexer): Promise<IndexerHealth> {
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

    // Optionally count results — for a caps response the "result count" is
    // not meaningful, so we just confirm the indexer replied successfully.
    return { status: 'ok', responseTimeMs }
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
