import crypto from 'crypto'
import { getItemById, getWatchState } from './library'
import { probeFile } from './probe'
import type { MediaItem, PlaybackData } from './types'
import type { QualityOption } from '@/components/player/types'

export interface PlaybackSession {
  sessionId: string
  mediaId: string
  filePath: string
  method: 'direct' | 'hls'
  streamUrl: string
  qualityLabel?: string
}

const sessions = new Map<string, PlaybackSession>()

export function createSession(
  mediaId: string,
  method: 'direct' | 'hls',
  qualityLabel?: string
): PlaybackSession | null {
  const item = getItemById(mediaId)
  if (!item?.file_path) return null

  const sessionId = crypto.randomUUID()
  const session: PlaybackSession = {
    sessionId,
    mediaId,
    filePath: item.file_path,
    method,
    streamUrl:
      method === 'direct'
        ? `/api/media/stream/${mediaId}?session=${sessionId}`
        : `/api/media/hls/${sessionId}/master.m3u8`,
    qualityLabel,
  }
  sessions.set(sessionId, session)
  return session
}

export function getSession(sessionId: string): PlaybackSession | undefined {
  return sessions.get(sessionId)
}

export function endSession(sessionId: string): void {
  sessions.delete(sessionId)
}

export function buildDirectUrl(mediaId: string): string {
  return `/api/media/stream/${mediaId}`
}

// ---------------------------------------------------------------------------
// Quality tiers for HLS transcoding
// ---------------------------------------------------------------------------

const QUALITY_TIERS = [
  { label: '4K',    height: 2160, width: 3840, bitrate: 40_000_000 },
  { label: '1080p', height: 1080, width: 1920, bitrate: 8_000_000  },
  { label: '720p',  height: 720,  width: 1280, bitrate: 4_000_000  },
  { label: '480p',  height: 480,  width: 854,  bitrate: 2_000_000  },
  { label: '360p',  height: 360,  width: 640,  bitrate: 1_000_000  },
  { label: '240p',  height: 240,  width: 426,  bitrate: 600_000    },
]

// ---------------------------------------------------------------------------
// getNativePlaybackData — full PlaybackData from the native media_items DB
// ---------------------------------------------------------------------------

export async function getNativePlaybackData(
  id: string,
  userId: string
): Promise<PlaybackData> {
  const item = getItemById(id)
  if (!item || !item.file_path) {
    throw new Error(`Media item not found: ${id}`)
  }

  // Probe the file for native resolution and codec info
  let nativeWidth = 0
  let nativeHeight = 0
  let audioStreams: PlaybackData['audioStreams'] = []
  let subtitleStreams: PlaybackData['subtitleStreams'] = []
  let defaultAudioIndex = 0
  let defaultSubtitleIndex = -1

  try {
    const probe = await probeFile(item.file_path)
    nativeWidth = probe.width
    nativeHeight = probe.height

    audioStreams = probe.audioStreams.map(s => ({
      index: s.index,
      language: s.language,
      title: s.title,
      channels: s.channels,
      isDefault: s.isDefault,
    }))

    subtitleStreams = probe.subtitleStreams.map(s => ({
      index: s.index,
      language: s.language,
      title: s.title,
      isDefault: s.isDefault,
    }))

    const defaultAudio = probe.audioStreams.find(s => s.isDefault) ?? probe.audioStreams[0]
    defaultAudioIndex = defaultAudio?.index ?? 0

    const defaultSub = probe.subtitleStreams.find(s => s.isDefault && !s.isForced)
    defaultSubtitleIndex = defaultSub?.index ?? -1
  } catch {
    // Non-fatal: probe failed, streams will be empty
  }

  // Series metadata for episodes
  let seriesTitle: string | undefined
  let seriesId: string | undefined
  let seasonEpisode: string | undefined
  if (item.type === 'episode' && item.series_id) {
    const series = getItemById(item.series_id)
    seriesTitle = series?.title
    seriesId = item.series_id
    if (item.season_number != null && item.episode_number != null) {
      seasonEpisode = `S${String(item.season_number).padStart(2, '0')} E${String(item.episode_number).padStart(2, '0')}`
    }
  }

  // Resume position from watch state
  const watchState = userId ? getWatchState(userId, id) : undefined
  const resumePositionTicks = watchState?.position_ticks ?? 0

  // Stream URLs
  const streamUrl = `/api/media/stream/${id}`
  const hlsTranscodeUrl = `/api/media/hls/${id}/master.m3u8`

  // Direct play option
  const directOption: QualityOption = {
    label: 'Direct Play',
    maxHeight: 0,
    maxWidth: 0,
    bitrate: 0,
    isDirect: true,
    streamUrl,
    isHls: false,
  }

  // Transcoded quality tiers (only below native height)
  const qualityOptions: QualityOption[] = QUALITY_TIERS
    .filter((t) => nativeHeight === 0 || t.height < nativeHeight)
    .map((t) => {
      const url = new URL(hlsTranscodeUrl, 'http://placeholder')
      url.searchParams.set('maxWidth', String(t.width))
      url.searchParams.set('maxHeight', String(t.height))
      url.searchParams.set('bitrate', String(t.bitrate))
      return {
        label: t.label,
        maxHeight: t.height,
        maxWidth: t.width,
        bitrate: t.bitrate,
        isDirect: false,
        streamUrl: url.pathname + '?' + url.searchParams.toString(),
        isHls: true,
      }
    })

  return {
    playSessionId: crypto.randomUUID(),
    streamUrl,
    isHls: false,
    mediaSourceId: id,
    itemId: id,
    subtitleStreams,
    audioStreams,
    defaultAudioIndex,
    defaultSubtitleIndex,
    itemTitle: item.title,
    seriesTitle,
    seriesId,
    seasonEpisode,
    runTimeTicks: item.runtime_ticks ?? 0,
    resumePositionTicks,
    chapters: [],
    nativeWidth,
    nativeHeight,
    hlsTranscodeUrl,
    availableQualities: [directOption, ...qualityOptions],
    progressApiUrl: '/api/media/progress',
    subtitleApiBase: '/api/media/subtitles',
    nextEpisodeApiBase: '/api/media/series',
  }
}
