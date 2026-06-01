import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'

const TRANSCODE_CACHE = process.env.TRANSCODE_CACHE ?? '/tmp/transcode'
const FFMPEG_BIN = process.env.FFMPEG_PATH ?? 'ffmpeg'

export interface TranscodeOptions {
  maxWidth: number
  maxHeight: number
  videoBitrate: number   // kbps
  audioBitrate: number   // kbps
  videoCodec?: string    // default 'libx264'
  audioCodec?: string    // default 'aac'
}

export const QUALITY_PRESETS: Record<string, TranscodeOptions> = {
  '1080p': { maxWidth: 1920, maxHeight: 1080, videoBitrate: 8000, audioBitrate: 384 },
  '720p':  { maxWidth: 1280, maxHeight: 720,  videoBitrate: 4000, audioBitrate: 256 },
  '480p':  { maxWidth: 854,  maxHeight: 480,  videoBitrate: 1500, audioBitrate: 128 },
  '360p':  { maxWidth: 640,  maxHeight: 360,  videoBitrate: 800,  audioBitrate: 128 },
}

export async function transcodeToHls(
  inputPath: string,
  sessionId: string,
  opts: TranscodeOptions
): Promise<string> {
  const outputDir = path.join(TRANSCODE_CACHE, sessionId)
  await fs.mkdir(outputDir, { recursive: true })

  const manifestPath = path.join(outputDir, 'master.m3u8')

  const args = [
    '-i', inputPath,
    '-c:v', opts.videoCodec ?? 'libx264',
    '-b:v', `${opts.videoBitrate}k`,
    '-vf', `scale='min(${opts.maxWidth},iw)':-2`,
    '-c:a', opts.audioCodec ?? 'aac',
    '-b:a', `${opts.audioBitrate}k`,
    '-hls_time', '6',
    '-hls_list_size', '0',
    '-hls_segment_filename', path.join(outputDir, 'seg%05d.ts'),
    '-preset', 'fast',
    '-f', 'hls',
    manifestPath,
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args)
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve(manifestPath)
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`))
    })
    proc.on('error', reject)
  })
}

export async function cleanTranscodeSession(sessionId: string): Promise<void> {
  const sessionDir = path.join(TRANSCODE_CACHE, sessionId)
  await fs.rm(sessionDir, { recursive: true, force: true })
}

export function getHlsManifestPath(sessionId: string): string {
  return path.join(TRANSCODE_CACHE, sessionId, 'master.m3u8')
}
