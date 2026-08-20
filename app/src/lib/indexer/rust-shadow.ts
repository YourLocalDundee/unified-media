/**
 * Phase 1.5 cutover seam for `um-indexer` (the Rust indexer service).
 *
 * The conversion plan cuts each phase over behind the existing API contract: the Rust service runs
 * beside the TypeScript one, both are asked the same real questions, their answers are diffed, and
 * only once the diff is boring does traffic flip. This module is that seam. `searchAllIndexers`
 * consults it; nothing else in the app knows the Rust service exists.
 *
 * Three modes, from `UM_INDEXER_MODE`:
 *
 *   off      (default) — the Rust service is never contacted. Identical to before this file.
 *   shadow             — TypeScript answers the caller. The Rust service is asked the same
 *                        question in the background and the two answers are diffed into the log.
 *                        Adds no latency to the caller: the diff happens after the response is
 *                        already on its way back.
 *   primary            — the Rust service answers the caller, falling back to TypeScript if it
 *                        errors or times out. The fallback is what makes the flip safe to try on a
 *                        weeknight rather than a weekend.
 *
 * `UM_INDEXER_URL` must be set for anything but `off`; without it the mode is forced back to `off`
 * rather than failing every search.
 */

import type { TorznabResult, TorznabSearchParams } from './types'

export type IndexerMode = 'off' | 'shadow' | 'primary'

const DEFAULT_TIMEOUT_MS = 45_000

/** Strip CR/LF so a release title cannot forge extra log lines (A21-07). */
const sanitizeLog = (s: string) => s.replace(/[\r\n]/g, ' ')

function serviceUrl(): string | null {
  const raw = process.env.UM_INDEXER_URL?.trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

/**
 * The configured mode, downgraded to 'off' when it cannot be honoured. An unrecognised value is
 * 'off' too: a typo must not silently route production traffic somewhere new.
 */
export function indexerMode(): IndexerMode {
  if (!serviceUrl()) return 'off'
  switch (process.env.UM_INDEXER_MODE?.trim()) {
    case 'shadow': return 'shadow'
    case 'primary': return 'primary'
    default: return 'off'
  }
}

function timeoutMs(): number {
  const raw = Number(process.env.UM_INDEXER_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

/**
 * Ask um-indexer the same question searchAllIndexers was asked.
 *
 * Deliberately requests no ranking: the default ordering is the one the TS produces, which is what
 * a shadow diff has to compare against. Quality ranking is a capability for the automation service
 * to opt into in Phase 2, not something to switch on underneath a diff.
 */
export async function searchViaRust(params: TorznabSearchParams): Promise<TorznabResult[]> {
  const base = serviceUrl()
  if (!base) throw new Error('UM_INDEXER_URL is not set')

  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value !== '') query.set(key, value)
  }

  const response = await fetch(`${base}/search?${query}`, {
    signal: AbortSignal.timeout(timeoutMs()),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`um-indexer returned ${response.status}`)
  }
  const body = (await response.json()) as { results?: TorznabResult[] }
  return Array.isArray(body.results) ? body.results : []
}

/** Identity of a result for diffing — the same key the gate chain uses. */
const resultKey = (r: TorznabResult) => r.infoHash || r.title

export interface SearchDiff {
  tsCount: number
  rustCount: number
  /** Keys only one side returned. */
  onlyTs: string[]
  onlyRust: string[]
  /** Whether the two agree on the single result an auto-grab would pick. */
  topMatch: boolean
  /** How many of the first ten positions hold the same release. */
  topTenAgreement: number
}

/**
 * Compare two answers to the same search.
 *
 * Membership and *order* both matter, and order matters more: automation grabs the first result it
 * is handed, so two runs that return the same set in a different order still grab different
 * torrents. Ordering is reported over the top ten rather than the whole list because nothing below
 * that ever gets grabbed.
 */
export function diffResults(ts: TorznabResult[], rust: TorznabResult[]): SearchDiff {
  const tsKeys = ts.map(resultKey)
  const rustKeys = rust.map(resultKey)
  const tsSet = new Set(tsKeys)
  const rustSet = new Set(rustKeys)

  const window = Math.min(10, tsKeys.length, rustKeys.length)
  let agreement = 0
  for (let i = 0; i < window; i++) {
    if (tsKeys[i] === rustKeys[i]) agreement++
  }

  return {
    tsCount: ts.length,
    rustCount: rust.length,
    onlyTs: tsKeys.filter(k => !rustSet.has(k)),
    onlyRust: rustKeys.filter(k => !tsSet.has(k)),
    topMatch: tsKeys.length > 0 && rustKeys.length > 0 && tsKeys[0] === rustKeys[0],
    topTenAgreement: agreement,
  }
}

/**
 * One structured line per shadowed search, on stderr with the app's other operational logging.
 *
 * JSON so a week of these can be aggregated without a parser: the cutover criterion is "the diff is
 * boring", and that has to be measurable rather than eyeballed. Only keys are logged, never whole
 * results — the point is which releases differ, and a full dump would be megabytes a day.
 */
export function logDiff(params: TorznabSearchParams, diff: SearchDiff, tsMs: number, rustMs: number): void {
  const identical =
    diff.onlyTs.length === 0 && diff.onlyRust.length === 0 && diff.tsCount === diff.rustCount
  process.stderr.write(
    `[indexer-shadow] ${JSON.stringify({
      q: sanitizeLog(params.q ?? ''),
      cats: params.cats ?? '',
      identical,
      ...diff,
      // Truncated: a pathological search must not write a megabyte of keys.
      onlyTs: diff.onlyTs.slice(0, 20),
      onlyRust: diff.onlyRust.slice(0, 20),
      tsMs: Math.round(tsMs),
      rustMs: Math.round(rustMs),
    })}\n`,
  )
}

/** Log a shadow or primary call that failed, without letting it affect the caller. */
export function logFailure(stage: 'shadow' | 'primary', params: TorznabSearchParams, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(
    `[indexer-shadow] ${JSON.stringify({
      stage,
      q: sanitizeLog(params.q ?? ''),
      error: sanitizeLog(message),
    })}\n`,
  )
}
