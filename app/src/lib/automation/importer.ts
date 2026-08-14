/**
 * Importer: bridges completed UMT downloads into the native media library.
 *
 * The gap this closes:
 *   - grabber.ts sends a torrent to UMT
 *   - Primary path: use UMT's setLocation API to move the completed torrent out of
 *     the download directory and into the library, then trigger a scan so it appears
 *     immediately rather than waiting for the filesystem watcher.
 *   - Fallback path: if the torrent is no longer in UMT (removed after completion),
 *     search the completed-downloads directory for a matching file/dir and hardlink/copy it
 *     into the library directly.
 *
 * PATH CONTRACT — read before changing any path in this file:
 *   Every container must mount the library tree at the SAME container path, and MEDIA_ROOTS
 *   must name the subdirectories inside it that the scanner indexes. Both are load-bearing.
 *   setLocation paths are resolved by UMT, direct fs calls are resolved here, and the
 *   scanner only indexes MEDIA_ROOTS — so a path that is not spelled identically in all three
 *   places produces a silent failure, not an error: files land somewhere real but unwatched
 *   (or in a container's own writable layer, where they vanish on recreate) and the item never
 *   leaves 'grabbed'. That is why the targets below are derived from MEDIA_ROOTS instead of
 *   written out as literals, and why one function now serves both paths.
 *
 * Flow per item:
 *   grabbed monitored_item → find info_hash in grab_history → query UMT for torrent state
 *   → if complete → setLocation (UMT moves the file) → wait 2s → scanPath → mark imported
 *   → update media_requests to 'available'
 *
 * Called every 2 minutes by scheduler.ts.
 */

import path from 'path'
import fs from 'fs'
import { getDb } from '@/lib/db/index'
import { updateItem } from './monitor'
import { collectAvailableNotifications, notifyAll } from '@/lib/notify/available'
import type { MonitoredItem } from './types'

// UMT states that mean "download is complete, file is fully written"
const COMPLETE_STATES = new Set([
  'uploading',
  'stalledUP',
  'forcedUP',
  'pausedUP',
  'stoppedUP',   // UMT v5+
  'queuedUP',
  'checkingUP',
])

// The same library roots the scanner indexes. Colon-separated container paths.
const MEDIA_ROOTS = (process.env.MEDIA_ROOTS ?? '')
  .split(':')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p))

// Where the download client leaves finished content, as seen from this container — and, per the
// path contract above, from UMT too. Override when the tree is mounted somewhere else.
const DOWNLOADS_COMPLETE = path.resolve(
  process.env.DOWNLOADS_COMPLETE ?? '/srv/media/downloads/complete'
)

// Characters that are invalid in common filesystem paths — replace with '-'
function sanitizePath(segment: string): string {
  return segment.replace(/[/\\:*?"<>|]/g, '-').trim()
}

/**
 * The configured root whose last segment is `movies` or `tv`. Returns undefined when
 * MEDIA_ROOTS does not contain one, which is a misconfiguration the caller must refuse to
 * guess past — writing to an invented path is exactly the failure this module had.
 */
function findMediaRoot(kind: 'movies' | 'tv'): string | undefined {
  return MEDIA_ROOTS.find((root) => path.basename(root).toLowerCase() === kind)
}

/**
 * Build the library directory a completed item belongs in. One function, because UMT
 * and this container address the tree identically — see the path contract at the top.
 * Undefined means "no configured root for this media type"; do not substitute a default.
 */
export function buildTargetPath(item: MonitoredItem): string | undefined {
  const title = sanitizePath(item.title)
  if (item.type === 'movie') {
    const root = findMediaRoot('movies')
    if (!root) return undefined
    const suffix = item.year ? ` (${item.year})` : ''
    return path.join(root, `${title}${suffix}`)
  }
  const root = findMediaRoot('tv')
  if (!root) return undefined
  return path.join(root, title)
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
    // Directory may not exist yet if UMT hasn't moved files yet — not fatal
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
 *   2. Query UMT for that torrent's state
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

  // Query UMT for all relevant hashes in one request
  let qbitTorrents: Array<{ hash: string; state: string; progress: number }> = []
  try {
    const { qbitFetch } = await import('@/lib/qbittorrent/session')
    const allHashes = [...hashByItemId.values()].join('|')
    qbitTorrents = await qbitFetch<Array<{ hash: string; state: string; progress: number }>>(
      `/api/v2/torrents/info?hashes=${allHashes}`
    )
  } catch (err) {
    // UMT unavailable — skip this cycle, will retry next tick
    process.stderr.write(`[importer] UMT unavailable: ${err}\n`)
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
    // surfaced UMT's infohash — recordGrab now recovers it from the magnet, but legacy rows
    // and .torrent-URL adds can still be hashless). Either way we can't look the torrent up by hash,
    // so leave `torrent` undefined and let the same fallbacks used for departed torrents handle it:
    // detect it already reached the library by tmdb_id, or match the completed file by title in
    // the completed-downloads directory. This is what unsticks a grabbed item that would
    // otherwise re-log every tick and never import.
    const infoHash = hashByItemId.get(item.id) ?? ''
    const torrent = infoHash ? torrentByHash.get(infoHash.toLowerCase()) : undefined
    if (!torrent) {
      // Torrent no longer in UMT (removed after completion or manually).
      // Fallback 1: check if content already reached MEDIA_ROOTS (indexed by scanner).
      if (item.tmdb_id != null) {
        const mediaType = item.type === 'movie' ? 'movie' : 'tv'
        const alreadyInLibrary = db
          .prepare('SELECT id FROM media_items WHERE tmdb_id = ? AND type IN (?, ?) LIMIT 1')
          .get(item.tmdb_id, item.type, mediaType === 'movie' ? 'movie' : 'episode')
        if (alreadyInLibrary) {
          updateItem(item.id, { status: 'imported' })
          const now = Date.now()
          const payloads = collectAvailableNotifications(item.tmdb_id, mediaType, ['approved'])
          db.prepare(`UPDATE media_requests SET status='available', updated_at=? WHERE tmdb_id=? AND media_type=? AND status='approved'`)
            .run(now, item.tmdb_id, mediaType)
          await notifyAll(payloads)
          console.log(`[importer] "${item.title}" already in library (tmdb_id=${item.tmdb_id}) — marked imported`)
          continue
        }
      }
      // Fallback 2: look for the file/dir in the completed-downloads dir and move it to the library.
      const grabHistoryRow = db.prepare(
        'SELECT release_title FROM grab_history WHERE item_id = ? ORDER BY grabbed_at DESC LIMIT 1'
      ).get(item.id) as { release_title: string } | undefined

      if (grabHistoryRow?.release_title) {
        const releaseTitle = grabHistoryRow.release_title
        const completePath = DOWNLOADS_COMPLETE

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
            const targetPath = buildTargetPath(item)
            if (!targetPath) {
              process.stderr.write(
                `[importer] no MEDIA_ROOTS entry for ${item.type} — cannot place "${item.title}"\n`
              )
              continue
            }

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
              const payloads = collectAvailableNotifications(item.tmdb_id, mediaType, ['approved'])
              db.prepare(`UPDATE media_requests SET status='available', updated_at=? WHERE tmdb_id=? AND media_type=? AND status='approved'`)
                .run(now2, item.tmdb_id, mediaType)
              await notifyAll(payloads)
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

    const targetPath = buildTargetPath(item)
    if (!targetPath) {
      process.stderr.write(
        `[importer] no MEDIA_ROOTS entry for ${item.type} — cannot place "${item.title}"\n`
      )
      continue
    }

    try {
      // Move the torrent's save location to the appropriate library directory
      await qbitFetch<string>('/api/v2/torrents/setLocation', {
        method: 'POST',
        body: new URLSearchParams({ hashes: infoHash, location: targetPath }),
      })

      // Give UMT 2 seconds to complete the filesystem move
      await new Promise<void>(resolve => setTimeout(resolve, 2000))

      // Scan the target directory so the media item appears in media_items immediately
      await scanPath(targetPath)

      // Transition status to 'imported'
      updateItem(item.id, { status: 'imported' })

      // Mark matching media_requests as available
      if (item.tmdb_id != null) {
        const mediaType = item.type === 'movie' ? 'movie' : 'tv'
        const now = Date.now()
        const payloads = collectAvailableNotifications(item.tmdb_id, mediaType, ['approved'])
        db.prepare(`
          UPDATE media_requests
          SET status = 'available', updated_at = ?
          WHERE tmdb_id = ? AND media_type = ? AND status = 'approved'
        `).run(now, item.tmdb_id, mediaType)
        await notifyAll(payloads)
      }

      console.log(`[importer] Imported "${item.title}" (${item.type}) from hash ${infoHash} to ${targetPath}`)
    } catch (err) {
      process.stderr.write(`[importer] Error importing "${item.title}" (hash ${infoHash}): ${err}\n`)
      // Continue to next item — don't crash the whole loop
    }
  }
}
