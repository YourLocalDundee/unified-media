# Independence Roadmap

> **ARCHIVED (2026-06-28).** Point-in-time planning record. The independence build shipped and
> unified-media is now fully native (zero Jellyfin dependency). Kept for historical context; not a
> description of current state. See `docs/complete/FEATURES.md` for what shipped.

**Goal:** Replace Jellyfin, Sonarr, Radarr, Prowlarr, Bazarr, and (optionally) qBittorrent with services built inside or alongside the unified-frontend monorepo using TypeScript/Node.js. This document is the full API reference and build plan.

---

## Table of Contents

1. [Current Service Map](#1-current-service-map)
2. [Jellyfin API Reference](#2-jellyfin-api-reference)
3. [Seerr + *arr API Reference](#3-seerr--arr-api-reference)
4. [qBittorrent + Download Ecosystem API Reference](#4-qbittorrent--download-ecosystem-api-reference)
5. [Storage & Compute Estimates](#5-storage--compute-estimates)
6. [Independence Build Plan](#6-independence-build-plan)

---

## 1. Current Service Map

| Service | Role | Internal Address | Auth |
|---|---|---|---|
| Jellyfin | Media server, streaming, metadata | `http://192.168.0.50:8096` | `X-Emby-Authorization` MediaBrowser token |
| Seerr | Media request UI, TMDB search, approval workflow | `http://seerr:5055` | `X-API-Key` header |
| Sonarr | TV show monitoring + download dispatch | `http://192.168.0.50:8989` | `X-Api-Key` header |
| Radarr | Movie monitoring + download dispatch | `http://192.168.0.50:7878` | `X-Api-Key` header |
| Prowlarr | Indexer aggregation, Torznab proxy | `http://192.168.0.50:9696` | `X-Api-Key` header |
| Bazarr | Subtitle download + sync | `http://192.168.0.50:6767` | `X-Api-Key` header |
| qBittorrent | Download client | `http://qbittorrent:8080` | Cookie session (SID) |

---

## 2. Jellyfin API Reference

### 2.1 Authentication

All requests use the `X-Emby-Authorization` header:

```
MediaBrowser Client="unified-frontend", Device="unified-frontend", DeviceId="unified-frontend-1", Version="1.0.0", Token="<api_token>"
```

Generate the token from **Jellyfin Dashboard → API Keys → New API Key**. Store as `JELLYFIN_API_KEY` env var.

Get the admin user ID (needed for `/Users/<id>/...` endpoints):

```http
GET /Users/Me
X-Emby-Authorization: MediaBrowser Token="<token>"
→ { Id: "uuid", Name: "admin", ... }
```

### 2.2 Library & Items

```http
GET /Users/{userId}/Views
→ { Items: [{ Id, Name, CollectionType }] }
  CollectionType: "movies" | "tvshows" | "music" | "books"

GET /Users/{userId}/Items
  ?ParentId={libraryId}
  &SortBy=SortName
  &SortOrder=Ascending
  &IncludeItemTypes=Movie,Series
  &Recursive=true
  &StartIndex=0
  &Limit=50
  &Fields=Overview,Genres,Studios,ProviderIds,MediaSources
→ { Items: Item[], TotalRecordCount: N }

GET /Users/{userId}/Items/{itemId}
→ Full item with all metadata, media sources, chapters, subtitle streams

GET /Users/{userId}/Items/Resume
  ?Limit=12
  &MediaTypes=Video
→ Continue-watching items with UserData.PlaybackPositionTicks

GET /Users/{userId}/Items/Latest
  ?ParentId={libraryId}
  &Limit=16
  &Fields=Overview,Genres
→ Most recently added items (not resume, newest in library)

GET /Users/{userId}/Items
  ?SearchTerm={query}
  &Recursive=true
  &IncludeItemTypes=Movie,Series,Episode
→ Library search results

GET /Items/{itemId}/Images/Primary
  ?Width=400
  &Quality=90
  [&Tag={imageTag}]
→ Binary image (JPEG/PNG); no auth required if server is configured for public images
  (use the proxy route /api/jellyfin/Items/{id}/Images/... to inject auth)

GET /Items/{itemId}/Images/{imageType}
  imageType: Primary | Backdrop | Thumb | Logo | Banner | Art | Disc | Screenshot
```

### 2.3 Streaming & Playback

```http
POST /Items/{itemId}/PlaybackInfo
Body: {
  UserId: "{userId}",
  MaxStreamingBitrate: 140000000,
  DeviceProfile: { ... }
}
→ {
    MediaSources: [{
      Id, Path, Container, Size, Bitrate,
      VideoType: "VideoFile" | "Dvd" | "BluRay",
      IsRemote: false,
      SupportsDirectPlay: true,
      SupportsDirectStream: true,
      SupportsTranscoding: true,
      TranscodingUrl: "/videos/{itemId}/master.m3u8?...",
      MediaStreams: [
        { Type: "Video", Width, Height, Codec, Profile, Level, BitRate, AverageFrameRate },
        { Type: "Audio", Codec, Channels, SampleRate, BitRate, Language, DisplayTitle },
        { Type: "Subtitle", Language, DisplayTitle, IsExternal, DeliveryUrl, Codec }
      ]
    }]
  }

# Direct play (browser-native formats)
GET /Videos/{itemId}/stream
  ?api_key={token}
  &static=true
  &MediaSourceId={sourceId}

# HLS transcoded stream
GET /Videos/{itemId}/master.m3u8
  ?api_key={token}
  &MediaSourceId={sourceId}
  &VideoCodec=h264
  &AudioCodec=aac
  &MaxWidth=1920
  &MaxHeight=1080
  &VideoBitrate=8000000
  &AudioBitrate=384000
  &PlaySessionId={uuid}

# Subtitle delivery (external tracks)
GET /Videos/{itemId}/{mediaSourceId}/Subtitles/{subtitleIndex}/Stream.vtt
  ?api_key={token}
→ VTT file ready for <track> element

# Progress reporting (required for resume to work)
POST /Sessions/Playing
Body: {
  ItemId: "{itemId}",
  MediaSourceId: "{sourceId}",
  PlayMethod: "DirectPlay" | "DirectStream" | "Transcode",
  PositionTicks: 0
}

POST /Sessions/Playing/Progress
Body: { ItemId, PositionTicks, IsPaused, IsMuted, PlayMethod }

POST /Sessions/Playing/Stopped
Body: { ItemId, MediaSourceId, PositionTicks }
```

### 2.4 Metadata & Chapters

```http
GET /Items/{itemId}
  ?Fields=Chapters,People,Studios,Genres,ProviderIds,MediaSources,Overview
→ Item with Chapters: [{ StartPositionTicks, Name, ImageTag }]

GET /Items/{itemId}/Images/Chapter
  ?Width=320
  &Index={chapterIndex}
→ Chapter thumbnail image

# ProviderIds contains:
{ Imdb: "tt1234567", Tmdb: "12345", Tvdb: "98765" }
```

### 2.5 User Management (Admin)

```http
GET /Users
→ User[] (requires admin token)

GET /Users/{userId}
→ Full user object with policy

POST /Users/New
Body: { Name, Password }

POST /Users/{userId}/Password
Body: { CurrentPw, NewPw }

DELETE /Users/{userId}

GET /Users/{userId}/Items/{itemId}/UserData
→ { PlaybackPositionTicks, PlayCount, IsFavorite, Played, LastPlayedDate }

POST /Users/{userId}/PlayedItems/{itemId}
→ Mark as watched

DELETE /Users/{userId}/PlayedItems/{itemId}
→ Mark as unwatched

POST /Users/{userId}/FavoriteItems/{itemId}
DELETE /Users/{userId}/FavoriteItems/{itemId}
```

### 2.6 System & Sessions

```http
GET /System/Info
→ { Version, LocalAddress, OperatingSystem, SupportsLibraryMonitor, ... }

GET /Sessions
→ Session[] (all active sessions, admin only)

GET /Library/VirtualFolders
→ VirtualFolder[] (library paths and types)

POST /Library/Refresh
→ Trigger full library scan

POST /Items/{itemId}/Refresh
  ?ReplaceAllMetadata=false
  &ReplaceAllImages=false
→ Refresh metadata for a single item
```

### 2.7 App-Specific Call Inventory

| Feature | Endpoint |
|---|---|
| Home: continue watching | `GET /Users/{id}/Items/Resume?Limit=12&MediaTypes=Video` |
| Home: recently added | `GET /Users/{id}/Items/Latest?ParentId={libId}&Limit=16` |
| Browse library | `GET /Users/{id}/Items?ParentId={libId}&SortBy=SortName` |
| Detail page | `GET /Users/{id}/Items/{itemId}?Fields=Chapters,MediaSources,...` |
| Poster image | `GET /Items/{id}/Images/Primary?Width=400` |
| Backdrop image | `GET /Items/{id}/Images/Backdrop?Width=1920` |
| Start playback | `POST /Items/{id}/PlaybackInfo` |
| HLS stream | `GET /Videos/{id}/master.m3u8?...` |
| Subtitle track | `GET /Videos/{id}/{sourceId}/Subtitles/{idx}/Stream.vtt` |
| Report progress | `POST /Sessions/Playing/Progress` |
| Report stopped | `POST /Sessions/Playing/Stopped` |
| Library search | `GET /Users/{id}/Items?SearchTerm={q}&Recursive=true` |

---

## 3. Seerr + *arr API Reference

### 3.1 Seerr

Base: `http://seerr:5055/api/v1` | Auth: `X-API-Key: {SEERR_API_KEY}`

#### Auth & Users

```http
GET /auth/me
→ { id, email, username, plexUsername, userType, permissions, avatar, ... }

GET /user?take=25&skip=0
→ { results: User[], pageInfo: { ... } }

GET /user/{userId}
→ Full user profile

GET /user/{userId}/requests?take=20&skip=0
→ Request[] for that user

POST /user/{userId}/settings
Body: { notificationTypes: { email: N, discord: N, ... }, discordId, ... }
```

#### Search

```http
GET /search
  ?query={q}
  &page=1
  &language=en
→ {
    results: SearchResult[],
    totalResults: N, page: 1, totalPages: N
  }

SearchResult has:
  mediaType: "movie" | "tv" | "person"
  id, name/title, overview, releaseDate/firstAirDate
  posterPath, backdropPath (TMDB paths, not full URLs)
  mediaInfo?: { status, downloadStatus, downloadStatus4k, ... }
```

#### Media Requests

```http
GET /request
  ?take=20&skip=0
  &filter=all|approved|processing|pending|unavailable|failed|completed|available|deleted
  &sort=added|modified
→ { results: MediaRequest[], pageInfo: { ... } }

POST /request
Body: {
  mediaType: "movie" | "tv",
  mediaId: 12345,         // TMDB ID
  seasons?: [1, 2, 3],   // TV only: season numbers, or "all"
  is4k?: false,
  serverId?: 0,           // Radarr/Sonarr server index
  profileId?: 1,          // Quality profile ID
  rootFolder?: "/media/movies",
  languageProfileId?: 1,
  userId?: 1              // Admin creating on behalf of user
}
→ MediaRequest | { message: "Request already exists" }

POST /request/{requestId}/approve
POST /request/{requestId}/decline
Body: { declineReason?: "string" }
DELETE /request/{requestId}

POST /request/{requestId}/retry
→ Retry a failed request
```

#### Media Status

```http
GET /media
  ?take=20&skip=0
  &filter=available|processing|pending|unavailable|failed|deleted
  &sort=added|modified
→ { results: Media[], pageInfo: { ... } }

GET /movie/{tmdbId}
→ {
    ...TMDB data,
    mediaInfo: {
      status: 0-5,
      // 0=Unknown 1=Pending 2=Processing 3=PartiallyAvailable 4=Available 5=Unknown
      downloadStatus: DownloadingMedia[],
      requests: MediaRequest[]
    }
  }

GET /tv/{tmdbId}
→ {
    ...TMDB data,
    seasons: [{ seasonNumber, episodeCount, airDate, ... }],
    mediaInfo: { status, seasons: [{ status, episodeCount }], requests: [] }
  }
```

#### Discover

```http
GET /discover/movies?page=1&language=en&genre=28
GET /discover/tv?page=1&language=en&genre=18
GET /discover/movies/upcoming?page=1
GET /discover/movies/popular?page=1
GET /discover/tv/popular?page=1

GET /discover/trending
→ { results: (Movie|TV)[] }
```

#### Settings (Admin)

```http
GET /settings/main
→ { apiKey, applicationTitle, applicationUrl, ... }

GET /settings/radarr
→ RadarrSettings[] (array of configured servers)

GET /settings/sonarr
→ SonarrSettings[]

POST /settings/radarr
Body: { name, hostname, port, apiKey, useSsl, baseUrl, activeProfileId, activeDirectory, ... }

POST /settings/radarr/{serverId}/test
→ Tests connection to Radarr server

GET /settings/notifications
→ { agents: { email: { enabled, options: { ... } }, discord: { ... }, ... } }

GET /settings/jobs
→ Job[] (cron jobs: availability sync, plex sync, etc.)

POST /settings/jobs/{jobId}/run
→ Manually trigger a job
```

#### Issues & Watchlist

```http
POST /issue
Body: { mediaId, mediaType, issueType, message }
issueType: 1=Video 2=Audio 3=Subtitles 4=Other

GET /issue?take=10&skip=0&filter=open|resolved

POST /issue/{issueId}/comment
Body: { message: "string" }

POST /issue/{issueId}/resolved
POST /issue/{issueId}/reopen

GET /watchlist
  ?take=20&skip=0
→ { results: WatchlistItem[], pageInfo }

POST /watchlist/{tmdbId}
Body: { mediaType: "movie" | "tv" }
DELETE /watchlist/{tmdbId}
```

### 3.2 Sonarr v3 API

Base: `http://192.168.0.50:8989/api/v3` | Auth: `X-Api-Key: {SONARR_API_KEY}`

```http
GET /series
→ Series[] (all monitored/unmonitored shows)

GET /series/{id}
→ Full series with seasons array

POST /series
Body: { tvdbId, title, qualityProfileId, languageProfileId, path, monitored, addOptions: { monitor, searchForMissingEpisodes } }

PUT /series/{id}
Body: { ...full series object with changes }

DELETE /series/{id}?deleteFiles=false

GET /episode?seriesId={id}
→ Episode[] for a series

GET /episodefile?seriesId={id}
→ EpisodeFile[] (physical files on disk)

DELETE /episodefile/{id}

POST /command
Body: { name: "RescanSeries" | "RefreshSeries" | "SeriesSearch" | "EpisodeSearch", seriesId?: N, episodeIds?: [N] }
→ Returns command object with id; poll GET /command/{id} for status

GET /queue
  ?includeUnknownSeriesItems=false
  &includeSeries=false
  &includeEpisode=false
→ { records: QueueItem[], totalRecords: N }

DELETE /queue/{id}?blocklist=false&removeFromClient=true

GET /qualityprofile
→ QualityProfile[]

GET /languageprofile
→ LanguageProfile[]

GET /rootfolder
→ RootFolder[] (configured media paths with free space)

GET /history?seriesId={id}&episodeId={id}&eventType=1&includeEpisode=false
eventType: 1=Grabbed 2=SeriesFolderImported 3=EpisodeFileImported 4=DownloadFailed 5=EpisodeFileDeleted 6=EpisodeFileRenamed

GET /wanted/missing?sortKey=airsDateUtc&sortDir=desc&page=1&pageSize=20
→ Missing episodes

GET /system/status
→ { version, buildTime, isWindows, isDotNet, ... }

GET /health
→ HealthCheck[] (any current issues)

GET /log/file
→ Links to log files

# Indexer management (mirrors Prowlarr sync)
GET /indexer
PUT /indexer/{id}
DELETE /indexer/{id}
```

### 3.3 Radarr v3 API

Base: `http://192.168.0.50:7878/api/v3` | Auth: `X-Api-Key: {RADARR_API_KEY}`

```http
GET /movie
→ Movie[] (all movies in library)

GET /movie/{id}
→ Full movie with file info

GET /movie/lookup
  ?term={"tmdb:12345" | "imdb:tt1234567" | "title year"}
→ Movie[] (from TMDB, not yet in library)

POST /movie
Body: { tmdbId, title, year, qualityProfileId, path, monitored, minimumAvailability, addOptions: { searchForMovie: true } }

PUT /movie/{id}
DELETE /movie/{id}?deleteFiles=false

POST /command
Body: {
  name: "RefreshMovie" | "RescanMovie" | "MoviesSearch" | "RenameMovie",
  movieIds?: [N]
}

GET /queue?includeMovie=true&includeUnknownMovieItems=false
→ { records: QueueItem[], totalRecords: N }
DELETE /queue/{id}?blocklist=false&removeFromClient=true

GET /qualityprofile
GET /rootfolder
GET /history?movieId={id}&eventType=1
GET /wanted/missing?monitored=true&sortKey=physicalRelease&sortDir=desc&page=1&pageSize=20
GET /wanted/cutoff?monitored=true&page=1&pageSize=20
GET /movie/{id}/history
GET /system/status
GET /health
```

### 3.4 Prowlarr v1 API

Base: `http://192.168.0.50:9696/api/v1` | Auth: `X-Api-Key: {PROWLARR_API_KEY}`

```http
GET /indexer
→ Indexer[] (all configured indexers with health, categories)

GET /indexer/{id}
PUT /indexer/{id}
DELETE /indexer/{id}

POST /indexer/test
Body: { id: N }

POST /indexer/testall
→ Test all indexers

GET /search
  ?query={q}
  &indexerIds=[1,2,3]
  &categories=[2000,5000]
  &type=search|tvsearch|moviesearch|music
→ SearchResult[] (unified results across all indexers)

GET /indexerstats
→ { indexers: [{ indexerId, averageResponseTime, numberOfQueries, numberOfGrabs, ... }], userAgents: [] }

GET /history
  ?page=1&pageSize=10&sortKey=date&sortDir=desc
  &eventType=1
→ History[] (grab events)

GET /tag
GET /downloadclient
GET /notification

GET /system/status
GET /system/task
GET /health
```

### 3.5 Bazarr API

Base: `http://192.168.0.50:6767/api` | Auth: `X-Api-Key: {BAZARR_API_KEY}`

```http
GET /movies
  ?radarrId={id}
→ Movie[] with subtitle status

GET /episodes
  ?seriesId={sonarrId}
→ Episode[] with subtitle status per episode

GET /subtitles
  ?radarrId={movieId}
  &type=movie|series
→ Current subtitle files

GET /providers
→ Provider[] (enabled subtitle providers, health status)

GET /providers/movies
  ?radarrid={id}
→ Search results from all providers for this movie

GET /providers/episodes
  ?episodeid={id}
→ Search results for this episode

POST /subtitles/movies
Body: { radarrid: "{id}", hi: false, forced: false, language: "en", provider: "opensubtitles", ... }
→ Download a specific subtitle

POST /subtitles/episodes
Body: { episodeid: "{id}", hi: false, forced: false, language: "en", ... }

POST /movies/action
Body: { action: "scan-disk" | "search-missing" | "delete-wanted", radarrid: "{id}" }

POST /series/action
Body: { action: "scan-disk" | "search-missing" | "delete-wanted", seriesid: "{id}" }

GET /system/status
→ { bazarr_version, python_version, bazarr_directory, bazarr_config_directory }

GET /system/health
→ Issue[]
```

---

## 4. qBittorrent + Download Ecosystem API Reference

### 4.1 qBittorrent Web API v2

Base: `http://qbittorrent:8080/api/v2` | All state-mutating requests: `application/x-www-form-urlencoded`

#### Auth

```http
POST /auth/login
Content-Type: application/x-www-form-urlencoded
username=admin&password=secret
→ Set-Cookie: SID=...  (v4)  |  QBT_SID_8080=...  (v5)

POST /auth/logout
→ Clears session
```

Session management: auto-login with ~25-minute TTL, retry on 403.

#### Torrents — Read

```http
GET /torrents/info?filter=all|downloading|seeding|completed|active|paused|stopped
  [&category=Movies]
  [&tag=4K]
  [&hashes=hash1|hash2]
→ QbtTorrent[] (44 fields: hash, name, state, progress, dlspeed, upspeed, size, ratio,
                eta, category, tags, save_path, magnet_uri, infohash_v1, etc.)

QbtTorrentState values:
  error, missingFiles, uploading, pausedUP, stoppedUP, queuedUP, stalledUP,
  checkingUP, forcedUP, allocating, downloading, metaDL, pausedDL, stoppedDL,
  queuedDL, stalledDL, checkingDL, forcedDL, checkingResumeData, moving, unknown

GET /torrents/count
→ { downloading: N, seeding: N, completed: N, paused: N, stopped: N }

GET /torrents/properties?hash={sha1}
→ TorrentProperties (33 fields: total_wasted, total_uploaded, nb_connections,
                     time_elapsed, seeding_time, peers, seeds, pieces_num,
                     pieces_have, piece_size, reannounce, etc.)

GET /torrents/files?hash={sha1}
→ TorrentFile[] (index, name, size, progress, priority, is_seed, piece_range, availability)
  priority: 0=skip 1=normal 2=high 7=maximal

GET /torrents/trackers?hash={sha1}
→ Tracker[] (url, tier, num_seeds, num_leeches, status, msg)
  status: 0=disabled 1=not_contacted 2=working 3=updating 4=not_working

GET /sync/torrentPeers?hash={sha1}&rid=0
→ TorrentPeersResponse { peers: { "ip:port": { client, progress, dl_speed, up_speed, country } }, rid, full_update }

GET /torrents/tags
→ string[]

GET /torrents/categories
→ Record<name, { name, savePath }>

GET /torrents/pieceStates?hash={sha1}
→ 0[]=not_downloaded 1[]=downloading 2[]=downloaded
```

#### Torrents — Write

```http
POST /torrents/add
# By URL/magnet:
urls=magnet:?xt=...%0Ahttps://...  (newline-separated, URL-encoded)
# By file upload: multipart/form-data, field name "torrents"
# Common optional fields:
savepath=/path/to/save
category=Movies
tags=4K,UltraHD
rename=Custom%20Name
paused=true            (v4) / stopped=true (v5)
firstLastPiecePrio=true
sequentialDownload=true

POST /torrents/pause    hashes=hash1|hash2   (pipe-separated)
POST /torrents/resume   hashes=hash1|hash2
POST /torrents/stop     hashes=hash1         (v5+)
POST /torrents/start    hashes=hash1         (v5+)
POST /torrents/delete   hashes=hash1|hash2   deleteFiles=true|false
POST /torrents/recheck  hashes=hash1|hash2
POST /torrents/reannounce hashes=hash1|hash2

POST /torrents/rename   hash={sha1}   name=New%20Name
POST /torrents/setCategory   hashes=hash1|hash2   category=Movies
POST /torrents/addTags       hashes=hash1|hash2   tags=tag1,tag2
POST /torrents/removeTags    hashes=hash1|hash2   tags=tag1

POST /torrents/setDownloadLimit   hashes=hash1|hash2   limit=1048576   (bytes/s; 0=unlimited)
POST /torrents/setUploadLimit     hashes=hash1|hash2   limit=1048576

POST /torrents/filePrio
  hash={sha1}
  id=0|1|2    (file indices, pipe-separated)
  priority=0|1|2|7

POST /torrents/addTrackers
  hash={sha1}
  urls=http://tracker.com/announce%0Ahttp://tracker2.com/announce

POST /torrents/removeTrackers
  hash={sha1}
  urls=http://tracker.com/announce

POST /torrents/setSuperSeeding          hashes=hash1   value=true|false
POST /torrents/setAutoManagement        hashes=hash1   enable=true|false
POST /torrents/toggleSequentialDownload hashes=hash1
POST /torrents/toggleFirstLastPiecePrio hashes=hash1
POST /torrents/setForceStart            hashes=hash1   value=true|false

POST /torrents/setShareLimits
  hashes=hash1|hash2
  ratioLimit=1.5         (0=no limit)
  seedingTimeLimit=10080 (minutes; 0=no limit)
  inactiveSeedingTimeLimit=10080
  shareLimitAction=Default|Stop|Remove|RemoveWithContent|EnableSuperSeeding

POST /torrents/setSavePath   id=hash1|all   path=/new/path
POST /torrents/createCategory   category=Name   savePath=/path
POST /torrents/removeCategories   categories=Cat1%0ACat2
POST /torrents/export   hash={sha1}   →  binary .torrent file
```

#### Transfer & Global Control

```http
GET /transfer/info
→ {
    dl_info_speed: N,        // bytes/s current
    ul_info_speed: N,
    dl_info_data: N,         // bytes total this session
    ul_info_data: N,
    dl_rate_limit: N,        // 0 = unlimited
    ul_rate_limit: N,
    dht_nodes: N,
    connection_status: "connected" | "firewalled" | "disconnected",
    free_space_on_disk: N    // bytes on default save path disk
  }

GET /transfer/downloadLimit → N (bytes/s)
GET /transfer/uploadLimit   → N (bytes/s)
POST /transfer/setDownloadLimit   limit=10485760  (0=unlimited)
POST /transfer/setUploadLimit     limit=10485760
POST /transfer/toggleSpeedLimitsMode  → toggle normal/alt speed limits
POST /transfer/banPeers   peers=1.2.3.4:6881|5.6.7.8:6881
```

#### App Settings

```http
GET /app/version        → "v5.0.12"
GET /app/buildInfo      → { buildInfo: "21032019" }

GET /app/preferences
→ AppPreferences (90 fields including):
  save_path, temp_path, incomplete_dir_enabled
  global_dl_limit, global_ul_limit, alt_dl_limit, alt_ul_limit, speed_mode_limit_enabled
  max_connec, max_connec_per_torrent, max_uploads_per_torrent
  dht_enabled, pex_enabled, lsd_enabled, encryption
  ratio_limit, seeding_time_limit, auto_tmm_enabled

POST /app/setPreferences
  json={"save_path":"/new/path","global_dl_limit":1048576}
  (only changed fields; JSON object in form field named "json")

POST /app/shutdown
GET /app/networkInterfaceList
GET /app/getDirectoryContent?dirPath=/path&mode=folder
POST /app/sendTestEmail
```

#### Sync (Efficient Delta Updates)

```http
GET /sync/maindata?rid=0
→ {
    rid: 1234,
    full_update: true,
    torrents: { "hash1": { name, state, progress, ... } },
    torrents_removed: ["hash3"],
    categories: { Movies: { name, savePath } },
    tags: ["4K"],
    server_state: { dl_info_speed, ul_info_speed, free_space_on_disk, ... }
  }

# Subsequent calls: ?rid=1234
# Returns only diffs: changed torrent fields, removed hashes, updated server_state
```

#### RSS & Search

```http
POST /rss/addFeed          url=http://...   path=FeedName
GET /rss/items?withData=true → Record<feedName, { articles: Article[] }>
GET /rss/rules             → Record<ruleName, FeedRule>
POST /rss/setRule          ruleName=Name   ruleDef={...}
POST /rss/matchingArticles?ruleName=Name → Record<feedName, articleIds[]>

POST /search/start         pattern=ubuntu   category=all   plugins=Plugin1|Plugin2
→ { id: 123 }
POST /search/stop          id=123
GET /search/results?id=123&limit=50&offset=0
GET /search/plugins        → SearchPlugin[]
POST /search/installPlugin sources=http://...
POST /search/enablePlugin  names=Plugin1   enable=true|false
POST /search/updatePlugins
```

### 4.2 Flood REST API

Flood is a Node.js multi-client wrapper (rTorrent, qBittorrent, Transmission, Deluge). Base: `http://flood:3000/api`

#### Auth

```http
POST /api/auth/login
{ username: "admin", password: "secret" }
→ Set-Cookie: jwt=...

POST /api/auth/logout
GET /api/auth/verify → { username, uid }
```

#### Torrents

```http
GET /api/torrents
→ Torrent[] (normalized across all backends)

POST /api/torrents/add-urls
{ urls: ["magnet:...", "https://..."], destination?: "/path", tags?: ["4K"] }

POST /api/torrents/add-files   (multipart/form-data)
files: [<.torrent file>]
destination?: string

POST /api/torrents/start    { hashes: ["hash1"] }
POST /api/torrents/stop     { hashes: ["hash1"] }
DELETE /api/torrents        { hashes: ["hash1"], deleteFiles?: true }
POST /api/torrents/check    { hashes: ["hash1"] }
POST /api/torrents/priority { hashes: ["hash1"], priority: "topPrio" | "bottomPrio" | "increasePrio" | "decreasePrio" }
POST /api/torrents/tags     { hashes: ["hash1"], tags: ["4K"], operation: "add" | "remove" }

GET /api/torrents/{hash}/contents
GET /api/torrents/{hash}/trackers
GET /api/torrents/{hash}/peers
POST /api/torrents/{hash}/contents/priority { indices: [0,1], priority: 2 }
```

#### Real-Time Updates (SSE)

```http
GET /api/activity-stream
→ EventSource (Server-Sent Events)

Events:
  TORRENT_LIST_FULL_UPDATE → complete torrent list JSON
  TORRENT_LIST_DIFF_CHANGE → JSON Patch operations array
  CLIENT_CONNECTIVITY_STATUS_CHANGE → { isConnected: bool }
```

#### Client & History

```http
GET /api/client/stats → { upRate, dnRate, totalUpRate, totalDnRate, ... }
GET /api/client/settings → backend-specific settings
PATCH /api/client/settings { setting: value }
GET /api/history → { timestamps[], upRates[], dnRates[] }
```

### 4.3 Download Client Abstraction Layer (`src/lib/download-client/`)

```typescript
interface DownloadClient {
  getTorrents(filter?: TorrentFilter): Promise<Torrent[]>
  getTransferInfo(): Promise<TransferInfo>
  pollMaindata(rid?: number): Promise<MaindataResult>
  addTorrent(payload: AddTorrentPayload): Promise<void>
  deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void>
  pauseTorrents(hashes: string[]): Promise<void>
  resumeTorrents(hashes: string[]): Promise<void>
}

// Client selected via DOWNLOAD_CLIENT env var: "qbittorrent" | "transmission" | "deluge"
// qbittorrent: fully implemented
// transmission, deluge: stubs only
```

---

## 5. Storage & Compute Estimates

### 5.1 Per-Format Media Sizes

| Content | Format | Size |
|---|---|---|
| Movie SD (480p) | H.264 MKV | 1–2 GB |
| Movie HD (1080p) | H.264 MKV | 6–15 GB |
| Movie HD (1080p) | HEVC MKV | 4–8 GB |
| Movie 4K HDR | HEVC MKV (Remux) | 50–80 GB |
| Movie 4K HDR | HEVC compressed | 15–25 GB |
| TV Episode (1080p) | H.264 | 1–3 GB |
| TV Episode (4K) | HEVC | 4–8 GB |
| Music Album (lossless) | FLAC | 200–500 MB |
| Music Album (lossy) | MP3/AAC 320k | 80–150 MB |

### 5.2 Collection Size Estimates

| Collection | Small | Medium | Large |
|---|---|---|---|
| Movies (1080p avg 8 GB) | 100 = 800 GB | 500 = 4 TB | 2000 = 16 TB |
| Movies (4K mix) | 100 = 2 TB | 500 = 10 TB | 2000 = 40 TB |
| TV (1080p, 50 ep/show) | 20 shows = 3 TB | 100 shows = 15 TB | 400 shows = 60 TB |
| Music (lossless) | 200 albums = 60 GB | 1000 albums = 300 GB | 5000 albums = 1.5 TB |

### 5.3 Metadata & Supporting Data

| Type | Per Item | Notes |
|---|---|---|
| Poster image | 100–300 KB | Multiple sizes cached |
| Backdrop image | 200–600 KB | Full-res + thumbnails |
| Trickplay (chapter thumbnails) | 10–20 MB/movie | Dominant metadata cost |
| Subtitle files (.srt) | 20–80 KB | Negligible |
| SQLite DB (10k items) | ~50 MB | Fast enough for personal use |
| NFO files (*arr) | 2–5 KB/item | |

**Metadata storage budget:** ~20 MB per movie if trickplay enabled; budget 2–5% of media storage for metadata.

### 5.4 Transcoding Requirements

| Resolution | CPU (H.264 → H.264) | GPU (NVENC/QSV) |
|---|---|---|
| 720p | ~2 cores | 1 stream easily |
| 1080p | ~4 cores | 1 stream easily |
| 4K → 1080p | 8–12 cores | 1 stream (NVENC) |
| 4K HDR → SDR (tonemap) | 12–16 cores | Requires specific GPU |

**Simultaneous streams:** Budget 1–2 hardware transcode streams per GPU encoder; CPU-only limits to 1 concurrent 4K transcode per 4–6 cores at typical quality.

### 5.5 RAM Footprint (Idle / Under Load)

| Service | Idle | Active |
|---|---|---|
| Jellyfin | ~300 MB | 600 MB–2 GB (with transcoding cache) |
| Sonarr | ~150 MB | 250 MB |
| Radarr | ~150 MB | 250 MB |
| Prowlarr | ~100 MB | 200 MB |
| Bazarr | ~100 MB | 150 MB |
| qBittorrent | ~50–200 MB | 500 MB (1000+ torrents) |
| **Total current stack** | **~850 MB** | **~3.4–4.4 GB** |

Custom replacements (Node.js-based):

| Replacement | Idle | Active |
|---|---|---|
| Custom media server (Node + ffmpeg) | ~200 MB | 500 MB–1 GB |
| Custom automation (Sonarr+Radarr) | ~80 MB | 150 MB |
| Custom indexer proxy (Prowlarr) | ~60 MB | 100 MB |
| Custom subtitle manager (Bazarr) | ~60 MB | 80 MB |
| **Estimated total custom stack** | **~400 MB** | **~1.3–2.3 GB** |

### 5.6 Hardware Tier Recommendations

| Use Case | CPU | RAM | Storage | Notes |
|---|---|---|---|---|
| Pure direct-play (<5 users) | Any 4-core | 4 GB | Per collection above | No transcode needed |
| 1–2 1080p transcodes | i5/Ryzen 5 | 8 GB | + 20% headroom | Software encode |
| 4K HDR transcoding | i7/Ryzen 7 + iGPU | 16 GB | Fast cache drive | Intel QSV HDR tonemapping |
| 3–5 concurrent 4K | Dedicated NVENC GPU | 32 GB | NVMe cache | RTX 3060+ recommended |

---

## 6. Independence Build Plan

### 6.1 What to Build and Why

The unified-frontend already owns: auth, sessions, SQLite, a download-client abstraction layer, and full proxy routes for every upstream service. The plumbing surface is smaller than starting from scratch — only the service logic needs to be written.

### 6.2 Service Replacement Specs

#### A. Indexer Aggregation (replaces Prowlarr)

**Scope:** Smallest, self-contained, unblocks everything else.

```typescript
// SQLite schema
CREATE TABLE indexers (
  id INTEGER PRIMARY KEY,
  name TEXT,
  torznab_url TEXT,    // e.g. http://jackett:9117/api/v2.0/indexers/rarbg/results/torznab/
  api_key TEXT,
  enabled INTEGER DEFAULT 1,
  last_health_check INTEGER,
  health_status TEXT
)

// Unified search endpoint
GET /api/torznab/search?q=title&cats=2000,5000&imdbid=tt1234567

// Fan-out: query all enabled indexers in parallel, merge by info hash, sort by seeders
// Response: parsed Torznab RSS converted to JSON
```

**Libraries:** `xml2js`, `p-limit`, `better-sqlite3`

**Complexity:** Medium | **Estimate:** 25–35 hours

---

#### B. Download Automation (replaces Sonarr + Radarr)

```typescript
// SQLite schema
CREATE TABLE monitored_items (
  id INTEGER PRIMARY KEY,
  tmdb_id INTEGER,
  tvdb_id INTEGER,
  type TEXT,           // "movie" | "tv"
  title TEXT,
  quality_profile_id INTEGER,
  root_path TEXT,
  monitored INTEGER DEFAULT 1,
  status TEXT          // "wanted" | "grabbed" | "imported" | "ignored"
)

CREATE TABLE quality_profiles (
  id INTEGER PRIMARY KEY,
  name TEXT,
  conditions TEXT      // JSON: [{ type: "resolution", value: "1080p", required: true }]
)

CREATE TABLE grab_history (
  id INTEGER PRIMARY KEY,
  item_id INTEGER,
  indexer TEXT,
  release_title TEXT,
  info_hash TEXT,
  grabbed_at INTEGER,
  import_status TEXT
)
```

**Release name parser** (key component — no perfect JS library for this):

```typescript
// Parse: "The.Movie.2024.1080p.BluRay.x264-GROUP"
function parseReleaseName(name: string): ReleaseMeta {
  const resolution = name.match(/\b(2160p|1080p|720p|480p)\b/i)?.[1]
  const codec = name.match(/\b(x264|x265|H\.264|H\.265|HEVC|AVC)\b/i)?.[1]
  const source = name.match(/\b(BluRay|WEB-DL|WEBRip|HDTV|REMUX)\b/i)?.[1]
  const group = name.match(/-([A-Z0-9]+)$/i)?.[1]
  // TV: S01E02 or 1x02 or Season 1 Episode 2
  const season = name.match(/S(\d{2})E\d{2}/i)?.[1]
  const episode = name.match(/S\d{2}E(\d{2})/i)?.[1]
  return { resolution, codec, source, group, season: +season, episode: +episode }
}
```

**Poll loop (node-cron):**

```typescript
// Every 15 minutes: scan Torznab for wanted items
cron.schedule('*/15 * * * *', async () => {
  const wanted = db.prepare("SELECT * FROM monitored_items WHERE status = 'wanted'").all()
  for (const item of wanted) {
    const results = await searchTorznab(item)
    const best = rankByQualityProfile(results, item.quality_profile_id)
    if (best) await downloadClient.addTorrent({ url: best.magnetUrl, category: item.type })
  }
})
```

**Libraries:** `node-cron`, `xml2js`, `better-sqlite3`

**Complexity:** High | **Estimate:** 60–80 hours (movies + TV MVP)

---

#### C. Media Requests Webhook Wire-Up (replaces Seerr dependency on Sonarr/Radarr)

The `/api/seerr/*` proxy routes and `/lib/seerr/api.ts` already exist. Only the approval handler needs to change:

```typescript
// Current: approval calls Sonarr/Radarr
// New: approval calls custom automation
async function onRequestApproved(request: MediaRequest) {
  if (request.type === 'movie') {
    await db.prepare("INSERT INTO monitored_items ...").run({
      tmdb_id: request.tmdbId, type: 'movie', status: 'wanted'
    })
  } else {
    await db.prepare("INSERT INTO monitored_items ...").run({
      tmdb_id: request.tmdbId, tvdb_id: request.tvdbId, type: 'tv', status: 'wanted'
    })
  }
}

// Availability poller: cron job checks if wanted items appeared in Jellyfin (or custom media server)
// On match: POST /api/v1/media/{id} to mark available in Seerr (or in own DB once Seerr is replaced)
```

**Complexity:** Low | **Estimate:** 8–12 hours

---

#### D. Subtitle Management (replaces Bazarr)

```typescript
// SQLite schema
CREATE TABLE subtitle_wants (
  id INTEGER PRIMARY KEY,
  item_id TEXT,        // Jellyfin item ID (or own media server ID later)
  media_path TEXT,
  language TEXT,       // "en", "es", etc.
  forced INTEGER DEFAULT 0,
  hi INTEGER DEFAULT 0,
  status TEXT          // "wanted" | "downloaded" | "skipped"
)

// OpenSubtitles v3 search
async function searchSubtitles(imdbId: string, language: string): Promise<SubResult[]> {
  const res = await fetch('https://api.opensubtitles.com/api/v1/subtitles', {
    headers: { 'Api-Key': process.env.OPENSUBTITLES_API_KEY, 'Content-Type': 'application/json' },
    // query params: imdb_id, languages, type
  })
  return (await res.json()).data
}

// Download + write sidecar
async function downloadSubtitle(fileId: number, destPath: string) {
  const { link } = await openSubtitlesDownload(fileId)
  const srt = await fetch(link).then(r => r.text())
  await fs.writeFile(destPath.replace(/\.[^.]+$/, '.en.srt'), srt)
}
```

**External API:** OpenSubtitles v3 (free: 5 downloads/day; VIP $3/month for 1000/day)

**Libraries:** `node-cron`, `better-sqlite3`, `fluent-ffmpeg` (for subtitle embedding)

**Complexity:** Medium | **Estimate:** 30–40 hours

---

#### E. Media Server (replaces Jellyfin)

The largest and most complex replacement. Build last — Jellyfin is stable and this needs iteration.

**Core components:**

```typescript
// 1. Filesystem scanner (chokidar)
import chokidar from 'chokidar'
const watcher = chokidar.watch(MEDIA_ROOTS, { ignoreInitial: false })
watcher.on('add', path => scanFile(path))
watcher.on('unlink', path => removeFromDb(path))

// 2. Metadata resolver
async function resolveMetadata(filePath: string): Promise<MediaItem> {
  const parsed = parseFilename(path.basename(filePath))  // title, year, S/E
  if (parsed.season) {
    return await tvdbLookup(parsed)  // TVDB API
  } else {
    return await tmdbLookup(parsed)  // TMDB API
  }
}

// 3. ffprobe for stream info
import ffprobe from '@ffprobe-installer/ffprobe'
// extracts: duration, width, height, codec, audio channels, subtitle tracks, bitrate

// 4. HLS transcode pipeline (fluent-ffmpeg)
async function createHlsStream(inputPath: string, outputDir: string, opts: TranscodeOpts) {
  return new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .videoCodec('libx264')
      .audioCodec('aac')
      .size(`${opts.maxWidth}x?`)
      .outputOptions([
        '-hls_time 6',
        '-hls_list_size 0',
        '-hls_segment_filename', path.join(outputDir, 'seg%05d.ts')
      ])
      .output(path.join(outputDir, 'index.m3u8'))
      .on('end', resolve)
      .on('error', reject)
      .run()
  })
}

// 5. Watch position (SQLite)
// Already partially exists as watch_events — add position_ticks column
```

**External APIs:**
- TMDB (free tier, generous rate limits)
- TVDB (requires subscriber key, ~$10/year)
- MusicBrainz (free, no key)
- fanart.tv (optional, extended artwork)

**Libraries:** `fluent-ffmpeg`, `@ffprobe-installer/ffprobe`, `chokidar`, `better-sqlite3`

**Complexity:** Very High | **Estimate:** 120–200 hours for MVP (scanner + TMDB + HLS + direct play)

---

#### F. Download Client (replaces qBittorrent — optional)

**Recommendation: Keep qBittorrent.** The abstraction layer already exists; swapping is only needed if qBittorrent becomes a real dependency problem.

If you do replace it, implement `WebTorrentClient extends DownloadClient` using the `webtorrent` npm package. Tradeoffs vs. qBittorrent:
- Loses: per-torrent bandwidth limits, RSS feeds, fine-grained queue management
- Gains: zero native binary dependency, runs in the same Node process

**Estimate:** 50–70 hours to reach rough feature parity.

### 6.3 Priority Order

Build sequence to minimize upstream dependency time while landing usable value at each step:

| Status | Milestone | Cuts dependency on |
|---|---|---|
| ✅ Complete | **Indexer Aggregation** — unified Torznab proxy at `/api/torznab/search` | Prowlarr |
| ✅ Complete | **Download Automation** — monitored items, release parser, quality profiles, 15-min Torznab poller | Sonarr + Radarr |
| ✅ Complete | **Request Bridge** — Seerr approvals → monitored_items; native media server availability poller | Seerr → Sonarr/Radarr link |
| ✅ Complete | **Subtitle Management** — OpenSubtitles scan + download; scanner queries SQLite directly | Bazarr |
| ✅ Complete | **Media Server** — scanner + TMDB enricher + HLS transcode + direct play + playback sessions + watch state | Jellyfin |
| ✅ Complete | **Browse/Watch wired to native media server** — home, browse, detail, play pages; TMDB image proxy; progress API; zero unconditional Jellyfin calls remain | Jellyfin browse/watch UX |
| ✅ Complete | **Native Request Management** — media_requests table; TMDB search; RequestButton; admin approve/decline | Seerr requests |
| ➖ Skip | **Download Client** — stay on qBittorrent | — |

### 6.5 Implementation Notes — Phases 1–3

**Phase 1 files:** `src/lib/indexer/types.ts`, `config.ts`, `index.ts` · API: `src/app/api/indexer/` · `src/app/api/torznab/search/` · Admin: `src/app/admin/indexers/`

**Phase 2 files:** `src/lib/automation/types.ts`, `monitor.ts`, `parser.ts`, `grabber.ts`, `scheduler.ts` · API: `src/app/api/automation/` · Admin: `src/app/admin/automation/` · Scheduler started via `src/instrumentation.ts`

**Phase 3 files:** `src/lib/automation/bridge.ts`, `availability.ts` · Webhook: `src/app/api/seerr/webhook/` · Admin: `src/app/admin/automation/bridge/`

**DB tables added:** `indexers`, `quality_profiles`, `monitored_items`, `grab_history` (all in `unified.db` via `src/lib/db/migrations.ts`)

**New packages:** `xml2js`, `@types/xml2js`, `p-limit` (Phase 1) · `node-cron`, `@types/node-cron` (Phase 2)

**New env vars required:**
- `JELLYFIN_USER_ID` — Jellyfin admin user UUID (availability poller)
- `SEERR_WEBHOOK_SECRET` — optional; verifies webhook signature from Seerr

**Deviation from spec:** p-limit v7 is ESM-only and incompatible with the project's CommonJS output. A manual 3-slot semaphore was implemented in `src/lib/indexer/index.ts` instead.

**Quality profile seeding:** Three default profiles are inserted via `INSERT OR IGNORE` on every startup: Any (no conditions), 1080p (resolution required), 4K (2160p required). Add custom profiles via `POST /api/automation/profiles` (not yet implemented — use SQLite directly for now).

### 6.4 Infrastructure Notes

**All custom services live in the existing monorepo** as additional Next.js API routes or standalone Node scripts. Example structure:

```
app/src/
  app/api/
    torznab/[...path]/route.ts        # Indexer proxy
    automation/
      search/route.ts                 # Manual trigger search
      queue/route.ts                  # Grab queue status
    media/
      scan/route.ts                   # Trigger library scan
      stream/[itemId]/route.ts        # HLS stream proxy
  lib/
    indexer/
      index.ts                        # Fan-out Torznab search
      config.ts                       # SQLite-backed indexer store
    automation/
      monitor.ts                      # Monitored items CRUD
      parser.ts                       # Release name parser
      grabber.ts                      # Quality ranking + dispatch
      scheduler.ts                    # node-cron search loop
    subtitle/
      opensubtitles.ts               # API client
      scanner.ts                     # Library subtitle audit
    media-server/
      scanner.ts                     # chokidar filesystem watch
      metadata.ts                    # TMDB/TVDB resolver
      transcode.ts                   # fluent-ffmpeg HLS pipeline
      playback.ts                    # Stream URL builder
```

**Database evolution:** All new tables add to the existing `unified.db` SQLite file. Use the same `try { ALTER TABLE... } catch {}` migration pattern already in `src/lib/db/migrations.ts`.

**qBittorrent remains the download client** throughout the entire build. The `DownloadClient` interface means the automation layer just calls `downloadClient.addTorrent(...)` — no qBittorrent-specific code in automation logic.

---

*Generated 2026-05-30 from 5 parallel research agents. Source analysis files: `jellyfin-analysis.md`, `seerr-analysis.md`, `qbittorrent-analysis.md`, `flood-analysis.md`.*
