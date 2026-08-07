/**
 * Import lists (mining Tier-3 #10) — auto-add movies/shows from an external source.
 *
 * Two source types:
 *   - 'trakt': a Trakt list items endpoint (e.g. https://api.trakt.tv/users/<u>/lists/<l>/items or
 *     .../watchlist). Items carry tmdb ids directly (movie.ids.tmdb / show.ids.tmdb). Needs a Trakt
 *     client id in app_settings (`trakt_client_id`) sent as the `trakt-api-key` header.
 *   - 'rss': a generic RSS/Atom feed; each <item><title> is parsed to title+year and resolved to a
 *     tmdb id via TMDB search using the list's configured media_type.
 *
 * AUTO-DELETE SAFETY (CLAUDE.md §15): every add is a LONG-TERM monitored item (createItem →
 * status='wanted', the normal grab path). It is never a 'quick' request, so the 48h auto-delete timer
 * never applies — an import-list title is not silently reclaimed. A per-list ledger (import_list_items,
 * UNIQUE(list_id,tmdb_id,media_type)) means an item is added at most once per list, so removing it from
 * the library later does not cause the next sync to re-add it.
 *
 * Sync runs every 6h from scheduler.ts and can be triggered per-list from the admin API.
 */

import { getDb } from '@/lib/db/index'
import { getSetting } from '@/lib/settings'
import { createItem } from './monitor'
import { getMovie, getTV, searchMovie, searchTV } from '@/lib/media-server/tmdb'

const FETCH_TIMEOUT_MS = 15_000
// Cap items processed per list per sync so a huge list can't stall the cron or hammer TMDB in one tick.
const MAX_ITEMS_PER_SYNC = 100

export type ImportListType = 'trakt' | 'rss'

export interface ImportList {
  id: number
  name: string
  list_type: ImportListType
  url: string
  enabled: number
  quality_profile_id: number
  media_type: 'movie' | 'tv'
  last_sync_at: number | null
  last_error: string | null
  added_count: number
  created_at: number
}

interface Candidate {
  tmdbId: number
  mediaType: 'movie' | 'tv'
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function getAllImportLists(): ImportList[] {
  return getDb().prepare('SELECT * FROM import_lists ORDER BY name').all() as ImportList[]
}

export function getImportListById(id: number): ImportList | undefined {
  return getDb().prepare('SELECT * FROM import_lists WHERE id = ?').get(id) as ImportList | undefined
}

export function createImportList(data: {
  name: string
  list_type: ImportListType
  url: string
  quality_profile_id?: number
  media_type?: 'movie' | 'tv'
}): ImportList {
  const db = getDb()
  const r = db
    .prepare(
      `INSERT INTO import_lists (name, list_type, url, enabled, quality_profile_id, media_type, added_count, created_at)
       VALUES (?, ?, ?, 1, ?, ?, 0, ?)`,
    )
    .run(data.name, data.list_type, data.url, data.quality_profile_id ?? 1, data.media_type ?? 'movie', Date.now())
  return getImportListById(r.lastInsertRowid as number)!
}

export function updateImportList(
  id: number,
  data: Partial<{ name: string; url: string; enabled: number; quality_profile_id: number; media_type: 'movie' | 'tv' }>,
): ImportList | undefined {
  const allowed = ['name', 'url', 'enabled', 'quality_profile_id', 'media_type'] as const
  const keys = (Object.keys(data) as (keyof typeof data)[]).filter((k) =>
    allowed.includes(k as (typeof allowed)[number]),
  )
  if (keys.length === 0) return getImportListById(id)
  const setClause = keys.map((k) => `${k} = ?`).join(', ')
  getDb().prepare(`UPDATE import_lists SET ${setClause} WHERE id = ?`).run(...keys.map((k) => data[k]), id)
  return getImportListById(id)
}

export function deleteImportList(id: number): boolean {
  const db = getDb()
  db.prepare('DELETE FROM import_list_items WHERE list_id = ?').run(id)
  return db.prepare('DELETE FROM import_lists WHERE id = ?').run(id).changes > 0
}

// ── Source fetchers ─────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ac.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

interface TraktItem {
  type?: string
  movie?: { ids?: { tmdb?: number } }
  show?: { ids?: { tmdb?: number } }
}

async function fetchTraktList(url: string): Promise<Candidate[]> {
  const clientId = getSetting('trakt_client_id', '').trim()
  if (!clientId) throw new Error('Trakt client id not configured (set trakt_client_id in settings)')

  const res = await fetchWithTimeout(url, {
    headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': clientId },
  })
  if (!res.ok) throw new Error(`Trakt HTTP ${res.status}`)
  const data = (await res.json()) as TraktItem[]
  if (!Array.isArray(data)) throw new Error('Trakt response was not a list')

  const candidates: Candidate[] = []
  for (const item of data) {
    const movieTmdb = item.movie?.ids?.tmdb
    const showTmdb = item.show?.ids?.tmdb
    if (movieTmdb) candidates.push({ tmdbId: movieTmdb, mediaType: 'movie' })
    else if (showTmdb) candidates.push({ tmdbId: showTmdb, mediaType: 'tv' })
  }
  return candidates
}

// Extract title + optional year from a clean RSS feed title like "The Movie (2021)".
function parseRssTitle(raw: string): { title: string; year?: number } {
  const decoded = raw.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').trim()
  const m = decoded.match(/^(.*?)[\s.(\[]+((?:19|20)\d{2})\b/)
  if (m) return { title: m[1].replace(/[._]/g, ' ').trim(), year: parseInt(m[2], 10) }
  return { title: decoded.replace(/[._]/g, ' ').trim() }
}

async function fetchRssList(url: string, mediaType: 'movie' | 'tv'): Promise<Candidate[]> {
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`RSS HTTP ${res.status}`)
  const xml = await res.text()

  // Pull each <item>…</item> (or Atom <entry>) and its <title>. Light regex parse — RSS list feeds
  // are simple and we only need the title to resolve via TMDB.
  const titles: string[] = []
  const itemRe = /<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml)) !== null && titles.length < MAX_ITEMS_PER_SYNC) {
    const titleMatch = m[1].match(/<title\b[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)
    if (titleMatch) titles.push(titleMatch[1].trim())
  }

  const candidates: Candidate[] = []
  for (const t of titles) {
    const { title, year } = parseRssTitle(t)
    if (!title) continue
    try {
      const hit = mediaType === 'tv' ? await searchTV(title, year) : await searchMovie(title, year)
      if (hit) candidates.push({ tmdbId: hit.id, mediaType })
    } catch {
      /* skip one unresolvable title */
    }
  }
  return candidates
}

// ── Sync ────────────────────────────────────────────────────────────────────

export interface SyncResult {
  added: number
  seen: number
  error?: string
}

/** Resolve a tmdb id to the title/year createItem needs. Returns null if TMDB can't resolve it. */
async function resolveTitle(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<{ title: string; year: number | null } | null> {
  try {
    if (mediaType === 'movie') {
      const m = await getMovie(tmdbId)
      return { title: m.title, year: m.release_date ? parseInt(m.release_date.slice(0, 4), 10) : null }
    }
    const tv = await getTV(tmdbId)
    return { title: tv.name, year: tv.first_air_date ? parseInt(tv.first_air_date.slice(0, 4), 10) : null }
  } catch {
    return null
  }
}

export async function syncImportList(list: ImportList): Promise<SyncResult> {
  const db = getDb()
  let candidates: Candidate[]
  try {
    candidates = list.list_type === 'trakt'
      ? await fetchTraktList(list.url)
      : await fetchRssList(list.url, list.media_type)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    db.prepare('UPDATE import_lists SET last_sync_at = ?, last_error = ? WHERE id = ?').run(Date.now(), error, list.id)
    return { added: 0, seen: 0, error }
  }

  const ledgerHas = db.prepare('SELECT 1 FROM import_list_items WHERE list_id = ? AND tmdb_id = ? AND media_type = ?')
  const ledgerAdd = db.prepare('INSERT OR IGNORE INTO import_list_items (list_id, tmdb_id, media_type, added_at) VALUES (?, ?, ?, ?)')

  let added = 0
  let seen = 0
  for (const c of candidates.slice(0, MAX_ITEMS_PER_SYNC)) {
    seen++
    if (ledgerHas.get(list.id, c.tmdbId, c.mediaType)) continue // already processed by this list

    const resolved = await resolveTitle(c.tmdbId, c.mediaType)
    if (!resolved) continue

    // Long-term monitored item only — never a quick request, so auto-delete never touches it.
    createItem({
      type: c.mediaType === 'tv' ? 'tv' : 'movie',
      title: resolved.title,
      tmdb_id: c.tmdbId,
      year: resolved.year ?? undefined,
      quality_profile_id: list.quality_profile_id,
      // Default off (2026-07): monitoring future episodes is opt-in, not opt-out.
      monitor_future: false,
    })
    ledgerAdd.run(list.id, c.tmdbId, c.mediaType, Date.now())
    added++
  }

  db.prepare('UPDATE import_lists SET last_sync_at = ?, last_error = NULL, added_count = added_count + ? WHERE id = ?')
    .run(Date.now(), added, list.id)
  if (added > 0) console.log(`[import-lists] "${list.name}": added ${added} new item(s) (${seen} seen)`)
  return { added, seen }
}

/** Sync every enabled list. Returns the total number of items added across all lists. */
export async function syncAllImportLists(): Promise<number> {
  const lists = getDb().prepare('SELECT * FROM import_lists WHERE enabled = 1').all() as ImportList[]
  let total = 0
  for (const list of lists) {
    try {
      const r = await syncImportList(list)
      total += r.added
    } catch (err) {
      process.stderr.write(`[import-lists] sync error for "${list.name}": ${err}\n`)
    }
  }
  return total
}
