# Jellyfin Web Client — Technical Analysis

> Source: `/home/minijoe/dev/unified-frontend/sources/jellyfin-web`
> Version: 12.0.0
> Purpose: Architecture reference for unified Next.js/React frontend merging Jellyfin, Seerr, and qBittorrent.

---

## Tech Stack

### Runtime / Framework
- **React 18.3.1** with full concurrent features
- **TypeScript 5.9.3** — partially adopted; large portions of the codebase are still plain JS
- **Webpack 5** as the primary bundler; Vite is only used for the test runner (vitest)
- **React Router 6.30.3** with a hash-based router (`createHashRouter`) — all routes are `/#/path`
- **MUI 6.5** for the experimental/modern UI components (AppBar, Drawer, Cards, etc.)

### State / Data Fetching
- **TanStack React Query 5.91** for all server-state fetching; custom hooks wrap every SDK call in `queryOptions`
- Context API for global app state: `ApiContext` (current user + API instance), `UserSettingsProvider`, `WebConfigProvider`
- No Redux/Zustand/Jotai — all global state is React context or event-bus based

### API Clients (two co-existing layers)
- **`@jellyfin/sdk` 0.0.0-unstable** — the official TypeScript SDK with generated OpenAPI clients for all endpoints; preferred for new code
- **`jellyfin-apiclient` 1.11.0** — the legacy hand-rolled client inherited from Emby; still used heavily in older controllers and the playback manager

### Player
- **hls.js 1.6.15** — HLS playback in browsers that need MSE (most desktop Chrome/Firefox)
- **flv.js 1.6.2** — FLV/live stream fallback
- **`@jellyfin/libass-wasm` 4.2.4** — WebAssembly SSA/ASS subtitle renderer
- **libpgs 0.8.1** — PGS (Blu-ray bitmap) subtitle renderer

### UI / Styling
- SCSS modules + PostCSS; MUI Emotion for the experimental layout
- **Swiper 12** for horizontal scroll carousels
- **Blurhash 2** for image placeholders
- **SortableJS 1.15** for drag-and-drop lists
- **Material Design Icons** (iconfont + `@mui/icons-material`)

### Build / Tooling
- Webpack (prod/dev), Babel for transpilation
- Node >= 24, npm >= 11 required

---

## Directory Structure

```
jellyfin-web/
├── src/
│   ├── index.jsx               # Webpack entrypoint; mounts RootApp
│   ├── RootApp.tsx             # QueryClientProvider + ApiProvider + UserSettingsProvider + WebConfigProvider
│   ├── RootAppRouter.tsx       # createHashRouter; wires stable/experimental/dashboard/wizard routes
│   │
│   ├── apps/
│   │   ├── stable/             # "Classic" layout (AppLayout, legacy header/nav)
│   │   │   ├── AppLayout.tsx
│   │   │   ├── routes/
│   │   │   │   ├── routes.tsx              # Top-level route config
│   │   │   │   ├── asyncRoutes/            # React.lazy page routes (search, user settings, quickconnect)
│   │   │   │   ├── legacyRoutes/           # Legacy HTML/JS page routes served via ViewManagerPage
│   │   │   │   ├── session/forgotPassword/ # Forgot-password page (React)
│   │   │   │   └── user/                   # User settings, profile pages (React)
│   │   │   └── features/
│   │   │       ├── libraries/api/          # useResumeItems, useNextUp, useLatestMedia hooks
│   │   │       ├── search/                 # Search API hooks + components (SearchResults, SearchSuggestions)
│   │   │       └── playback/
│   │   │           ├── constants/          # PlayerEvent, MediaSegmentAction enums
│   │   │           └── utils/              # mediaSegments.ts, mediaSegmentManager, subtitleStyles
│   │   │
│   │   ├── experimental/       # Next-gen MUI-based layout (used by default unless TV or override)
│   │   │   ├── AppLayout.tsx
│   │   │   ├── routes/
│   │   │   │   ├── routes.tsx              # Same structure; adds home/movies/music/shows/etc. as async React routes
│   │   │   │   ├── asyncRoutes/user.ts     # home, movies, music, shows, books, playlists, boxsets, mixed, livetv
│   │   │   │   ├── video/                  # VideoPage (new controls wrapping legacy view)
│   │   │   │   └── [library-type]/         # books, boxsets, homevideos, livetv, mixed, movies, music, musicvideos, playlists, shows
│   │   │   ├── components/
│   │   │   │   ├── AppToolbar/             # Top bar with Search + SyncPlay + RemotePlay buttons
│   │   │   │   ├── drawers/                # MainDrawerContent, AppDrawer
│   │   │   │   └── library/               # ItemsView, Pagination, AlphabetPicker, Filters, SortButton, etc.
│   │   │   └── features/preferences/       # DisplayPreferences component
│   │   │
│   │   ├── dashboard/          # Admin dashboard (fully MUI, separate layout)
│   │   │   └── routes/         # users, libraries, plugins, networking, playback, scheduled tasks, etc.
│   │   │
│   │   └── wizard/             # First-run setup wizard
│   │
│   ├── components/
│   │   ├── AppHeader.tsx           # Stable-layout header
│   │   ├── ConnectionRequired.tsx  # Auth guard; redirects to /login if not connected
│   │   ├── cardbuilder/
│   │   │   ├── Card/               # React Card component (CardBox, CardContent, CardHoverMenu, etc.)
│   │   │   ├── cardBuilder.js      # Legacy HTML string card builder (still used in older sections)
│   │   │   └── utils/url.ts        # getCardImageUrl() — selects best image type/tag and calls getImageApi
│   │   ├── playback/
│   │   │   ├── playbackmanager.js  # Core singleton — orchestrates play, pause, seek, queue, progress reporting
│   │   │   ├── playqueuemanager.js # Manages the play queue
│   │   │   └── skipsegment.ts      # Skip intro/credits button logic
│   │   ├── homesections/sections/  # Resume, NextUp, LatestMedia, LiveTV section loaders
│   │   ├── itemDetails/            # Item detail metadata list (React)
│   │   └── htmlMediaHelper.js      # Shared HLS/FLV player helpers
│   │
│   ├── controllers/            # Legacy HTML+JS page controllers (still ~50% of the app)
│   │   ├── session/login/      # Login page controller (username/password + QuickConnect)
│   │   ├── itemDetails/        # Item detail page (movie/show/episode detail)
│   │   ├── playback/video/     # Video OSD controller (seek bar, trickplay, chapter bubbles)
│   │   ├── playback/queue/     # Play queue page
│   │   ├── movies/             # Movie recommendations controller
│   │   ├── music/              # Music recommendations controller
│   │   └── shows/              # TV show recommendations + next-up
│   │
│   ├── plugins/
│   │   ├── htmlVideoPlayer/    # Primary video player plugin (HLS/FLV/direct; libass/libpgs subtitles)
│   │   ├── htmlAudioPlayer/    # Primary audio player plugin
│   │   ├── chromecastPlayer/   # Chromecast support
│   │   ├── syncPlay/           # Synchronized playback (group sessions)
│   │   └── [others]/           # bookPlayer, comicsPlayer, pdfPlayer, photoPlayer, youtubePlayer
│   │
│   ├── hooks/
│   │   ├── useApi.tsx          # ApiContext + ApiProvider — exposes { api, user, __legacyApiClient__ }
│   │   ├── useItem.ts          # getUserLibraryApi.getItem() via React Query
│   │   ├── useUserViews.ts     # getUserViewsApi.getUserViews() via React Query
│   │   ├── useFetchItems.ts    # Comprehensive hook for paginated/filtered item lists
│   │   └── api/
│   │       ├── useDisplayPreferences.ts
│   │       ├── useUser.ts
│   │       ├── useUserViews.ts
│   │       └── libraryHooks/, videosHooks/, liveTvHooks/
│   │
│   ├── lib/
│   │   └── jellyfin-apiclient/
│   │       ├── connectionManager.js  # Multi-server connection logic (legacy layer)
│   │       └── ServerConnections.js  # Singleton ConnectionManager; also exposes getCurrentApi()
│   │
│   ├── scripts/
│   │   ├── browserDeviceProfile.js  # Builds DeviceProfile for /PlaybackInfo negotiation
│   │   ├── libraryBrowser.js        # Library browsing utilities
│   │   └── settings/
│   │       ├── userSettings.js      # UserSettings class; syncs with /DisplayPreferences API
│   │       └── appSettings.js       # Local app preferences (localStorage)
│   │
│   ├── utils/
│   │   ├── jellyfin-apiclient/
│   │   │   ├── compat.ts       # toApi(apiClient) — adapts legacy client to SDK Api instance
│   │   │   └── createApiClient.ts
│   │   └── sdk/authentication-api.ts
│   │
│   ├── constants/
│   │   └── time.ts             # TICKS_PER_MILLISECOND = 10_000; TICKS_PER_SECOND = 10_000_000
│   │
│   └── types/                  # TypeScript types: library, cardOptions, sections, base item models
```

---

## Jellyfin API Reference

### Authentication Header Format

Every authenticated request sends an `Authorization` header (constructed by `@jellyfin/sdk`):

```
Authorization: MediaBrowser Client="Jellyfin Web", Device="<deviceName>", DeviceId="<deviceId>", Version="<appVersion>", Token="<accessToken>"
```

For direct-stream/download URLs the token can instead be passed as `?ApiKey=<accessToken>` in the query string (done by the playback manager for stream URLs).

**Time values**: All position/duration values in the Jellyfin API are in **ticks** where 1 second = 10,000,000 ticks (i.e., 100-nanosecond intervals). Convert: `ticks / 10_000 = milliseconds`.

---

### Key API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/System/Info/Public` | None | Server discovery/probe; returns `Id`, `Version`, `ServerName`. Used before auth to verify server identity. |
| `GET` | `/System/Info` | Token | Full system info; validates existing access token. |
| `GET` | `/Branding/Configuration` | None | Returns `LoginDisclaimer` markdown and CSS overrides for the login page. |
| `GET` | `/Users/Public` | None | Lists users with public profiles (avatar + name); drives the visual login picker. |
| `POST` | `/Users/AuthenticateByName` | None (body: `{Username, Pw}`) | Main credential auth. Returns `{ AccessToken, User: { Id, ServerId, ... } }`. |
| `POST` | `/QuickConnect/Initiate` | None | Starts a QuickConnect session; returns `{ Secret, Code }`. |
| `GET` | `/QuickConnect/Connect?Secret=<s>` | None | Polls QuickConnect auth status; returns `{ Authenticated: bool }`. |
| `POST` | `/Users/AuthenticateWithQuickConnect` | None (body: `{ Secret }`) | Exchanges a validated QuickConnect secret for an access token. |
| `POST` | `/Users/ForgotPassword` | None (body: `{ EnteredUsername }`) | Triggers forgot-password flow. |
| `GET` | `/Users/{userId}` | Token | Get user profile/configuration. |
| `GET` | `/Users/{userId}/Views` | Token | Gets the user's library root folders (Movies, TV Shows, Music, etc.). Returns `BaseItemDtoQueryResult`. |
| `GET` | `/Users/{userId}/Items` | Token | **Primary library browse endpoint.** Accepts dozens of query params (see below). |
| `GET` | `/Users/{userId}/Items/{itemId}` | Token | Get a single item by ID. |
| `GET` | `/Users/{userId}/Items/Latest` | Token | "Recently Added" items. Params: `ParentId`, `Limit`, `Fields`, `ImageTypeLimit`. |
| `GET` | `/Users/{userId}/Items/Resume` | Token | In-progress items. Params: `MediaTypes`, `Limit`, `Fields`. |
| `GET` | `/Shows/NextUp` | Token | Next-up episodes across all series. Params: `UserId`, `Limit`, `Fields`. |
| `GET` | `/Episodes` | Token | Episode list for a series. Params: `seriesId`, `UserId`, `SeasonId`. |
| `GET` | `/Shows/{seriesId}/Seasons` | Token | Seasons for a series. |
| `GET` | `/Shows/{seriesId}/Episodes` | Token | Episodes for a series (optionally filtered by season). |
| `POST` | `/Items/{itemId}/PlaybackInfo` | Token | **Critical playback endpoint.** POST body: `{ UserId, DeviceProfile, StartTimeTicks, AudioStreamIndex, SubtitleStreamIndex, ... }`. Returns `{ PlaySessionId, MediaSources: [{ SupportsDirectPlay, SupportsDirectStream, SupportsTranscoding, TranscodingUrl, TranscodingSubProtocol, Container, MediaStreams, ... }] }`. |
| `GET` | `/Videos/{itemId}/stream.{container}` | Token (or `?ApiKey=`) | **Direct stream URL.** Params: `Static=true`, `mediaSourceId`, `deviceId`, `ApiKey`, `Tag`. |
| `GET` | `/Audio/{itemId}/universal` | Token (or `?ApiKey=`) | **Universal audio stream.** Params: `UserId`, `Container`, `AudioCodec`, `TranscodingContainer`, `MaxStreamingBitrate`, `PlaySessionId`, `StartTimeTicks`. |
| `GET` | `<TranscodingUrl from PlaybackInfo>` | Embedded in URL | Transcoded HLS stream; URL is server-provided verbatim. |
| `POST` | `/Sessions/Playing` | Token (body: `PlaybackStartInfo`) | Report playback started. Fields: `ItemId`, `MediaSourceId`, `PlaySessionId`, `PositionTicks`, `IsPaused`, `PlayMethod`, `AudioStreamIndex`, `SubtitleStreamIndex`. |
| `POST` | `/Sessions/Playing/Progress` | Token (body: `PlaybackProgressInfo`) | Periodic playback progress ping (sent every ~5s). Same fields as start. |
| `POST` | `/Sessions/Playing/Stopped` | Token (body: `PlaybackStopInfo`) | Report playback stopped; commits resume position. |
| `DELETE` | `/Videos/ActiveEncodings?PlaySessionId=<id>` | Token | Cancel transcoding session on stop. |
| `POST` | `/LiveStreams/Open` | Token | Open a live/RTSP stream; returns updated `MediaSource` with `LiveStreamId`. |
| `DELETE` | `/LiveStreams/Close` | Token | Close live stream. |
| `GET` | `/Items/{itemId}/Images/{imageType}` | None (or `?ApiKey=`) | Fetch item artwork. `imageType`: Primary, Backdrop, Thumb, Banner, Logo, Disc. Params: `fillWidth`, `fillHeight`, `quality`, `tag` (cache-buster). |
| `GET` | `/Items/{itemId}/Images/{imageType}/{imageIndex}` | None | Indexed image (e.g., Backdrop index 1). |
| `GET` | `/Videos/{itemId}/Trickplay/{width}/{index}.jpg` | Token | Trickplay thumbnail tile sprite. `width` = resolution from `item.Trickplay[mediaSourceId]`. `index` = tile batch index. |
| `GET` | `/Videos/{itemId}/Subtitles/{subtitleIndex}/Stream.{format}` | Token | Subtitle file delivery (VTT, ASS, SRT). The exact `DeliveryUrl` is returned in `MediaSource.MediaStreams[].DeliveryUrl`. |
| `GET` | `/Search/Hints` | Token | Legacy search. Params: `SearchTerm`, `IncludeItemTypes`, `UserId`. |
| `GET` | `/Items` (SDK: `getItemsApi.getItems()`) | Token | Same as `/Users/{userId}/Items` but through SDK; preferred for new code. |
| `GET` | `/Artists` | Token | Artist list. |
| `GET` | `/Genres` | Token | Genre list. |
| `GET` | `/Persons` | Token | People/cast list with optional `searchTerm`. |
| `GET` | `/Studios` | Token | Studio list. |
| `GET` | `/Movies/Recommendations` | Token | Movie recommendation rows. |
| `GET` | `/DisplayPreferences/{displayPreferencesId}?userId={userId}&client={client}` | Token | Retrieve persisted UI settings (sort order, view mode, etc.) for a specific view. `client` is always `"emby"` in legacy code. |
| `POST` | `/DisplayPreferences/{displayPreferencesId}?userId={userId}&client={client}` | Token | Persist UI settings. |
| `POST` | `/Users/{userId}/PlayedItems/{itemId}` | Token | Mark item as played. |
| `DELETE` | `/Users/{userId}/PlayedItems/{itemId}` | Token | Mark item as unplayed. |
| `POST` | `/Users/{userId}/FavoriteItems/{itemId}` | Token | Favorite an item. |
| `DELETE` | `/Users/{userId}/FavoriteItems/{itemId}` | Token | Unfavorite an item. |

#### Common Query Params for `/Items`

```
ParentId, IncludeItemTypes, ExcludeItemTypes, Recursive, Filters, SortBy, SortOrder,
Fields, ImageTypeLimit, EnableImageTypes, Limit, StartIndex, SearchTerm,
IsFavorite, IsMissing, IsUnaired, Genres, OfficialRatings, Tags, Years,
VideoTypes, HasSubtitles, HasTrailer
```

`Fields` controls which optional properties are populated on returned `BaseItemDto` objects. Common values: `PrimaryImageAspectRatio`, `BasicSyncInfo`, `MediaSources`, `Overview`, `Chapters`, `Trickplay`.

---

## Authentication Flow

### Standard Password Login

1. **Server Discovery** — `GET /System/Info/Public` with no auth. Returns server name/version/ID. Connection manager probes both LocalAddress and ManualAddress and takes whichever responds first.
2. **Public User List** — `GET /Users/Public` to populate avatar-based login picker (no auth required).
3. **Authenticate** — `POST /Users/AuthenticateByName` (body JSON: `{ "Username": "...", "Pw": "..." }`). Response:
   ```json
   {
     "AccessToken": "...",
     "ServerId": "...",
     "User": { "Id": "...", "Name": "...", ... }
   }
   ```
4. **Store** — `AccessToken` and `UserId` are stored in `Credentials` (localStorage via `jellyfin-apiclient`) and attached to the `ApiClient` instance via `setAuthenticationInfo(token, userId)`.
5. **All subsequent requests** send `Authorization: MediaBrowser ... Token="<accessToken>"`.

### Auto-Login (Re-connect on Page Load)

1. `ServerConnections.connect()` is called on startup.
2. If saved credentials exist, `GET /System/Info` is called with the stored token to validate it.
3. If valid, `getCurrentUser()` is called and `localusersignedin` event is fired to populate `ApiContext`.

### QuickConnect Flow

1. Client: `POST /QuickConnect/Initiate` → receives `{ Secret, Code }`.
2. User enters the `Code` on another authorized device.
3. Client polls `GET /QuickConnect/Connect?Secret=<secret>` every 5 seconds.
4. When `Authenticated: true`, client calls `apiClient.quickConnect(secret)` which POSTs to `/Users/AuthenticateWithQuickConnect` and receives the same `AuthenticationResult` as password auth.

### Token Storage

The legacy `Credentials` class serializes server/user/token data to localStorage under a fixed key. The `@jellyfin/sdk` `Api` instance is created on demand via `toApi(apiClient)` which wraps the same server address + access token.

---

## Playback Architecture

### Overall Flow

```
User clicks Play
    → playbackManager.play(items, options)
    → getPlaybackInfo()  [POST /Items/{id}/PlaybackInfo with DeviceProfile]
    → Server returns PlaybackInfoResponse with MediaSources array
    → getOptimalMediaSource() picks best source (DirectPlay > DirectStream > Transcode)
    → createStreamInfo() builds the final URL
    → Player plugin receives streamInfo.url + mimeType + textTracks
    → Player plays; playbackManager sends POST /Sessions/Playing
    → Progress ticker fires every ~5s: POST /Sessions/Playing/Progress
    → On stop: POST /Sessions/Playing/Stopped + DELETE /Videos/ActiveEncodings
```

### Device Profile Negotiation

Before requesting playback info, `browserDeviceProfile.js` builds a `DeviceProfile` object that describes what the current browser can decode natively:

- Probes `video.canPlayType()` for H.264, HEVC, AV1, VP8/VP9
- Builds `DirectPlayProfiles` (containers/codecs the browser can play without transcoding)
- Builds `TranscodingProfiles` (fallback: H.264+AAC in MP4 or HLS)
- Sets `SubtitleProfiles` (VTT natively; ASS/SSA/PGS go to external renderer)

The DeviceProfile is POSTed to `/Items/{id}/PlaybackInfo`. The server responds with the best strategy per source.

### Stream URL Construction (from `playbackmanager.js`)

Three play methods, determined by the server's `PlaybackInfoResponse`:

| Method | URL Construction |
|--------|-----------------|
| **DirectPlay** | `mediaSource.Path` (filesystem path, only works if client is on same host) |
| **DirectStream** | `{baseUrl}/Videos/{itemId}/stream.{container}?Static=true&mediaSourceId=...&ApiKey=...` |
| **Transcode** | `{baseUrl}{mediaSource.TranscodingUrl}` (server-provided verbatim; usually an HLS `.m3u8`) |

For audio: `{baseUrl}/Audio/{itemId}/universal?UserId=...&ApiKey=...&Container=...&TranscodingContainer=...&AudioCodec=...&PlaySessionId=...`

### HLS Playback

- Native HLS (Safari, Tizen, webOS): `<video src="...m3u8">` directly.
- hls.js MSE path (Chrome, Firefox): `hls.js` is dynamically imported (`requireHlsPlayer()`), then `hls.attachMedia(videoElement)` + `hls.loadSource(url)`.
- hls.js config: `lowLatencyMode: false`, `backBufferLength: Infinity`, `liveBackBufferLength: 90`.

### Subtitle Handling

Subtitle delivery method comes from `MediaSource.MediaStreams[n].DeliveryMethod`:

| Delivery Method | Handling |
|-----------------|----------|
| `External` | Text-based (VTT/SRT/ASS); URL from `DeliveryUrl` field. |
| `Embed` | Native `<track>` element (subtitle baked into container). |
| `Encode` | Burned into video by server-side transcoding. |

Subtitle renderer selection logic in `htmlVideoPlayer/plugin.js`:

- **VTT** with native track support: `<track kind="subtitles">` on the `<video>` element.
- **ASS/SSA**: `@jellyfin/libass-wasm` (SubtitlesOctopus) in WASM-blend mode. Renders to a canvas overlay.
- **PGS** (Blu-ray bitmaps): `libpgs` library renders to a canvas overlay.
- **Browsers with issues** (Edge, Firefox + HLS, PS4, webOS): fall back to the custom DOM renderer that parses VTT cue events and renders styled `<div>` overlays.

Secondary subtitle track (dual-sub) is also supported via `#secondarySubtitleTrackIndex`.

### Trickplay (Seek Thumbnails)

- Trickplay data is available on the item as `item.Trickplay[mediaSourceId][width]` containing `{ Width, Height, Interval, TileWidth, TileHeight }`.
- Thumbnail sprites are fetched from: `GET /Videos/{itemId}/Trickplay/{width}/{index}.jpg?ApiKey=...`
- The index (tile batch) and offset within the sprite sheet are calculated from `positionTicks / 10_000 / interval`.

### Media Segments (Skip Intro/Credits)

- Segments are fetched via the SDK's MediaSegments API during playback initialization.
- `MediaSegmentDto` has `Type` (Intro, Credits, Recap, Preview), `StartTicks`, `EndTicks`.
- The playback overlay shows a "Skip" button when position is within a segment; skips to `EndTicks`.

---

## Key UI Components

### Card System (`/src/components/cardbuilder/`)

Two parallel implementations:

1. **Legacy `cardBuilder.js`**: Generates raw HTML strings; still used by home section row loaders.
2. **React `Card/` components**: `Card.tsx`, `Cards.tsx`, `CardBox`, `CardContent`, `CardImageContainer`, `CardHoverMenu`, etc.

Card shapes: Square, Portrait, Backdrop, Banner, Thumb — selected per content type. `getCardImageUrl()` in `utils/url.ts` implements a priority waterfall through all available image tags (Thumb, Banner, Primary, Backdrop, parent fallbacks).

### Library Grid (`ItemsView.tsx`)

Located at `/src/apps/experimental/components/library/ItemsView.tsx`. Composes:
- `useGetItemsViewByType()` from `useFetchItems.ts` (React Query fetch)
- Togglable view modes: `Cards` grid or `Lists` list
- `AlphabetPicker`, `SortButton`, `FilterButton`, `Pagination`
- `LibraryViewSettings` persisted to localStorage

### Item Detail Page

Legacy HTML controller at `/src/controllers/itemDetails/index.js` (~2100 lines). Key operations:
- Fetches `apiClient.getItem()` for metadata
- Fetches special features, trailers, similar items, cast/crew
- Triggers `playbackManager.play()` on play button click
- Listens to WebSocket `message` events for real-time updates

React component at `/src/components/itemDetails/ItemDetailsMetadataList.tsx` for the metadata table.

### Search (`/src/apps/stable/features/search/`)

Parallel hooks per content category:
- `useArtistsSearch` → `getArtistsApi.getArtists()`
- `usePeopleSearch` → `getPersonsApi.getPersons()`
- `useVideoSearch` → `getItemsApi.getItems({ IncludeItemTypes: [...] })`
- `useLiveTvSearch` → LiveTV-specific queries
- Results aggregated by `useSearchItems` into typed `Section[]` arrays, each rendered as a `SearchResultsRow`.

### Home Screen (`/src/components/homesections/`)

Section-based layout, each section is a separate loader:
- `loadResume()` → `getItemsApi.getResumeItems()`
- `loadNextUp()` → `getTvShowsApi.getNextUp()`
- `loadLatestMedia()` → `getUserLibraryApi.getLatestMedia()`
- Sections use `emby-itemscontainer` custom element for lazy loading

---

## State Management

### Global API State — `ApiContext` (`/src/hooks/useApi.tsx`)

```typescript
interface JellyfinApiContext {
    __legacyApiClient__?: ApiClient   // jellyfin-apiclient instance
    api?: Api                          // @jellyfin/sdk Api instance (derived via toApi())
    user?: UserDto                     // Current user profile
}
```

- Populated on `localusersignedin` event; cleared on `localusersignedout`.
- All React Query hooks consume `useApi()` and short-circuit (`enabled: !!api && !!userId`) when not connected.

### User Settings — `UserSettings` (`/src/scripts/settings/userSettings.js`)

Backed by `/DisplayPreferences/{id}?client=emby` on the server. Provides getters/setters for subtitle appearance, resume options, home section order, sort preferences. Mutations are debounced 50ms then PUT to the server.

### Playback State — `playbackManager` singleton

The playback manager tracks:
- `_currentPlayer` — active player plugin instance
- `_playQueueManager` — play queue (ordered list of `BaseItemDto`)
- Current item, media source, position ticks, play method
- Reports state to server via `reportPlaybackStart/Progress/Stopped`

Not a React state; components interact with it via the `Events` pub/sub bus (`utils/events.ts`).

### Server Connections — `ServerConnections` singleton

Tracks all known Jellyfin servers and their API client instances. State is persisted to localStorage via the `Credentials` class. Emits `localusersignedin` / `localusersignedout` events consumed by `ApiProvider`.

### React Query Cache

`queryClient` is the TanStack Query cache. Query keys follow the pattern:
```
['User', userId, 'Items', itemId]
['User', userId, 'Views', params]
['User', userId, 'ResumeItems', params]
['User', userId, 'NextUp', params]
['SearchSuggestions', { parentId }]
['Search', 'Items', collectionType, parentId, searchTerm]
```

---

## Notes for Unified App

### API Client Recommendation

Use **`@jellyfin/sdk`** (currently `0.0.0-unstable.202605130605`) — not `jellyfin-apiclient`. The SDK is the official TypeScript client, fully typed via OpenAPI generation. The "unstable" version label is normal for Jellyfin — it tracks server API changes.

Instantiate:
```typescript
import { Jellyfin } from '@jellyfin/sdk';

const jellyfin = new Jellyfin({
    clientInfo: { name: 'UnifiedFrontend', version: '1.0.0' },
    deviceInfo: { name: navigator.userAgent, id: deviceId }
});

const api = jellyfin.createApi(serverUrl, accessToken);
```

All domain APIs are accessed via factory functions: `getItemsApi(api)`, `getUserLibraryApi(api)`, `getTvShowsApi(api)`, etc.

### Authentication in Next.js

1. Prompt for server URL + username + password.
2. Call `getItemsApi` is not needed — instead:
   ```typescript
   // From the SDK or directly:
   POST /Users/AuthenticateByName
   Body: { Username, Pw }
   ```
   This is NOT in the generated client as of the current version (use the compatibility wrapper in `src/utils/sdk/authentication-api.ts` as a pattern, or call `apiClient.authenticateUserByName()` from legacy client).
3. Store `{ serverUrl, accessToken, userId }` in an httpOnly cookie or secure storage.
4. All subsequent SDK calls pass `accessToken` to `jellyfin.createApi(serverUrl, accessToken)`.

### Minimum Required API Calls for the Unified App

| Feature | Endpoint(s) |
|---------|-------------|
| Auth | `POST /Users/AuthenticateByName` |
| Library root | `GET /Users/{userId}/Views` |
| Browse library | `GET /Users/{userId}/Items?ParentId=...&IncludeItemTypes=...&Recursive=true` |
| Item detail | `GET /Users/{userId}/Items/{itemId}` |
| Resume items | `GET /Users/{userId}/Items/Resume?MediaTypes=Video` |
| Next up | `GET /Shows/NextUp?UserId={userId}` |
| Recently added | `GET /Users/{userId}/Items/Latest?ParentId={libraryId}` |
| Search | `GET /Users/{userId}/Items?SearchTerm=...&Recursive=true&IncludeItemTypes=...` |
| Playback URL | `POST /Items/{id}/PlaybackInfo` then construct stream URL from response |
| Progress reporting | `POST /Sessions/Playing`, `POST /Sessions/Playing/Progress`, `POST /Sessions/Playing/Stopped` |
| Artwork | `GET /Items/{id}/Images/Primary?fillWidth=300&quality=90&tag={tag}` |

### Playback Embed Approach

For the unified app there are two viable strategies:

**Option A — Embed the existing jellyfin-web player as an iframe** (simplest)
- Point an `<iframe>` at the Jellyfin server's own web client (`/web/#/video?id=...&serverId=...`).
- Zero additional work for codec/subtitle support.
- Limited control over UI branding and integration.

**Option B — Implement playback directly** (recommended for tight integration)
1. Call `POST /Items/{id}/PlaybackInfo` with a `DeviceProfile`. For web, a reasonable minimal profile declares H.264+AAC in MP4/HLS for DirectStream, and HLS transcode as fallback.
2. Inspect the returned `MediaSource` for `SupportsDirectStream` / `SupportsTranscoding` and build the stream URL.
3. Feed the URL to **hls.js** (install separately) if it's an `.m3u8`; otherwise use a `<video>` element directly.
4. For subtitles: embed VTT tracks via `<track>` elements. For ASS/PGS, use `@jellyfin/libass-wasm` and `libpgs` — both are available on npm.
5. Report playback progress via the Sessions endpoints.

A minimal DeviceProfile for Next.js/browser:
```json
{
  "DirectPlayProfiles": [
    { "Type": "Video", "Container": "mp4,mkv,webm", "VideoCodec": "h264,vp8,vp9,av1", "AudioCodec": "aac,mp3,opus,vorbis" }
  ],
  "TranscodingProfiles": [
    { "Type": "Video", "Context": "Streaming", "Protocol": "hls", "Container": "ts", "VideoCodec": "h264", "AudioCodec": "aac", "MaxAudioChannels": "2" }
  ],
  "SubtitleProfiles": [
    { "Format": "vtt", "Method": "External" },
    { "Format": "ass", "Method": "External" },
    { "Format": "ssa", "Method": "External" }
  ]
}
```

### Ticks Gotcha

All position/duration values from the Jellyfin API are in **ticks** (100-nanosecond units). Convert to seconds: `ticks / 10_000_000`. Convert from seconds: `seconds * 10_000_000`. Store this as a constant; the source uses `TICKS_PER_SECOND = 10_000_000`.

### WebSocket (Optional)

The legacy client opens a WebSocket to `wss://<server>/socket?api_key=<token>&deviceId=<id>` for real-time push notifications (library updates, remote control commands, playback sync). For a basic unified frontend this is optional — polling or React Query's `refetchInterval` can cover most use cases. Implement WebSocket only if real-time "now playing" status or remote control is needed.

### What Not to Reuse

- `cardBuilder.js` — legacy HTML string generator; skip it entirely and build your own React card component.
- `controllers/` — legacy jQuery-era page controllers backed by HTML templates; not portable to React/Next.js.
- `playbackmanager.js` — deeply coupled to the plugin architecture; extract only the API call patterns from it.
- `browserDeviceProfile.js` — can be adapted for device profile generation but the browser detection logic is unnecessary in Next.js if you control your target environment.
