import chokidar from 'chokidar'
import path from 'path'
import crypto from 'crypto'
import pLimit from 'p-limit'
import { getDb } from '@/lib/db/index'
import { parseFilename } from './filename-parser'
import { probeFile } from './probe'
import type { MediaItem } from './types'

const scanLimit = pLimit(4)

const MEDIA_EXTENSIONS = new Set([
  '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.wmv', '.ts', '.m2ts', '.iso'
])

let watcher: ReturnType<typeof chokidar.watch> | null = null
let knownRoots: string[] = []

function isMediaFile(filePath: string): boolean {
  return MEDIA_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function generateId(str: string): string {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32)
}

function isTvRoot(rootPath: string): boolean {
  const name = path.basename(rootPath).toLowerCase()
  return /^(tv|shows?|series|anime|episodes?)$/.test(name)
}

function resolveType(filePath: string, parsedIsEpisode: boolean): 'movie' | 'episode' {
  const root = knownRoots.find(r => filePath.startsWith(r + '/') || filePath === r)
  if (root) return isTvRoot(root) ? 'episode' : 'movie'
  return parsedIsEpisode ? 'episode' : 'movie'
}

function cleanShowDirName(dirName: string): string {
  return dirName
    .replace(/^\[.+?\]\s*/, '')               // strip leading [Group] tag
    .replace(/(\s*\[.+?\])+$/, '')             // strip trailing [codec][quality] tags
    .replace(/\s+Complete\s*\([^)]*\)/gi, '')  // strip "Complete (001-500 + Movies)"
    .replace(/\s+Complete$/i, '')
    .trim()
}

function extractSeriesFromPath(
  filePath: string,
): { seriesTitle: string; seasonNumber: number | null } | null {
  const tvRoot = knownRoots.find(r => isTvRoot(r) && filePath.startsWith(r + '/'))
  if (!tvRoot) return null

  const rel = filePath.slice(tvRoot.length + 1)
  const parts = rel.split('/')
  if (parts.length < 3) return null // need show/season/file

  const showDir = parts[0]
  const seasonDir = parts[parts.length - 2]

  const seriesTitle = cleanShowDirName(showDir) || showDir
  const seasonMatch = seasonDir.match(/[Ss](?:eason)?\s*0*(\d+)/i)
  const seasonNumber = seasonMatch ? parseInt(seasonMatch[1], 10) : null

  return { seriesTitle, seasonNumber }
}

export async function scanFile(filePath: string): Promise<void> {
  if (!isMediaFile(filePath)) return
  const db = getDb()
  const id = generateId(filePath)
  const existing = db.prepare('SELECT id FROM media_items WHERE file_path = ?').get(filePath)
  if (existing) return

  try {
    const probe = await probeFile(filePath)
    const parsed = parseFilename(path.basename(filePath))
    const now = Date.now()
    const runtimeTicks = Math.round(probe.durationSeconds * 10_000_000)
    const type = resolveType(filePath, parsed.isEpisode)

    let seriesId: string | null = null
    let effectiveSeason = parsed.season
    let itemTitle = parsed.title

    if (type === 'episode') {
      const fromDir = extractSeriesFromPath(filePath)
      if (fromDir) {
        itemTitle = fromDir.seriesTitle
        if (fromDir.seasonNumber) effectiveSeason = fromDir.seasonNumber
      }
      seriesId = generateId('series:' + itemTitle.toLowerCase())
      const sortTitle = itemTitle.replace(/^(The|A|An)\s+/i, '').trim()
      db.prepare(`
        INSERT OR IGNORE INTO media_items
          (id, type, title, sort_title, year, file_path, added_at, updated_at, scanned_at)
        VALUES (?, 'series', ?, ?, ?, NULL, ?, ?, ?)
      `).run(seriesId, itemTitle, sortTitle, parsed.year, now, now, now)
    }

    db.prepare(`
      INSERT OR REPLACE INTO media_items
        (id, type, title, sort_title, year, runtime_ticks, file_path, series_id, season_number, episode_number, episode_title, added_at, updated_at, scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, type, itemTitle,
      itemTitle.replace(/^(The|A|An)\s+/i, '').trim(),
      parsed.year, runtimeTicks, filePath,
      seriesId, effectiveSeason, parsed.episode,
      type === 'episode' ? (parsed.episodeTitle ?? null) : null,
      now, now, now
    )
    console.log(`[scanner] Added: ${itemTitle}`)
  } catch (err) {
    console.error(`[scanner] Error scanning ${filePath}:`, err)
  }
}

export function removeFromDb(filePath: string): void {
  getDb().prepare('DELETE FROM media_items WHERE file_path = ?').run(filePath)
  console.log(`[scanner] Removed: ${filePath}`)
}

export function initWatcher(): void {
  const mediaRoots = (process.env.MEDIA_ROOTS ?? '').split(':').map(s => s.trim()).filter(Boolean)
  if (mediaRoots.length === 0) {
    console.warn('[scanner] MEDIA_ROOTS not set — filesystem watcher not started')
    return
  }
  if (watcher) return

  knownRoots = mediaRoots

  watcher = chokidar.watch(mediaRoots, {
    ignoreInitial: false,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  })

  watcher.on('add', filePath => { void scanLimit(() => scanFile(filePath)) })
  watcher.on('unlink', filePath => { removeFromDb(filePath) })
  console.log(`[scanner] Watching: ${mediaRoots.join(', ')}`)
}

export async function scanAll(): Promise<{ scanned: number }> {
  const db = getDb()
  const items = db.prepare("SELECT file_path FROM media_items WHERE file_path IS NOT NULL").all() as { file_path: string }[]
  let count = 0
  for (const { file_path } of items) {
    await scanFile(file_path)
    count++
  }
  return { scanned: count }
}
