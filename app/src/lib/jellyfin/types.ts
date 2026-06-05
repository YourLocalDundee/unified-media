// TypeScript shapes for the Jellyfin HTTP API.
// Field names use Jellyfin's PascalCase convention as returned in JSON — no
// adapter mapping. PlaybackPositionTicks is in 10,000ths of a second (100ns units).
// Used by client.ts, api.ts, and playback.ts (all server-only).

export interface JellyfinUserData {
  IsFavorite: boolean
  PlayCount: number
  PlaybackPositionTicks: number
  Played: boolean
  LastPlayedDate?: string
  UnplayedItemCount?: number
  Key?: string
}

// JellyfinItem covers every media type returned by /Users/{id}/Items.
// All image-related fields (ImageTags, BackdropImageTags, Parent*) are optional
// because episodes and albums often lack their own images and fall back to the
// parent's image — see getImageUrl in api.ts for the fallback chain logic.
export interface JellyfinItem {
  Id: string
  Name: string
  Type: string // 'Movie' | 'Series' | 'Episode' | 'Season' | 'MusicAlbum' | 'Audio' | 'Photo' | etc.
  ServerId: string
  ImageBlurHashes?: Record<string, Record<string, string>>
  ImageTags?: Record<string, string>
  PrimaryImageTag?: string
  BackdropImageTags?: string[]
  Overview?: string
  ProductionYear?: number
  RunTimeTicks?: number
  CommunityRating?: number
  OfficialRating?: string
  Genres?: string[]
  UserData?: JellyfinUserData
  // Episode-specific
  IndexNumber?: number
  ParentIndexNumber?: number
  SeriesName?: string
  SeriesId?: string
  SeasonId?: string
  // Series-specific
  Status?: string
  // Image fallback tags
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  SeriesPrimaryImageTag?: string
  AlbumId?: string
  AlbumPrimaryImageTag?: string
}

export interface JellyfinItemsResponse {
  Items: JellyfinItem[]
  TotalRecordCount: number
  StartIndex: number
}

export interface JellyfinUser {
  Id: string
  Name: string
  ServerId: string
}

export interface JellyfinAuthResult {
  AccessToken: string
  User: JellyfinUser
  ServerId: string
}

export type PlaybackSource = 'DirectPlay' | 'DirectStream' | 'Transcode'

export interface MediaStream {
  Codec?: string
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage' | 'Data'
  DisplayTitle?: string
  IsExternal?: boolean
  Index: number
  IsDefault?: boolean
  Language?: string
  DeliveryUrl?: string
  DeliveryMethod?: 'External' | 'Embed' | 'Encode'
  IsForced?: boolean
  Height?: number
  Width?: number
  BitRate?: number
  SampleRate?: number
  Channels?: number
  PixelFormat?: string
  ColorSpace?: string
  VideoRange?: string
}

// MediaSource is the top-level container returned by /Items/{id}/PlaybackInfo.
// There is usually one source per item, but re-encodes or multi-version libraries
// can return several. Only MediaSources[0] is used by getPlaybackData().
export interface MediaSource {
  Id: string
  Path?: string
  Container?: string
  TranscodingUrl?: string
  TranscodingSubProtocol?: string
  TranscodingContainer?: string
  DirectStreamUrl?: string
  SupportsDirectPlay: boolean
  SupportsDirectStream: boolean
  SupportsTranscoding: boolean
  MediaStreams?: MediaStream[]
  DefaultAudioStreamIndex?: number
  DefaultSubtitleStreamIndex?: number
  Bitrate?: number
  Size?: number
  RunTimeTicks?: number
  LiveStreamId?: string
  Name?: string
  Type?: string
  Protocol?: string
  ETag?: string
  ReadAtNativeFramerate?: boolean
  IsInfiniteStream?: boolean
  HasMixedProtocols?: boolean
}

export interface PlaybackInfo {
  MediaSources: MediaSource[]
  PlaySessionId: string
}

export interface JellyfinSeason {
  Id: string
  Name: string
  IndexNumber?: number
  Overview?: string
  PrimaryImageAspectRatio?: number
  ImageTags?: { Primary?: string }
  UserData?: { Played: boolean; UnplayedItemCount: number }
}

export interface JellyfinEpisode {
  Id: string
  Name: string
  IndexNumber?: number
  ParentIndexNumber?: number
  Overview?: string
  RunTimeTicks?: number
  PremiereDate?: string
  ImageTags?: { Primary?: string; Thumb?: string }
  UserData?: {
    Played: boolean
    PlaybackPositionTicks: number
    PlayCount: number
  }
  SeriesId: string
  SeasonId: string
}
