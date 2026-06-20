/**
 * HLS transcoding for the native media server (Independence Build Phase 5).
 *
 * Three tiers, chosen at transcode-start time by probing the source file's codecs:
 *
 *   Tier A  remux            h264 video + aac/mp3 audio  → copy both streams to TS/HLS
 *   Tier B  audio transcode  h264 video + other audio    → copy video, re-encode audio to AAC
 *   Tier C  full VAAPI       non-h264 video              → h264_vaapi + AAC audio
 *
 * Tier C requires /dev/dri/renderD128 bind-mounted into the container with the process in
 * group 990 (render). If VAAPI device open fails ffmpeg exits non-zero; the error is logged
 * loudly and surfaced to the player — there is no silent CPU fallback.
 *
 * Audio-track selection
 * ---------------------
 * Each transcode is namespaced by the audio-relative index (`-map 0:a:<idx>`), cached under
 * <mediaId>/a<idx>/. The player switches audio by requesting a different `aN` HLS URL and
 * re-seeking to the captured playback position (the "restart-and-seek" / option B approach).
 * No timestamp offset is introduced — the new stream shares the same 0-based timeline as the
 * file, so the player's existing position path (currentTime, resume, progress reporting,
 * position_ticks) stays the single source of truth for position.
 *
 * FUTURE (option A): start the per-audio transcode at the current position with input-seek
 * (`-ss T`, already supported by buildArgs' seekSec) for an instant switch instead of waiting
 * for the linear transcode to reach T. Deferred because it requires a stream-start time offset,
 * which would fork position tracking away from the single 0-based timeline the player relies on
 * for watch-progress/continue-watching correctness.
 *
 * v1 seek behaviour
 * -----------------
 * Segments are generated linearly from the start of the file. Seeking past the current
 * transcode position means requesting a segment that does not exist yet. waitForSegment()
 * polls for 10 seconds and returns false if the segment is still absent. The route handler
 * returns 503, hls.js retries up to its fragLoadingMaxRetry limit, then fires a fatal
 * FRAG_LOAD_ERROR which the player surfaces as an actionable error message. Seek backwards
 * to a position with generated segments to resume. Seek-ahead restart is a v2 feature.
 * This also bounds option-B audio switching: a switch resumes at the captured position by
 * letting the linear transcode reach it; switching then immediately seeking far ahead hits
 * the same limitation.
 *
 * Cache
 * -----
 * TRANSCODE_CACHE env (default /tmp/transcode — not persistent; set to a named volume in
 * production compose so transcodes survive container restarts).
 * TRANSCODE_CACHE_MAX_MB env (default 4096 = 4 GB) caps total cache size. LRU eviction by
 * directory atime runs before every new transcode.
 */

import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import pLimit from 'p-limit'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRANSCODE_CACHE   = process.env.TRANSCODE_CACHE          ?? '/tmp/transcode'
const FFMPEG_BIN        = process.env.FFMPEG_PATH              ?? 'ffmpeg'
const VAAPI_DEVICE      = process.env.VAAPI_DEVICE             ?? '/dev/dri/renderD128'
const MAX_CACHE_MB      = parseInt(process.env.TRANSCODE_CACHE_MAX_MB ?? '4096', 10)
const HLS_TIME          = 4   // seconds per segment
const MANIFEST_WAIT_MS  = 60_000  // max wait for first manifest write
const SEGMENT_WAIT_MS   = 10_000  // max wait for a requested segment

// ---------------------------------------------------------------------------
// Codec sets
// ---------------------------------------------------------------------------

// H.264 is the only video codec universally supported in HLS MPEG-TS across all major
// browsers (Chrome, Firefox, Safari, Edge). HEVC is Safari-only; VP9/AV1 are not valid in TS.
const BROWSER_SAFE_VIDEO = new Set(['h264', 'avc'])

// AAC and MP3 are safe in HLS TS. Opus is Chrome/Firefox-only (not Apple HLS/Safari).
// AC3, EAC3, DTS, TrueHD, DTS-HD are not browser-safe in HLS TS segments.
const BROWSER_SAFE_AUDIO = new Set(['aac', 'mp3'])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TranscodeTier = 'remux' | 'audio_transcode' | 'full_vaapi'

// ---------------------------------------------------------------------------
// In-process job registry — one ChildProcess per media ID
// ---------------------------------------------------------------------------

const activeJobs   = new Map<string, ChildProcess>()
const startingJobs = new Set<string>()   // guard against double-spawn on concurrent requests

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

// Cache is namespaced per audio-relative index so switching audio track produces an
// independent transcode (different `-map 0:a:N`) without overwriting another track's
// segments: TRANSCODE_CACHE/<mediaId>/a<audioIdx>/seg*.ts
function getCacheDir(mediaId: string, audioIdx: number): string {
  return path.join(TRANSCODE_CACHE, mediaId, `a${audioIdx}`)
}

export function getSegmentPath(mediaId: string, audioIdx: number, segName: string): string {
  return path.join(getCacheDir(mediaId, audioIdx), segName)
}

// Job-registry key: one ffmpeg process per (media, audio-track) pair.
function jobKey(mediaId: string, audioIdx: number): string {
  return `${mediaId}:a${audioIdx}`
}

// ---------------------------------------------------------------------------
// Tier selection
// ---------------------------------------------------------------------------

export function chooseTier(
  videoCodec: string | null,
  audioCodec: string | null,
): TranscodeTier {
  const videoOk = videoCodec != null && BROWSER_SAFE_VIDEO.has(videoCodec.toLowerCase())
  const audioOk = audioCodec != null && BROWSER_SAFE_AUDIO.has(audioCodec.toLowerCase())
  if (videoOk && audioOk)  return 'remux'
  if (videoOk && !audioOk) return 'audio_transcode'
  return 'full_vaapi'
}

// ---------------------------------------------------------------------------
// ffmpeg argument builders
// ---------------------------------------------------------------------------

function buildArgs(
  inputPath: string,
  cacheDir:  string,
  tier:      TranscodeTier,
  startNum:  number,
  audioIdx:  number,
  seekSec?:  number,
): string[] {
  const segFile  = path.join(cacheDir, 'seg%05d.ts')
  const manifest = path.join(cacheDir, 'master.m3u8')
  const args: string[] = ['-y']

  // Tier C: -vaapi_device MUST come before -i so ffmpeg opens the render node during
  // context initialisation. If the device is absent or permission-denied ffmpeg exits
  // with a non-zero code immediately rather than falling back to software encoding.
  if (tier === 'full_vaapi') {
    args.push('-vaapi_device', VAAPI_DEVICE)
  }

  // Fast (keyframe-aligned) input seek when restarting from a non-zero position.
  if (seekSec != null && seekSec > 0) {
    args.push('-ss', String(seekSec))
  }

  args.push('-i', inputPath)

  // Map exactly one video and one audio stream. The audio stream is the intended track
  // (default, else first) selected by selectAudioTrack, so the transcoded AAC matches the
  // track the compatibility check evaluated — never a commentary or secondary-language track.
  args.push('-map', '0:v:0', '-map', `0:a:${audioIdx}`)

  // Video codec ---------------------------------------------------------------
  if (tier === 'full_vaapi') {
    // Upload decoded frames to the VAAPI device then encode to h264_vaapi.
    // format=nv12 ensures the correct input pixel format before hwupload.
    args.push('-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi')
  } else {
    // Tiers A and B: video is already h264 — copy without re-encoding.
    args.push('-c:v', 'copy')
  }

  // Audio codec ---------------------------------------------------------------
  if (tier === 'remux') {
    // Both streams are already browser-compatible — copy audio unchanged.
    args.push('-c:a', 'copy')
  } else {
    // Tiers B and C: re-encode audio to AAC stereo.
    // v1 simplification: -ac 2 downmixes surround (5.1, 7.1, Atmos, etc.) to stereo
    // for maximum browser compatibility. Revisit in v2 to pass through multi-channel
    // AAC when player and browser pipeline confirm support.
    args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2')
  }

  // HLS muxer -----------------------------------------------------------------
  args.push(
    '-hls_time',             String(HLS_TIME),
    '-hls_list_size',        '0',
    '-start_number',         String(startNum),
    '-hls_segment_filename', segFile,
    '-f', 'hls',
    manifest,
  )

  return args
}

// ---------------------------------------------------------------------------
// LRU cache eviction
// ---------------------------------------------------------------------------

// Recursively sums the byte size of every file under a directory, and tracks the most
// recent atime seen — segments live one level deeper now (<mediaId>/a<idx>/seg*.ts).
async function dirSizeAndAtime(dir: string): Promise<{ sizeBytes: number; atime: number }> {
  let sizeBytes = 0
  let atime = 0
  const names = await fs.readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    const p = path.join(dir, name)
    const st = await fs.stat(p).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) {
      const sub = await dirSizeAndAtime(p)
      sizeBytes += sub.sizeBytes
      atime = Math.max(atime, sub.atime)
    } else {
      sizeBytes += st.size
      atime = Math.max(atime, st.atimeMs)
    }
  }
  return { sizeBytes, atime }
}

async function evictLruIfNeeded(): Promise<void> {
  try {
    const names = await fs.readdir(TRANSCODE_CACHE).catch(() => [] as string[])
    const entries: { dir: string; atime: number; sizeBytes: number }[] = []

    for (const name of names) {
      // Skip dot-dirs (the subtitle cache lives at TRANSCODE_CACHE/.subs).
      if (name.startsWith('.')) continue
      const dir  = path.join(TRANSCODE_CACHE, name)
      const dstat = await fs.stat(dir).catch(() => null)
      if (!dstat?.isDirectory()) continue
      const { sizeBytes, atime } = await dirSizeAndAtime(dir)
      entries.push({ dir, atime: Math.max(atime, dstat.atimeMs), sizeBytes })
    }

    const totalMB = entries.reduce((s, e) => s + e.sizeBytes, 0) / (1024 * 1024)
    if (totalMB <= MAX_CACHE_MB) return

    // Oldest access time first (least recently used)
    entries.sort((a, b) => a.atime - b.atime)

    let remaining = totalMB
    for (const { dir, sizeBytes } of entries) {
      if (remaining <= MAX_CACHE_MB) break
      const mediaId = path.basename(dir)
      // Never evict a media item that has any active transcode (any audio track).
      if ([...activeJobs.keys()].some(k => k.startsWith(`${mediaId}:`))) continue
      await fs.rm(dir, { recursive: true, force: true })
      remaining -= sizeBytes / (1024 * 1024)
      console.log(
        `[transcode] LRU evicted: ${mediaId} (${(sizeBytes / 1024 / 1024).toFixed(1)} MB freed)`,
      )
    }
  } catch (err) {
    console.error('[transcode] LRU eviction error:', err)
  }
}

// ---------------------------------------------------------------------------
// Spawn ffmpeg
// ---------------------------------------------------------------------------

async function spawnFfmpeg(
  mediaId:  string,
  filePath: string,
  tier:     TranscodeTier,
  startNum: number,
  audioIdx: number,
  seekSec?: number,
): Promise<void> {
  const cacheDir = getCacheDir(mediaId, audioIdx)
  await fs.mkdir(cacheDir, { recursive: true })
  const key = jobKey(mediaId, audioIdx)

  const args = buildArgs(filePath, cacheDir, tier, startNum, audioIdx, seekSec)
  console.log(`[transcode] start tier=${tier} id=${mediaId} a${audioIdx}`, FFMPEG_BIN, args.slice(0, 14).join(' '), '...')

  const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  activeJobs.set(key, proc)

  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  proc.on('close', (code) => {
    activeJobs.delete(key)
    if (code === 0) {
      console.log(`[transcode] done tier=${tier} id=${mediaId}`)
    } else {
      // Tier C failures are flagged as ERROR because they commonly indicate a device
      // or permission problem that must be fixed rather than retried silently.
      const prefix = tier === 'full_vaapi'
        ? `[transcode][ERROR] VAAPI encode failed (code=${code}) for ${mediaId}. ` +
          `Verify /dev/dri/renderD128 is mounted and the process is in group 990 (render).`
        : `[transcode] ffmpeg exited code=${code} for ${mediaId}`
      console.error(prefix + '\n' + stderr.slice(-1200))
    }
  })

  proc.on('error', (err) => {
    activeJobs.delete(key)
    console.error(`[transcode] spawn error for ${mediaId} a${audioIdx}:`, err)
  })
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true } catch { return false }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensures an HLS manifest exists for the given media item.
 *
 * If the manifest is already in cache it is returned immediately. Otherwise a transcode
 * is started (if not already in progress), and this function blocks until the manifest
 * appears on disk (ffmpeg writes it after the first segment) or 60 seconds elapse.
 *
 * Throws if the transcode process exits with an error before producing the manifest,
 * or if the timeout is exceeded.
 */
export async function ensureHls(
  mediaId:    string,
  filePath:   string,
  videoCodec: string | null,
  audioCodec: string | null,
  audioIndex: number = 0,
): Promise<string> {
  const cacheDir = getCacheDir(mediaId, audioIndex)
  const manifest = path.join(cacheDir, 'master.m3u8')
  const key = jobKey(mediaId, audioIndex)

  if (await fileExists(manifest)) return manifest

  await evictLruIfNeeded()

  if (!activeJobs.has(key) && !startingJobs.has(key)) {
    startingJobs.add(key)
    try {
      const tier = chooseTier(videoCodec, audioCodec)
      await spawnFfmpeg(mediaId, filePath, tier, 0, audioIndex)
    } finally {
      startingJobs.delete(key)
    }
  }

  const deadline = Date.now() + MANIFEST_WAIT_MS
  while (Date.now() < deadline) {
    if (await fileExists(manifest)) return manifest
    await sleep(250)

    // If the process already exited and the manifest still isn't there, give up
    // immediately rather than burning the full 60 s.
    if (!activeJobs.has(key) && !startingJobs.has(key)) {
      if (await fileExists(manifest)) return manifest
      const tier = chooseTier(videoCodec, audioCodec)
      const detail = tier === 'full_vaapi'
        ? ` Verify ${VAAPI_DEVICE} is bind-mounted (devices:) and the container process is in group 990 (render). Check container logs for ffmpeg stderr.`
        : ''
      throw new Error(`Transcode for ${mediaId} a${audioIndex} exited before producing a manifest.${detail}`)
    }
  }

  throw new Error(`Transcode for ${mediaId} a${audioIndex} timed out after ${MANIFEST_WAIT_MS / 1000}s.`)
}

/**
 * Polls for an HLS segment to appear in the cache.
 *
 * Returns true when the segment is available, false if SEGMENT_WAIT_MS (10 s) elapses.
 *
 * A false return means the requested segment is ahead of the current linear transcode
 * position. See the v1 seek behaviour note at the top of this file.
 */
export async function waitForSegment(segPath: string): Promise<boolean> {
  if (await fileExists(segPath)) return true
  const deadline = Date.now() + SEGMENT_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(200)
    if (await fileExists(segPath)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Embedded subtitle extraction → WebVTT
// ---------------------------------------------------------------------------

// Extracted WebVTT files are cached under a dot-dir so LRU eviction skips them
// (they are tiny and cheap to regenerate, but caching avoids re-running ffmpeg on
// every track (re)selection).
const SUBS_CACHE = path.join(TRANSCODE_CACHE, '.subs')
// Cap simultaneous subtitle ffmpeg extractions to avoid saturating CPU on cold cache.
const subExtractLimit = pLimit(2)

function execFile(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString() })
    proc.on('close', (code) => resolve({ code: code ?? -1, stderr }))
    proc.on('error', () => resolve({ code: -1, stderr }))
  })
}

/**
 * Extracts a single embedded *text* subtitle stream (by absolute ffprobe stream index)
 * and converts it to WebVTT, returning the path to the cached .vtt file. The caller is
 * responsible for rejecting image-based codecs (isImageSubtitleCodec) before calling this.
 *
 * Uses `-map 0:<absoluteIndex>` (the ffprobe stream index, not the subtitle-relative one)
 * so the exact track the player listed is the one extracted.
 */
export async function extractSubtitleToVtt(
  mediaId: string,
  filePath: string,
  absoluteIndex: number,
): Promise<string> {
  const dir = path.join(SUBS_CACHE, mediaId)
  const out = path.join(dir, `${absoluteIndex}.vtt`)
  if (await fileExists(out)) return out

  return subExtractLimit(async () => {
    // Re-check cache inside the limit slot in case a concurrent request already extracted it.
    if (await fileExists(out)) return out

    await fs.mkdir(dir, { recursive: true })
    const { code, stderr } = await execFile(FFMPEG_BIN, [
      '-y',
      '-i', filePath,
      '-map', `0:${absoluteIndex}`,
      '-c:s', 'webvtt',
      '-f', 'webvtt',
      out,
    ])

    if (code !== 0 || !(await fileExists(out))) {
      await fs.rm(out, { force: true }).catch(() => {})
      throw new Error(`Subtitle extraction failed for ${mediaId} stream ${absoluteIndex} (code=${code}).\n${stderr.slice(-600)}`)
    }
    return out
  })
}
