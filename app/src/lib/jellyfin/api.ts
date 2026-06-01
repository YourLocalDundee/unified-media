import { jellyfinFetch, JELLYFIN_URL, JELLYFIN_API_KEY } from './client'
import type {
  JellyfinItem,
  JellyfinItemsResponse,
  PlaybackInfo,
} from './types'

// ---------------------------------------------------------------------------
// Library / browse
// ---------------------------------------------------------------------------

export async function getItems(params: {
  userId: string
  parentId?: string
  includeItemTypes?: string[]
  sortBy?: string
  sortOrder?: 'Ascending' | 'Descending'
  limit?: number
  startIndex?: number
  recursive?: boolean
  fields?: string[]
}): Promise<JellyfinItemsResponse> {
  const {
    userId,
    parentId,
    includeItemTypes,
    sortBy = 'SortName',
    sortOrder = 'Ascending',
    limit = 50,
    startIndex = 0,
    recursive = true,
    fields = [
      'PrimaryImageAspectRatio',
      'BasicSyncInfo',
      'Overview',
      'Genres',
      'Studios',
      'People',
      'UserData',
      'ImageTags',
    ],
  } = params

  const qs = new URLSearchParams({
    SortBy: sortBy,
    SortOrder: sortOrder,
    Limit: String(limit),
    StartIndex: String(startIndex),
    Recursive: String(recursive),
    Fields: fields.join(','),
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Thumb',
  })

  if (parentId) qs.set('ParentId', parentId)
  if (includeItemTypes?.length) qs.set('IncludeItemTypes', includeItemTypes.join(','))

  return jellyfinFetch<JellyfinItemsResponse>(`/Users/${userId}/Items?${qs.toString()}`)
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchItems(params: {
  userId: string
  searchTerm: string
  includeItemTypes?: string[]
  limit?: number
}): Promise<JellyfinItem[]> {
  const {
    userId,
    searchTerm,
    includeItemTypes = ['Movie', 'Series', 'Episode'],
    limit = 24,
  } = params

  const qs = new URLSearchParams({
    SearchTerm: searchTerm,
    Recursive: 'true',
    Limit: String(limit),
    IncludeItemTypes: includeItemTypes.join(','),
    Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,Overview,UserData,ImageTags',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Thumb',
  })

  const result = await jellyfinFetch<JellyfinItemsResponse>(
    `/Users/${userId}/Items?${qs.toString()}`
  )
  return result.Items
}

// ---------------------------------------------------------------------------
// Single item
// ---------------------------------------------------------------------------

export async function getItem(itemId: string, userId: string): Promise<JellyfinItem> {
  return jellyfinFetch<JellyfinItem>(
    `/Users/${userId}/Items/${itemId}?Fields=Overview,Genres,Studios,People,UserData,MediaSources,ImageTags`
  )
}

// ---------------------------------------------------------------------------
// Shows — seasons and episodes
// ---------------------------------------------------------------------------

export async function getSeasons(seriesId: string, userId: string): Promise<JellyfinItem[]> {
  const qs = new URLSearchParams({
    userId,
    Fields: 'Overview,ImageTags',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary',
  })
  const result = await jellyfinFetch<JellyfinItemsResponse>(
    `/Shows/${seriesId}/Seasons?${qs.toString()}`
  )
  return result.Items
}

export async function getEpisodes(
  seriesId: string,
  userId: string,
  seasonId?: string
): Promise<JellyfinItem[]> {
  const qs = new URLSearchParams({
    userId,
    Fields: 'Overview,UserData,ImageTags',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Thumb',
  })
  if (seasonId) qs.set('SeasonId', seasonId)
  const result = await jellyfinFetch<JellyfinItemsResponse>(
    `/Shows/${seriesId}/Episodes?${qs.toString()}`
  )
  return result.Items
}

// ---------------------------------------------------------------------------
// Continue watching (resume)
// ---------------------------------------------------------------------------

export async function getContinueWatching(
  userId: string,
  limit = 12
): Promise<JellyfinItem[]> {
  const qs = new URLSearchParams({
    MediaTypes: 'Video',
    Limit: String(limit),
    Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,UserData,Overview,ImageTags',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Thumb',
  })

  const result = await jellyfinFetch<JellyfinItemsResponse>(
    `/Users/${userId}/Items/Resume?${qs.toString()}`
  )
  return result.Items
}

// ---------------------------------------------------------------------------
// Latest media (recently added)
// ---------------------------------------------------------------------------

export async function getLatestMedia(
  userId: string,
  limit = 16
): Promise<JellyfinItem[]> {
  const qs = new URLSearchParams({
    Limit: String(limit),
    Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,UserData,Overview,ImageTags',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Thumb',
    IsPlayed: 'false',
  })

  return jellyfinFetch<JellyfinItem[]>(
    `/Users/${userId}/Items/Latest?${qs.toString()}`
  )
}

// ---------------------------------------------------------------------------
// Recently watched
// ---------------------------------------------------------------------------

export async function getRecentlyWatched(
  userId: string,
  limit = 12
): Promise<JellyfinItem[]> {
  const qs = new URLSearchParams({
    SortBy: 'DatePlayed',
    SortOrder: 'Descending',
    Filters: 'IsPlayed',
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Episode',
    Limit: String(limit),
    Fields: 'PrimaryImageAspectRatio,BasicSyncInfo,UserData,Overview,ImageTags',
    ImageTypeLimit: '1',
    EnableImageTypes: 'Primary,Backdrop,Thumb',
  })

  const result = await jellyfinFetch<JellyfinItemsResponse>(
    `/Users/${userId}/Items?${qs.toString()}`
  )
  return result.Items
}

// ---------------------------------------------------------------------------
// Playback info
// ---------------------------------------------------------------------------

const DEVICE_PROFILE = {
  DirectPlayProfiles: [
    {
      Type: 'Video',
      Container: 'mp4,mkv,webm,m4v',
      VideoCodec: 'h264,vp8,vp9,av1',
      AudioCodec: 'aac,mp3,opus,vorbis,ac3,eac3,flac',
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
      MaxAudioChannels: '2',
      MinSegments: '2',
      BreakOnNonKeyFrames: true,
    },
  ],
  SubtitleProfiles: [
    { Format: 'vtt', Method: 'External' },
    { Format: 'ass', Method: 'External' },
    { Format: 'ssa', Method: 'External' },
    { Format: 'srt', Method: 'External' },
  ],
}

export async function getPlaybackInfo(
  itemId: string,
  userId: string
): Promise<PlaybackInfo> {
  return jellyfinFetch<PlaybackInfo>(`/Items/${itemId}/PlaybackInfo`, {
    method: 'POST',
    body: JSON.stringify({
      UserId: userId,
      DeviceProfile: DEVICE_PROFILE,
      AutoOpenLiveStream: true,
      IsPlayback: true,
      MediaSourceId: itemId,
    }),
  })
}

// ---------------------------------------------------------------------------
// Image URL helpers
// ---------------------------------------------------------------------------

export function getImageUrl(
  itemId: string,
  imageType: 'Primary' | 'Backdrop' | 'Thumb',
  params?: { width?: number; quality?: number; index?: number }
): string {
  const { width, quality = 90, index } = params ?? {}

  const qs = new URLSearchParams({ quality: String(quality) })
  if (width) qs.set('fillWidth', String(width))
  // Add api key so image URLs work without separate auth headers (e.g., <img src>)
  if (JELLYFIN_API_KEY) qs.set('ApiKey', JELLYFIN_API_KEY)

  const indexSegment = index !== undefined ? `/${index}` : ''
  return `${JELLYFIN_URL}/Items/${itemId}/Images/${imageType}${indexSegment}?${qs.toString()}`
}

// ---------------------------------------------------------------------------
// Stream URL helpers
// ---------------------------------------------------------------------------

/**
 * Build an HLS stream URL for direct stream playback.
 * Uses the /Videos/{id}/stream endpoint with Static=true for direct-stream,
 * or uses the server-provided TranscodingUrl for transcoded content.
 *
 * For most cases, prefer using the TranscodingUrl from PlaybackInfo directly
 * (prefix with JELLYFIN_URL if it's a relative path).
 */
export function getStreamUrl(
  itemId: string,
  mediaSourceId: string,
  playSessionId: string,
  startTicks?: number
): string {
  const qs = new URLSearchParams({
    Static: 'true',
    mediaSourceId,
    deviceId: 'unified-frontend-01',
    api_key: JELLYFIN_API_KEY,
    PlaySessionId: playSessionId,
  })

  if (startTicks !== undefined && startTicks > 0) {
    qs.set('StartTimeTicks', String(startTicks))
  }

  return `${JELLYFIN_URL}/Videos/${itemId}/stream?${qs.toString()}`
}

// ---------------------------------------------------------------------------
// Playback reporting
// ---------------------------------------------------------------------------

export async function reportPlaybackStart(payload: {
  userId: string
  itemId: string
  sessionId: string
}): Promise<void> {
  await jellyfinFetch<void>('/Sessions/Playing', {
    method: 'POST',
    body: JSON.stringify({
      ItemId: payload.itemId,
      PlaySessionId: payload.sessionId,
      PositionTicks: 0,
      IsPaused: false,
      IsMuted: false,
      PlayMethod: 'Transcode',
      MediaSourceId: payload.itemId,
    }),
  })
}

export async function reportPlaybackProgress(payload: {
  userId: string
  itemId: string
  sessionId: string
  positionTicks: number
  isPaused: boolean
}): Promise<void> {
  await jellyfinFetch<void>('/Sessions/Playing/Progress', {
    method: 'POST',
    body: JSON.stringify({
      ItemId: payload.itemId,
      PlaySessionId: payload.sessionId,
      PositionTicks: payload.positionTicks,
      IsPaused: payload.isPaused,
      IsMuted: false,
      PlayMethod: 'Transcode',
      MediaSourceId: payload.itemId,
    }),
  })
}

export async function reportPlaybackStopped(payload: {
  userId: string
  itemId: string
  sessionId: string
  positionTicks: number
}): Promise<void> {
  await jellyfinFetch<void>('/Sessions/Playing/Stopped', {
    method: 'POST',
    body: JSON.stringify({
      ItemId: payload.itemId,
      PlaySessionId: payload.sessionId,
      PositionTicks: payload.positionTicks,
      MediaSourceId: payload.itemId,
    }),
  })
}
