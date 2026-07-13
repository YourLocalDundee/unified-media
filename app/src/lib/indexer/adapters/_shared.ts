// Shared fetch helpers for native indexer adapters. Not itself an adapter — the leading
// underscore keeps it out of any future "list files in adapters/" == "list of adapters" assumption.
import * as cheerio from 'cheerio'
import { flareSolve } from '../flaresolverr'

/**
 * fetch() with a hard AbortController timeout. Every adapter should use this instead of bare
 * fetch() — Promise.allSettled in searchAllIndexers() waits on the slowest adapter in a batch, so
 * one hung request otherwise stalls the whole search.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * fetchWithTimeout + cheerio.load() for Tier B HTML-scrape adapters. Each adapter does its own
 * row-selector mapping to TorznabResult afterward — selectors are inherently per-site, so there's
 * no shared row-parsing logic here beyond the fetch+parse boilerplate.
 */
export async function fetchHtml(url: string, timeoutMs = 10_000): Promise<ReturnType<typeof cheerio.load>> {
  const res = await fetchWithTimeout(url, {}, timeoutMs)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return cheerio.load(await res.text())
}

/**
 * flareSolve() + cheerio.load() for Tier C (Cloudflare-gated) adapters — the first real caller of
 * flareSolve(), which was dead code until this session. Defaults to a 35s solve timeout (still
 * under flareSolve()'s own 60s default) so a site that can't be solved at all — confirmed live for
 * several Turnstile-protected trackers — fails fast into backoff instead of stalling a whole
 * search cycle. 35s (not tighter) because ordinary solve-time variance on a working site is real:
 * uindex measured anywhere from ~15s to ~34s live-testing this session. The registry's outer
 * per-search-type timeout for these must exceed this so the inner timeout is what actually fires
 * (see CLOUDFLARE_GATED_TYPES in index.ts).
 */
export async function fetchSolvedHtml(url: string, timeoutMs = 35_000): Promise<ReturnType<typeof cheerio.load>> {
  const solved = await flareSolve(url, timeoutMs)
  return cheerio.load(solved.html)
}
