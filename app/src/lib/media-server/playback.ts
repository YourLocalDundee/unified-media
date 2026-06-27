import crypto from 'crypto'
import { getItemById, getWatchState } from './library'
import { probeFile } from './probe'
import { isAudioDirectPlayable, isImageSubtitleCodec, selectAudioTrack } from './codecs'
import type { MediaItem, PlaybackData } from './types'
import type { QualityOption } from '@/components/player/types'
import { getDb } from '@/lib/db/index'

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
  // Whether the browser can decode the intended audio track from the raw container.
  // Defaults to true so a probe failure does not gratuitously force HLS — the HLS route
  // still probes again and picks the right tier if direct play actually fails.
  let audioDirectPlayable = true

  try {
    const probe = await probeFile(item.file_path)
    nativeWidth = probe.width
    nativeHeight = probe.height

    audioStreams = probe.audioStreams.map((s, relIndex) => ({
      index: s.index,
      relIndex,
      codec: s.codec,
      language: s.language,
      title: s.title,
      channels: s.channels,
      isDefault: s.isDefault,
    }))

    subtitleStreams = probe.subtitleStreams.map(s => ({
      index: s.index,
      codec: s.codec,
      language: s.language,
      title: s.title,
      isDefault: s.isDefault,
      forced: s.isForced,
      // Image-based codecs (PGS/VOBSUB/DVB) cannot be converted to WebVTT — flag them so
      // the player can disable selection rather than offer a track that renders nothing.
      extractable: !isImageSubtitleCodec(s.codec),
    }))

    // The intended track is the one the browser will play on direct play (default, else
    // first) — the same track the transcoder maps. Check that track's codec, not just the
    // first audio stream, so a default commentary/secondary track is handled correctly.
    const { stream: intendedAudio } = selectAudioTrack(probe.audioStreams)
    defaultAudioIndex = intendedAudio?.index ?? 0
    audioDirectPlayable = isAudioDirectPlayable(intendedAudio?.codec ?? null)

    const defaultSub = probe.subtitleStreams.find(s => s.isDefault && !s.isForced)
    defaultSubtitleIndex = defaultSub?.index ?? -1
  } catch {
    // Non-fatal: probe failed, streams will be empty
  }

  // Downloaded subtitle files for this media item (status = 'downloaded' in subtitle_wants).
  // Served at /api/media/subtitles/{id}/{positionalIndex} as WebVTT.
  type RawDlSub = { language: string; forced: number; hi: number }
  const rawDlSubs = item.file_path
    ? (getDb()
        .prepare(
          `SELECT language, forced, hi FROM subtitle_wants
           WHERE media_path = ? AND status = 'downloaded' AND subtitle_path IS NOT NULL
           ORDER BY language, forced, hi`
        )
        .all(item.file_path) as RawDlSub[])
    : []
  const downloadedSubtitles: PlaybackData['downloadedSubtitles'] = rawDlSubs.length > 0
    ? rawDlSubs.map((s, index) => {
        const lang = (s.language ?? 'unk').toUpperCase()
        const tags = [s.forced ? 'Forced' : null, s.hi ? 'HI' : null].filter(Boolean).join(', ')
        return {
          language: s.language ?? '',
          label: tags ? `${lang} (${tags})` : lang,
          index,
          forced: s.forced === 1,
        }
      })
    : undefined

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

  // Stream URLs. HLS is namespaced by the audio-relative index (`aN`) so each audio-track
  // selection gets its own transcode and cache without colliding. The default URL targets
  // the intended track; the player builds `aN` URLs for other tracks when switching audio.
  const defaultAudioRel = audioStreams.find(s => s.index === defaultAudioIndex)?.relIndex ?? 0
  const streamUrl      = `/api/media/stream/${id}`
  const hlsTranscodeUrl = `/api/media/hls/${id}/a${defaultAudioRel}/master.m3u8`

  // Direct play option — always first.
  const directOption: QualityOption = {
    label:     'Direct Play',
    maxHeight: nativeHeight || 0,
    maxWidth:  nativeWidth  || 0,
    bitrate:   0,
    isDirect:  true,
    streamUrl,
    isHls:     false,
  }

  // Single native-resolution HLS option.
  // Resolution is capped at the actual probed dimensions — no upscaling.
  // The transcode endpoint probes the file again and picks the correct tier
  // (remux / audio-only / full VAAPI) independently of these UI labels.
  // If probe failed (nativeHeight=0), the label falls back to 'Native HLS'
  // and the server determines quality from its own probe at request time.
  function nativeLabel(h: number): string {
    if (h >= 2160) return '4K'
    if (h >= 1080) return '1080p'
    if (h >= 720)  return '720p'
    if (h >= 480)  return '480p'
    if (h >  0)    return `${h}p`
    return 'Native'
  }

  const hlsOption: QualityOption = {
    label:     `${nativeLabel(nativeHeight)} HLS`,
    maxHeight: nativeHeight || 1080,
    maxWidth:  nativeWidth  || 1920,
    bitrate:   0,
    isDirect:  false,
    streamUrl: hlsTranscodeUrl,
    isHls:     true,
  }

  // Codec-aware default. When the intended audio track is not browser-decodable from the raw
  // container, naive Direct Play renders video with silent audio (browsers do not fire an
  // error on audio-only decode failure). Default to the HLS path so the transcode layer's
  // audio_transcode tier (Tier B) remuxes the video and re-encodes only the audio to AAC.
  // Direct Play stays in the list as a secondary option but is never the default in this case.
  // Files with compatible audio (e.g. h264 + AAC) keep true Direct Play as the default with no
  // transcode.
  const availableQualities = audioDirectPlayable
    ? [directOption, hlsOption]
    : [hlsOption, directOption]
  const defaultOption = availableQualities[0]

  return {
    playSessionId: crypto.randomUUID(),
    streamUrl: defaultOption.streamUrl,
    isHls: defaultOption.isHls,
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
    availableQualities,
    progressApiUrl: '/api/media/progress',
    subtitleApiBase: '/api/media/subtitles',
    nextEpisodeApiBase: '/api/media/series',
    downloadedSubtitles,
  }
}
