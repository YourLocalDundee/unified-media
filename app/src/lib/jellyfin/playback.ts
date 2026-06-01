import { jellyfinFetch } from '@/lib/jellyfin/client'
import type { PlaybackInfo, MediaSource, MediaStream } from '@/lib/jellyfin/types'
import type { QualityOption } from '@/components/player/types'
import type { PlaybackData } from '@/lib/media-server/types'

export type { PlaybackData }

interface ItemMetadata {
  Name: string
  SeriesName?: string
  SeriesId?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  Type: string
  RunTimeTicks?: number
  UserData?: { PlaybackPositionTicks: number }
  Chapters?: Array<{ Name?: string; StartPositionTicks?: number }>
}

const QUALITY_TIERS = [
  { label: '4K',    height: 2160, width: 3840, bitrate: 40_000_000 },
  { label: '1080p', height: 1080, width: 1920, bitrate: 8_000_000  },
  { label: '720p',  height: 720,  width: 1280, bitrate: 4_000_000  },
  { label: '480p',  height: 480,  width: 854,  bitrate: 2_000_000  },
  { label: '360p',  height: 360,  width: 640,  bitrate: 1_000_000  },
  { label: '240p',  height: 240,  width: 426,  bitrate: 600_000    },
]

export async function getPlaybackData(id: string): Promise<PlaybackData> {
  const userId = process.env.JELLYFIN_USER_ID ?? ''

  const deviceProfile = {
    Name: 'UnifiedMedia Web',
    MaxStreamingBitrate: 140000000,
    DirectPlayProfiles: [
      {
        Type: 'Video',
        Container: 'mp4',
        VideoCodec: 'h264,h265,hevc,vp8,vp9,av1',
        AudioCodec: 'aac,mp3,ac3,eac3,opus,flac,vorbis,dts',
      },
      {
        Type: 'Video',
        Container: 'webm',
        VideoCodec: 'vp8,vp9,av1',
        AudioCodec: 'vorbis,opus',
      },
    ],
    TranscodingProfiles: [
      {
        Type: 'Video',
        Context: 'Streaming',
        Protocol: 'hls',
        Container: 'ts',
        VideoCodec: 'h264',
        AudioCodec: 'aac',
        MaxAudioChannels: '6',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'srt', Method: 'External' },
    ],
    ResponseProfiles: [
      { Type: 'Video', Container: 'mp4', MimeType: 'video/mp4' },
    ],
  }

  const info = await jellyfinFetch<PlaybackInfo>(`/Items/${id}/PlaybackInfo`, {
    method: 'POST',
    body: JSON.stringify({
      DeviceProfile: deviceProfile,
      UserId: userId,
      StartTimeTicks: 0,
      AutoOpenLiveStream: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
    }),
  })

  const source: MediaSource | undefined = info.MediaSources?.[0]
  if (!source) {
    throw new Error('No media sources')
  }

  const streams: MediaStream[] = source.MediaStreams ?? []

  const videoStream = streams.find((s) => s.Type === 'Video')
  const nativeWidth = videoStream?.Width ?? 0
  const nativeHeight = videoStream?.Height ?? 0

  let streamUrl: string
  let isHls = false

  if (source.TranscodingUrl) {
    const rawPath = source.TranscodingUrl.startsWith('/')
      ? source.TranscodingUrl
      : '/' + source.TranscodingUrl
    const [pathPart, queryPart] = rawPath.split('?')
    const cleanQuery = queryPart
      ? '?' + queryPart.replace(/(?:^|&)api_key=[^&]*/g, '').replace(/^&/, '')
      : ''
    streamUrl = `/api/jellyfin/stream${pathPart}${cleanQuery}`
    isHls = rawPath.includes('.m3u8') || source.TranscodingSubProtocol === 'hls'
  } else {
    const qs = new URLSearchParams({
      Static: 'true',
      mediaSourceId: source.Id,
      deviceId: 'unified-frontend',
      PlaySessionId: info.PlaySessionId,
    })
    if (source.ETag) qs.set('Tag', source.ETag)
    streamUrl = `/api/jellyfin/stream/Videos/${id}/stream.mp4?${qs.toString()}`
    isHls = false
  }

  let hlsTranscodeUrl: string
  if (isHls) {
    hlsTranscodeUrl = streamUrl
  } else {
    const hlsQs = new URLSearchParams({
      DeviceId: 'unified-frontend',
      MediaSourceId: source.Id,
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      MaxAudioChannels: '6',
      MinSegments: '1',
      BreakOnNonKeyFrames: 'true',
    })
    hlsTranscodeUrl = `/api/jellyfin/stream/Videos/${id}/master.m3u8?${hlsQs.toString()}`
  }

  const directOption: QualityOption = {
    label: isHls ? 'Auto' : 'Direct Play',
    maxHeight: 0,
    maxWidth: 0,
    bitrate: 0,
    isDirect: true,
    streamUrl,
    isHls,
  }

  const qualityOptions: QualityOption[] = QUALITY_TIERS
    .filter((t) => nativeHeight === 0 || t.height < nativeHeight)
    .map((t) => {
      const url = new URL(hlsTranscodeUrl, 'http://placeholder')
      url.searchParams.set('MaxWidth', String(t.width))
      url.searchParams.set('MaxHeight', String(t.height))
      url.searchParams.set('VideoBitrate', String(t.bitrate))
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

  const availableQualities: QualityOption[] = [directOption, ...qualityOptions]

  const subtitleStreams = streams
    .filter((s) => s.Type === 'Subtitle')
    .map((s) => ({
      index: s.Index,
      language: s.Language ?? 'Unknown',
      title: s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`,
      isDefault: s.IsDefault ?? false,
    }))
  const audioStreams = streams
    .filter((s) => s.Type === 'Audio')
    .map((s) => ({
      index: s.Index,
      language: s.Language ?? 'Unknown',
      title: s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`,
      channels: s.Channels ?? 2,
      isDefault: s.IsDefault ?? false,
    }))

  const item = await jellyfinFetch<ItemMetadata>(
    `/Users/${userId}/Items/${id}?Fields=UserData`
  )

  const seasonEpisode =
    item.ParentIndexNumber != null && item.IndexNumber != null
      ? `S${item.ParentIndexNumber} E${item.IndexNumber}`
      : undefined

  const chaptersRaw = (item as { Chapters?: Array<{ Name?: string; StartPositionTicks?: number }> }).Chapters ?? []
  const chapters = chaptersRaw.map((c) => ({
    name: c.Name ?? 'Chapter',
    startPositionTicks: c.StartPositionTicks ?? 0,
  }))

  return {
    playSessionId: info.PlaySessionId,
    streamUrl,
    isHls,
    mediaSourceId: source.Id,
    itemId: id,
    subtitleStreams,
    audioStreams,
    defaultAudioIndex: source.DefaultAudioStreamIndex ?? -1,
    defaultSubtitleIndex: source.DefaultSubtitleStreamIndex ?? -1,
    itemTitle: item.Name,
    seriesTitle: item.SeriesName,
    seriesId: item.SeriesId,
    seasonEpisode,
    runTimeTicks: item.RunTimeTicks ?? 0,
    resumePositionTicks: item.UserData?.PlaybackPositionTicks ?? 0,
    chapters,
    nativeWidth,
    nativeHeight,
    hlsTranscodeUrl,
    availableQualities,
  }
}
