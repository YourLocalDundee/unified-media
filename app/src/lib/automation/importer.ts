/**
 * Importer: bridges completed qBittorrent downloads into the native media library.
 *
 * The gap this closes:
 *   - grabber.ts sends a torrent to qBittorrent (save path: /downloads/)
 *   - qBittorrent has /data mounted rw (same host dir as /media/movies and /media/tv rw mounts)
 *   - unified-frontend mounts /media/movies and /media/tv rw, and /media/downloads/complete ro
 *   - Primary path: use qBittorrent's setLocation API to move the completed torrent from
 *     /downloads/ into /data/movies/<Title> or /data/tv/<Title>, then trigger a scan
 *     so the file appears at /media/movies/<Title> or /media/tv/<Title> in the scanner.
 *   - Fallback path: if the torrent is no longer in qBittorrent (removed after completion),
 *     scan /media/downloads/complete/ for a matching file/dir and hardlink/copy it into the
 *     library directly.
 *
 * Flow per item:
 *   grabbed monitored_item → find info_hash in grab_history → query qBit for torrent state
 *   → if complete → setLocation (qBit moves the file) → wait 2s → scanPath → mark imported
 *   → update media_requests to 'available'
 *
 * Called every 2 minutes by scheduler.ts.
 */

import path from 'path'
import fs from 'fs'
import { getDb } from '@/lib/db/index'
import { updateItem } from './monitor'
import type { MonitoredItem } from './types'

// qBit states that mean "download is complete, file is fully written"
const COMPLETE_STATES = new Set([
  'uploading',
  'stalledUP',
  'forcedUP',
  'pausedUP',
  'stoppedUP',   // qBit v5+
  'queuedUP',
  'checkingUP',
])

// Characters that are invalid in common filesystem paths — replace with '-'
function sanitizePath(segment: string): string {
  return segment.replace(/[/\\:*?"<>|]/g, '-').trim()
}

/**
 * Build the target path where qBittorrent should move the completed torrent.
 * Used for the qBit setLocation API where /data is qBit's rw mount of the
 * same host directory that unified-frontend reads at /media.
 */
function buildQbitTargetPath(item: MonitoredItem): string {
  const title = sanitizePath(item.title)
  if (item.type === 'movie') {
    const suffix = item.year ? ` (${item.year})` : ''
    return `/data/movies/${title}${suffix}`
  }
  return `/data/tv/${title}`
}

/**
 * Build the local (container-side) path for direct fs operations in fallback 2.
 * Uses /media/movies and /media/tv which are bind-mounted rw from the host.
 * IMPORTANT: never use /data here — /data is the SQLite volume, not the media library.
 */
function buildLocalTargetPath(item: MonitoredItem): string {
  const title = sanitizePath(item.title)
  if (item.type === 'movie') {
    const suffix = item.year ? ` (${item.year})` : ''
    return `/media/movies/${title}${suffix}`
  }
  return `/media/tv/${title}`
}

/**
 * Walk a directory recursively, calling scanFile on every media file found.
 * The watcher picks up new files via chokidar but after a setLocation we want
 * to force an immediate scan rather than waiting for the FS event.
 */
async function scanPath(dirPath: string): Promise<void> {
  const { scanFile } = await import('@/lib/media-server/scanner')

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true })
  } catch {
    // Directory may not exist yet if qBit hasn't moved files yet — not fatal
    return
  }

  for (const entry of entries) {
    const full = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      await scanPath(full)
    } else if (entry.isFile()) {
      await scanFile(full)
    }
  }
}

/**
 * Main import loop. Called every 2 minutes by the scheduler.
 *
 * For every monitored_item with status='grabbed':
 *   1. Find the most recent grab_history row to get info_hash
 *   2. Query qBit for that torrent's state
 *   3. If complete, move it via setLocation and trigger a scan
 *   4. Mark item 'imported' and update media_requests
 */
export async function runImportCheck(): Promise<void> {
  const db = getDb()

  // Get all grabbed items (already sent to download client, not yet confirmed in library)
  type GrabbedRow = MonitoredItem
  const grabbed = db
    .prepare("SELECT * FROM monitored_items WHERE status = 'grabbed'")
    .all() as GrabbedRow[]

  if (grabbed.length === 0) return

  // Get most recent grab_history row per item to find info_hash
  type HashRow = { item_id: number; info_hash: string }
  const hashRows = db
    .prepare(`
      SELECT gh.item_id, gh.info_hash
      FROM grab_history gh
      INNER JOIN (
        SELECT item_id, MAX(grabbed_at) AS latest
        FROM grab_history
        GROUP BY item_id
      ) latest ON gh.item_id = latest.item_id AND gh.grabbed_at = latest.latest
      WHERE gh.item_id IN (${grabbed.map(() => '?').join(',')})
    `)
    .all(...grabbed.map(i => i.id)) as HashRow[]

  if (hashRows.length === 0) return

  const hashByItemId = new Map<number, string>()
  for (const row of hashRows) {
    hashByItemId.set(row.item_id, row.info_hash)
  }

  // Query qBittorrent for all relevant hashes in one request
  let qbitTorrents: Array<{ hash: string; state: string; progress: number }> = []
  try {
    const { qbitFetch } = await import('@/lib/qbittorrent/session')
    const allHashes = [...hashByItemId.values()].join('|')
    qbitTorrents = await qbitFetch<Array<{ hash: string; state: string; progress: number }>>(
      `/api/v2/torrents/info?hashes=${allHashes}`
    )
  } catch (err) {
    // qBit unavailable — skip this cycle, will retry next tick
    process.stderr.write(`[importer] qBittorrent unavailable: ${err}\n`)
    return
  }

  // Build lookup by hash (lowercase for case-insensitive comparison)
  const torrentByHash = new Map<string, { hash: string; state: string; progress: number }>()
  for (const t of qbitTorrents) {
    torrentByHash.set(t.hash.toLowerCase(), t)
  }

  const { qbitFetch } = await import('@/lib/qbittorrent/session')

  for (const item of grabbed) {
    // infoHash may be missing (no grab_history row) or the empty string (a magnet/URL add that never
    // surfaced qBittorrent's infohash — recordGrab now recovers it from the magnet, but legacy rows
    // and .torrent-URL adds can still be hashless). Either way we can't look the torrent up by hash,
    // so leave `torrent` undefined and let the same fallbacks used for departed torrents handle it:
    // detect it already reached the library by tmdb_id, or match the completed file by title in
    // /media/downloads/complete. This is what unsticks a grabbed item that would otherwise re-log
    // every tick and never import.
    const infoHash = hashByItemId.get(item.id) ?? ''
    const torrent = infoHash ? torrentByHash.get(infoHash.toLowerCase()) : undefined
    if (!torrent) {
      // Torrent no longer in qBittorrent (removed after completion or manually).
      // Fallback 1: check if content already reached MEDIA_ROOTS (indexed by scanner).
      if (item.tmdb_id != null) {
        const mediaType = item.type === 'movie' ? 'movie' : 'tv'
        const alreadyInLibrary = db
          .prepare('SELECT id FROM media_items WHERE tmdb_id = ? AND type IN (?, ?) LIMIT 1')
          .get(item.tmdb_id, item.type, mediaType === 'movie' ? 'movie' : 'episode')
        if (alreadyInLibrary) {
          updateItem(item.id, { status: 'imported' })
          const now = Date.now()
          db.prepare(`UPDATE media_requests SET status='available', updated_at=? WHERE tmdb_id=? AND media_type=? AND status='approved'`)
            .run(now, item.tmdb_id, mediaType)
          console.log(`[importer] "${item.title}" already in library (tmdb_id=${item.tmdb_id}) — marked imported`)
          continue
        }
      }
      // Fallback 2: look for the file/dir in /media/downloads/complete/ and move it to the library.
      const grabHistoryRow = db.prepare(
        'SELECT release_title FROM grab_history WHERE item_id = ? ORDER BY grabbed_at DESC LIMIT 1'
      ).get(item.id) as { release_title: string } | undefined

      if (grabHistoryRow?.release_title) {
        const releaseTitle = grabHistoryRow.release_title
        const completePath = '/media/downloads/complete'

        try {
          const entries = fs.readdirSync(completePath)

          // Normalise a name for matching: lowercase, strip leading site-prefix patterns
          // like "www.UIndex.org    -    " and replace punctuation with spaces.
          function normaliseName(s: string): string {
            return s
              .replace(/^www\.[^\s]+ *-+ */i, '')   // strip "www.site.tld  -  " prefix
              .replace(/^\[[^\]]*\] */i, '')          // strip "[GroupName] " prefix
              .toLowerCase()
              .replace(/[._\-[\]()]/g, ' ')          // punctuation → spaces
              .replace(/\s+/g, ' ')
              .trim()
          }

          const normRelease = normaliseName(releaseTitle)

          // Score each entry: count how many space-delimited tokens from normRelease
          // appear in normEntry. Prefer the entry with the most token matches.
          function scoreMatch(entryName: string): number {
            const normEntry = normaliseName(entryName)
            const tokens = normRelease.split(' ').filter(t => t.length >= 3)
            return tokens.filter(t => normEntry.includes(t)).length
          }

          // Require at least 4 significant token matches to avoid false positives.
          const MIN_SCORE = 4
          let bestMatch: string | undefined
          let bestScore = MIN_SCORE - 1
          for (const e of entries) {
            const s = scoreMatch(e)
            if (s > bestScore) { bestScore = s; bestMatch = e }
          }
          const match = bestMatch

          if (match) {
            const sourcePath = path.join(completePath, match)
            const targetPath = buildLocalTargetPath(item)

            // Create the target directory
            fs.mkdirSync(targetPath, { recursive: true })

            const stat = fs.statSync(sourcePath)
            if (stat.isDirectory()) {
              // Multi-file torrent: hardlink/copy each video file into targetPath
              const files = fs.readdirSync(sourcePath)
              for (const file of files) {
                const ext = path.extname(file).toLowerCase()
                if (['.mkv', '.mp4', '.avi', '.m4v', '.mov', '.wmv'].includes(ext)) {
                  const dest = path.join(targetPath, file)
                  try {
                    fs.linkSync(path.join(sourcePath, file), dest)  // hardlink first
                  } catch {
                    fs.copyFileSync(path.join(sourcePath, file), dest)  // fallback copy
                  }
                }
              }
            } else {
              // Single-file torrent: hardlink/copy directly
              const dest = path.join(targetPath, path.basename(sourcePath))
              try {
                fs.linkSync(sourcePath, dest)
              } catch {
                fs.copyFileSync(sourcePath, dest)
              }
            }

            await scanPath(targetPath)
            updateItem(item.id, { status: 'imported' })

            if (item.tmdb_id != null) {
              const mediaType = item.type === 'movie' ? 'movie' : 'tv'
              const now2 = Date.now()
              db.prepare(`UPDATE media_requests SET status='available', updated_at=? WHERE tmdb_id=? AND media_type=? AND status='approved'`)
                .run(now2, item.tmdb_id, mediaType)
            }

            console.log(`[importer] Moved "${item.title}" from downloads/complete to ${targetPath}`)
            continue
          }
        } catch (scanErr) {
          process.stderr.write(`[importer] Error scanning downloads/complete for "${item.title}": ${scanErr}\n`)
        }
      }

      const hashNote = infoHash ? `hash ${infoHash}` : 'no info_hash recorded'
      process.stderr.write(`[importer] "${item.title}" (${hashNote}) not in qBt and not in library — file may be in downloads/complete awaiting manual import\n`)
      continue
    }

    const isComplete = COMPLETE_STATES.has(torrent.state) || torrent.progress >= 1.0
    if (!isComplete) continue

    const targetPath = buildQbitTargetPath(item)

    try {
      // Move the torrent's save location to the appropriate library directory
      await qbitFetch<string>('/api/v2/torrents/setLocation', {
        method: 'POST',
        body: new URLSearchParams({ hashes: infoHash, location: targetPath }),
      })

      // Give qBittorrent 2 seconds to complete the filesystem move
      await new Promise<void>(resolve => setTimeout(resolve, 2000))

      // Scan the target directory so the media item appears in media_items immediately
      await scanPath(targetPath)

      // Transition status to 'imported'
      updateItem(item.id, { status: 'imported' })

      // Mark matching media_requests as available
      if (item.tmdb_id != null) {
        const mediaType = item.type === 'movie' ? 'movie' : 'tv'
        const now = Date.now()
        db.prepare(`
          UPDATE media_requests
          SET status = 'available', updated_at = ?
          WHERE tmdb_id = ? AND media_type = ? AND status = 'approved'
        `).run(now, item.tmdb_id, mediaType)
      }

      console.log(`[importer] Imported "${item.title}" (${item.type}) from hash ${infoHash} to ${targetPath}`)
    } catch (err) {
      process.stderr.write(`[importer] Error importing "${item.title}" (hash ${infoHash}): ${err}\n`)
      // Continue to next item — don't crash the whole loop
    }
  }
}
