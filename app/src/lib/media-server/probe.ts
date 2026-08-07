import { execFile } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import type { ProbeResult, ProbeStream } from './types'

const execFileAsync = promisify(execFile)

// Use the system ffprobe (shipped by the apt `ffmpeg` package in the runtime image,
// same source as the ffmpeg binary transcode.ts spawns). Overridable for local dev.
const FFPROBE_BIN = process.env.FFPROBE_PATH ?? 'ffprobe'

// In-process probe cache (A4-M2). ffprobe was re-spawned on every HLS manifest
// request, every embedded-subtitle fetch, and every playback-data load — re-probing
// the same large MKV (hundreds of ms each) during a single session. File metadata is
// immutable for a given (path, mtime), so cache on that key with a short TTL and a
// size cap to bound memory.
const PROBE_CACHE_TTL_MS = 5 * 60 * 1000
const PROBE_CACHE_MAX = 256
const probeCache = new Map<string, { result: ProbeResult; expires: number }>()

interface RawStream {
  index: number
  codec_type: string
  codec_name: string
  width?: number
  height?: number
  channels?: number
  tags?: Record<string, string>
  disposition?: Record<string, number>
}

export async function probeFile(filePath: string): Promise<ProbeResult> {
  // Stat first so the cache key reflects the current file version (a re-encode bumps
  // mtime → fresh probe). size is reused below, so this is not an extra stat.
  const { size, mtimeMs } = await stat(filePath)
  const cacheKey = `${filePath}:${mtimeMs}`
  const now = Date.now()
  const cached = probeCache.get(cacheKey)
  if (cached && cached.expires > now) return cached.result

  const { stdout } = await execFileAsync(FFPROBE_BIN, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ])

  const data = JSON.parse(stdout) as {
    streams: RawStream[]
    format: { duration: string; bit_rate: string; size: string }
  }

  const video = data.streams.find(s => s.codec_type === 'video')
  const firstAudio = data.streams.find(s => s.codec_type === 'audio')

  function toProbeStream(s: RawStream): ProbeStream {
    return {
      index: s.index,
      codec: s.codec_name ?? 'unknown',
      language: s.tags?.language ?? 'und',
      title: s.tags?.title ?? s.tags?.language ?? `Track ${s.index}`,
      channels: s.channels ?? 0,
      isDefault: (s.disposition?.default ?? 0) === 1,
      isForced: (s.disposition?.forced ?? 0) === 1,
    }
  }

  const audioStreams = data.streams
    .filter(s => s.codec_type === 'audio')
    .map(toProbeStream)

  const subtitleStreams = data.streams
    .filter(s => s.codec_type === 'subtitle')
    .map(toProbeStream)

  const result: ProbeResult = {
    durationSeconds: parseFloat(data.format.duration ?? '0'),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    videoCodec: video?.codec_name ?? null,
    audioCodec: firstAudio?.codec_name ?? null,
    audioChannels: firstAudio?.channels ?? 2,
    bitrate: parseInt(data.format.bit_rate ?? '0', 10),
    fileSizeBytes: size,
    audioStreams,
    subtitleStreams,
  }

  // Evict the oldest entry (Map preserves insertion order) once over the cap.
  if (probeCache.size >= PROBE_CACHE_MAX) {
    const oldest = probeCache.keys().next().value
    if (oldest !== undefined) probeCache.delete(oldest)
  }
  probeCache.set(cacheKey, { result, expires: now + PROBE_CACHE_TTL_MS })

  return result
}
