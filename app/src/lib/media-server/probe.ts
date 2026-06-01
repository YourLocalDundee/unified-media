import { path as ffprobePath } from '@ffprobe-installer/ffprobe'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { stat } from 'fs/promises'
import type { ProbeResult, ProbeStream } from './types'

const execFileAsync = promisify(execFile)

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
  const { stdout } = await execFileAsync(ffprobePath, [
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

  const { size } = await stat(filePath)

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

  return {
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
}
