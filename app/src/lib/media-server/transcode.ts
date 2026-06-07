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
 * v1 seek behaviour
 * -----------------
 * Segments are generated linearly from the start of the file. Seeking past the current
 * transcode position means requesting a segment that does not exist yet. waitForSegment()
 * polls for 10 seconds and returns false if the segment is still absent. The route handler
 * returns 503, hls.js retries up to its fragLoadingMaxRetry limit, then fires a fatal
 * FRAG_LOAD_ERROR which the player surfaces as an actionable error message. Seek backwards
 * to a position with generated segments to resume. Seek-ahead restart is a v2 feature.
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

function getCacheDir(mediaId: string): string {
  return path.join(TRANSCODE_CACHE, mediaId)
}

export function getSegmentPath(mediaId: string, segName: string): string {
  return path.join(getCacheDir(mediaId), segName)
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

  // Map exactly one video and one audio stream
  args.push('-map', '0:v:0', '-map', '0:a:0')

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

async function evictLruIfNeeded(): Promise<void> {
  try {
    const names = await fs.readdir(TRANSCODE_CACHE).catch(() => [] as string[])
    const entries: { dir: string; atime: number; sizeBytes: number }[] = []

    for (const name of names) {
      const dir  = path.join(TRANSCODE_CACHE, name)
      const dstat = await fs.stat(dir).catch(() => null)
      if (!dstat?.isDirectory()) continue
      let sizeBytes = 0
      const files = await fs.readdir(dir).catch(() => [] as string[])
      for (const f of files) {
        const st = await fs.stat(path.join(dir, f)).catch(() => null)
        if (st) sizeBytes += st.size
      }
      entries.push({ dir, atime: dstat.atimeMs, sizeBytes })
    }

    const totalMB = entries.reduce((s, e) => s + e.sizeBytes, 0) / (1024 * 1024)
    if (totalMB <= MAX_CACHE_MB) return

    // Oldest access time first (least recently used)
    entries.sort((a, b) => a.atime - b.atime)

    let remaining = totalMB
    for (const { dir, sizeBytes } of entries) {
      if (remaining <= MAX_CACHE_MB) break
      const mediaId = path.basename(dir)
      if (activeJobs.has(mediaId)) continue  // never evict an active transcode
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
  seekSec?: number,
): Promise<void> {
  const cacheDir = getCacheDir(mediaId)
  await fs.mkdir(cacheDir, { recursive: true })

  const args = buildArgs(filePath, cacheDir, tier, startNum, seekSec)
  console.log(`[transcode] start tier=${tier} id=${mediaId}`, FFMPEG_BIN, args.slice(0, 12).join(' '), '...')

  const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  activeJobs.set(mediaId, proc)

  let stderr = ''
  proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

  proc.on('close', (code) => {
    activeJobs.delete(mediaId)
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
    activeJobs.delete(mediaId)
    console.error(`[transcode] spawn error for ${mediaId}:`, err)
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
): Promise<string> {
  const cacheDir = getCacheDir(mediaId)
  const manifest = path.join(cacheDir, 'master.m3u8')

  if (await fileExists(manifest)) return manifest

  await evictLruIfNeeded()

  if (!activeJobs.has(mediaId) && !startingJobs.has(mediaId)) {
    startingJobs.add(mediaId)
    try {
      const tier = chooseTier(videoCodec, audioCodec)
      await spawnFfmpeg(mediaId, filePath, tier, 0)
    } finally {
      startingJobs.delete(mediaId)
    }
  }

  const deadline = Date.now() + MANIFEST_WAIT_MS
  while (Date.now() < deadline) {
    if (await fileExists(manifest)) return manifest
    await sleep(250)

    // If the process already exited and the manifest still isn't there, give up
    // immediately rather than burning the full 60 s.
    if (!activeJobs.has(mediaId) && !startingJobs.has(mediaId)) {
      if (await fileExists(manifest)) return manifest
      const tier = chooseTier(videoCodec, audioCodec)
      const detail = tier === 'full_vaapi'
        ? ` Verify ${VAAPI_DEVICE} is bind-mounted (devices:) and the container process is in group 990 (render). Check container logs for ffmpeg stderr.`
        : ''
      throw new Error(`Transcode for ${mediaId} exited before producing a manifest.${detail}`)
    }
  }

  throw new Error(`Transcode for ${mediaId} timed out after ${MANIFEST_WAIT_MS / 1000}s.`)
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
