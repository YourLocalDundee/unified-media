# Seerr Codebase Analysis

> Source: `/home/minijoe/dev/unified-frontend/sources/seerr`  
> Commit analyzed: HEAD (May 2026)  
> Purpose: Architecture reference for building a unified Next.js frontend that merges Seerr, Jellyfin, and qBittorrent.

---

## Tech Stack

### Runtime / Framework
| Layer | Technology | Version |
|---|---|---|
| Frontend framework | Next.js (Pages Router) | 16.2.6 |
| React | react / react-dom | 19.2.6 |
| Language | TypeScript | 5.4.5 |
| Package manager | pnpm | 10.24.0 |
| Node requirement | >=22.19.0 | — |

### Backend
| Layer | Technology | Notes |
|---|---|---|
| HTTP server | Express | 5.2.1 — runs alongside Next.js |
| ORM | TypeORM | 0.3.29 |
| Primary DB | SQLite | via `sqlite3` (default) |
| Alt DB | PostgreSQL | via `pg` (compose.postgres.yaml) |
| Session store | `connect-typeorm` | session entity stored in DB |
| Schema validation | Zod (v4) | server-side input validation |
| Job scheduling | `node-schedule` | background sync jobs |

### Key Frontend Libraries
| Library | Purpose |
|---|---|
| SWR 2.4.1 | Data fetching / caching (primary state layer) |
| `swr/infinite` | Infinite scroll pagination for discover/lists |
| `react-intl` + `@formatjs/intl` | i18n (40+ locales) |
| Tailwind CSS 3.4 | Styling |
| `@headlessui/react` | Accessible modal / dropdown / transition primitives |
| `@heroicons/react` | Icons |
| `react-hot-toast` | Toast notifications |
| `axios` 1.15 | HTTP client for API calls from components |
| Formik + Yup | Settings / form validation on some forms |

### Build / Dev Tooling
- `nodemon` dev server watches `server/` and hot-reloads the Express backend
- `ts-node` with `tsconfig-paths` for server-side TypeScript execution
- `tsc-alias` resolves TypeScript path aliases (`@server/`, `@app/`) after compilation
- Next.js Turbopack experimental (SVG via `@svgr/webpack`)
- Cypress 15 for e2e tests

---

## Directory Structure

```
seerr/
├── server/                     # Express backend (TypeScript, compiled to dist/)
│   ├── api/                    # External API clients
│   │   ├── externalapi.ts      # Base class with rate limiting, caching, proxy support
│   │   ├── jellyfin.ts         # Jellyfin/Emby API client
│   │   ├── plexapi.ts          # Plex library API
│   │   ├── plextv.ts           # Plex.tv account / watchlist API
│   │   ├── themoviedb/         # TMDB client (search, discover, details, images)
│   │   ├── tvdb/               # TVDB client
│   │   ├── servarr/            # Radarr + Sonarr base + specific clients
│   │   │   ├── base.ts         # ServarrBase class: profiles, root folders, queue, tags
│   │   │   ├── radarr.ts       # RadarrAPI
│   │   │   └── sonarr.ts       # SonarrAPI
│   │   ├── rating/             # IMDB / Rotten Tomatoes rating proxies
│   │   ├── tautulli.ts         # Tautulli watch stats
│   │   ├── animelist.ts        # Anime list ID mapping
│   │   ├── github.ts           # GitHub releases (version check)
│   │   └── pushover.ts         # Pushover notifications
│   ├── constants/              # Shared enums (MediaStatus, MediaType, Permission, etc.)
│   ├── entity/                 # TypeORM entities (DB schema)
│   │   ├── Media.ts            # Core media item (movies + TV)
│   │   ├── MediaRequest.ts     # Request entity + business logic
│   │   ├── Season.ts           # TV season availability tracking
│   │   ├── SeasonRequest.ts    # Per-season request status
│   │   ├── User.ts             # User entity + quota logic
│   │   ├── UserSettings.ts     # Per-user notification/display prefs
│   │   ├── UserPushSubscription.ts  # Web Push subscriptions
│   │   ├── Issue.ts            # Media issue reports
│   │   ├── IssueComment.ts     # Comments on issues
│   │   ├── Watchlist.ts        # User watchlist items
│   │   ├── Blocklist.ts        # Blocked media
│   │   ├── DiscoverSlider.ts   # Configurable discover page sliders
│   │   └── OverrideRule.ts     # Quality profile override rules
│   ├── interfaces/api/         # TypeScript response shape interfaces
│   ├── lib/
│   │   ├── settings/           # Settings singleton (JSON file-backed config)
│   │   ├── permissions.ts      # Permission bitmask enum + hasPermission()
│   │   ├── notifications/      # Notification manager + per-agent handlers
│   │   ├── scanners/           # Library sync scanners
│   │   │   ├── jellyfin/       # Jellyfin/Emby library scanner
│   │   │   ├── plex/           # Plex library scanner
│   │   │   ├── radarr/         # Radarr availability sync
│   │   │   └── sonarr/         # Sonarr availability sync
│   │   ├── cache.ts            # node-cache manager (named caches per service)
│   │   ├── downloadtracker.ts  # Polls Radarr/Sonarr queues for download progress
│   │   └── search.ts           # Search provider detection (IMDB/TVDB URL patterns)
│   ├── middleware/
│   │   ├── auth.ts             # checkUser (API key or session) + isAuthenticated()
│   │   └── deprecation.ts      # Deprecation header middleware
│   ├── migration/              # TypeORM migrations (postgres/ and sqlite/)
│   ├── models/                 # Data mappers (TMDB raw → app types)
│   │   ├── Search.ts           # mapMovieResult, mapTvResult, etc.
│   │   ├── Movie.ts            # mapMovieDetails
│   │   ├── Tv.ts               # mapTvDetails
│   │   ├── Collection.ts
│   │   ├── Person.ts
│   │   └── common.ts           # mapWatchProviderDetails
│   ├── routes/                 # Express route handlers (one file per resource)
│   │   ├── index.ts            # Router root, mounts all sub-routes
│   │   ├── auth.ts             # /auth/*
│   │   ├── request.ts          # /request/*
│   │   ├── media.ts            # /media/*
│   │   ├── movie.ts            # /movie/*
│   │   ├── tv.ts               # /tv/*
│   │   ├── search.ts           # /search/*
│   │   ├── discover.ts         # /discover/*
│   │   ├── watchlist.ts        # /watchlist/*
│   │   ├── blocklist.ts        # /blocklist/*
│   │   ├── issue.ts            # /issue/*
│   │   ├── issueComment.ts     # /issueComment/*
│   │   ├── collection.ts       # /collection/*
│   │   ├── person.ts           # /person/*
│   │   ├── service.ts          # /service/* (Radarr/Sonarr server details)
│   │   ├── overrideRule.ts     # /overrideRule/*
│   │   ├── avatarproxy.ts      # /avatarproxy/* (Jellyfin avatar images)
│   │   ├── imageproxy.ts       # /imageproxy/* (TMDB/TVDB image caching)
│   │   ├── user/               
│   │   │   ├── index.ts        # /user/* (CRUD, quota, watchlist, import)
│   │   │   └── usersettings.ts # /user/:id/settings/*
│   │   └── settings/           
│   │       ├── index.ts        # /settings/* admin config
│   │       ├── notifications.ts
│   │       ├── radarr.ts
│   │       ├── sonarr.ts
│   │       ├── metadata.ts
│   │       └── discover.ts
│   ├── subscriber/             # TypeORM event subscribers (request -> *arr dispatch)
│   ├── job/schedule.ts         # Cron job registry
│   ├── index.ts                # Server entry: Express + Next.js custom server
│   └── datasource.ts           # TypeORM DataSource config
│
├── src/                        # Next.js frontend (Pages Router)
│   ├── pages/                  # Routes (file-system based)
│   │   ├── _app.tsx            # App shell: providers, i18n, SWR config
│   │   ├── _document.tsx       # HTML document
│   │   ├── index.tsx           # / → Discover (dashboard)
│   │   ├── search.tsx          # /search?query=...
│   │   ├── setup.tsx           # /setup (first-run wizard)
│   │   ├── login/              # /login, /login/plex
│   │   ├── movie/[movieId]/    # /movie/:id
│   │   ├── tv/[tvId]/          # /tv/:id
│   │   ├── collection/[collectionId]/
│   │   ├── person/[personId]/
│   │   ├── requests/           # /requests (request list)
│   │   ├── issues/[issueId]/   # /issues/:id
│   │   ├── blocklist/          # /blocklist
│   │   ├── discover/movies/    # /discover/movies (filterable)
│   │   ├── discover/tv/        # /discover/tv (filterable)
│   │   ├── users/[userId]/     # /users/:id
│   │   ├── profile/            # /profile (own profile)
│   │   ├── settings/           # /settings/* (admin panel pages)
│   │   └── resetpassword/[guid]/
│   ├── components/             # React components (see Frontend Architecture section)
│   ├── context/                # React context providers
│   │   ├── UserContext.tsx     # Session guard + redirect to /login
│   │   ├── SettingsContext.tsx # Public settings (SWR-backed)
│   │   ├── LanguageContext.tsx # Locale switching
│   │   └── InteractionContext.tsx # Touch/pointer detection
│   ├── hooks/                  # Custom hooks
│   ├── i18n/locale/            # Translation JSON files (40+ languages)
│   ├── styles/globals.css      # Tailwind base + custom overrides
│   ├── types/                  # Frontend-specific TypeScript types
│   └── utils/                  # Helper utilities
│
├── next.config.ts              # Next.js config (image domains, turbopack SVG)
├── tailwind.config.js          # Tailwind config with custom theme
├── tsconfig.json               # Frontend TS config (paths: @app/ → src/)
├── server/tsconfig.json        # Backend TS config (paths: @server/ → server/)
├── seerr-api.yml               # OpenAPI 3.0 spec (full REST API documentation)
├── package.json                # Monorepo-style: both frontend and backend in one package
└── pnpm-lock.yaml
```

---

## API Endpoints

All API endpoints are under `/api/v1/`. The Express server mounts at this prefix alongside Next.js.

### Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/me` | Session | Get current user |
| POST | `/auth/plex` | None | Login with Plex auth token |
| POST | `/auth/jellyfin` | None | Login with Jellyfin credentials (also used for first-run setup) |
| POST | `/auth/local` | None | Login with email/password |
| POST | `/auth/logout` | Session | Logout; destroys session + removes Jellyfin device |
| POST | `/auth/reset-password` | None | Request password reset email |
| POST | `/auth/reset-password/:guid` | None | Confirm password reset with GUID |

### Search — `/api/v1/search`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/search?query=&page=&language=` | Session | Multi-search (movies, TV, people, collections). Supports IMDB/TVDB URL pattern shortcuts |
| GET | `/search/keyword?query=&page=` | Session | Search TMDB keywords |
| GET | `/search/company?query=&page=` | Session | Search production companies |

### Requests — `/api/v1/request`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/request?take=&skip=&filter=&sort=&sortDirection=&requestedBy=&mediaType=` | Session | Paginated request list. Filters: `approved`, `pending`, `unavailable`, `failed`, `completed`, `available`, `deleted` |
| POST | `/request` | Session | Create media request. Body: `MediaRequestBody` |
| GET | `/request/count` | Session | Summary counts: total, movie, tv, pending, approved, declined, processing, available, completed |
| GET | `/request/:requestId` | Session | Single request (requires ownership or `REQUEST_VIEW` permission) |
| PUT | `/request/:requestId` | Session | Edit request (server, profile, root folder, seasons, tags) |
| DELETE | `/request/:requestId` | Session | Cancel/delete request |
| POST | `/request/:requestId/retry` | `MANAGE_REQUESTS` | Retry a failed request |
| POST | `/request/:requestId/pending` | `MANAGE_REQUESTS` | Set request back to pending |
| POST | `/request/:requestId/approve` | `MANAGE_REQUESTS` | Approve request (triggers *arr dispatch) |
| POST | `/request/:requestId/decline` | `MANAGE_REQUESTS` | Decline request |

### Media — `/api/v1/media`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/media?take=&skip=&filter=&sort=` | Session | Paginated media items. Filters: `available`, `partial`, `allavailable`, `processing`, `pending` |
| POST | `/media/:id/:status` | `MANAGE_REQUESTS` | Manually set media status (`available`, `partial`, `processing`, `pending`, `unknown`) |
| DELETE | `/media/:id` | `MANAGE_REQUESTS` | Delete media record |
| DELETE | `/media/:id/file?is4k=` | `MANAGE_REQUESTS` | Delete file from Radarr/Sonarr |
| GET | `/media/:id/watch_data` | `ADMIN` | Tautulli watch stats for media item |

### Movies — `/api/v1/movie`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/movie/:id?language=` | Session | Movie details + media status + watchlist check |
| GET | `/movie/:id/recommendations?page=&language=` | Session | TMDB recommendations |
| GET | `/movie/:id/similar?page=&language=` | Session | TMDB similar movies |
| GET | `/movie/:id/ratings` | Session | IMDB + Rotten Tomatoes ratings |

### TV — `/api/v1/tv`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tv/:id?language=` | Session | TV series details + media status + watchlist check |
| GET | `/tv/:id/season/:season?language=` | Session | Season details with episode list |
| GET | `/tv/:id/recommendations?page=&language=` | Session | TMDB recommendations |
| GET | `/tv/:id/similar?page=&language=` | Session | TMDB similar series |
| GET | `/tv/:id/ratings` | Session | Rotten Tomatoes TV ratings |

### Discover — `/api/v1/discover`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/discover/movies?page=&sortBy=&genre=&studio=&keywords=&language=&...` | Session | Discover movies with full filter suite |
| GET | `/discover/movies/upcoming?page=&language=` | Session | Upcoming movies |
| GET | `/discover/movies/nowplaying?page=&language=` | Session | Now playing movies |
| GET | `/discover/tv?page=&sortBy=&genre=&network=&...` | Session | Discover TV with full filter suite |
| GET | `/discover/tv/upcoming?page=&language=` | Session | TV airing today |
| GET | `/discover/trending?page=&language=` | Session | Trending all media |
| GET | `/discover/watchlist?page=` | Session | Current user's watchlist (Plex or DB) |
| GET | `/discover/genreslider/movie` | Session | Genre slider items for movies |
| GET | `/discover/genreslider/tv` | Session | Genre slider items for TV |
| GET | `/discover/studios/:studioId` | Session | Movies by studio |
| GET | `/discover/networks/:networkId` | Session | TV by network |
| GET | `/discover/keywords/:keywordId/movies` | Session | Movies by keyword |
| GET | `/discover/keywords/:keywordId/tv` | Session | TV by keyword |

### Users — `/api/v1/user`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/user?take=&skip=&sort=&sortDirection=&q=` | `MANAGE_USERS` | Paginated user list with search |
| POST | `/user` | `MANAGE_USERS` | Create local user |
| PUT | `/user` | `MANAGE_USERS` | Bulk update permissions |
| GET | `/user/:id` | Session | Get user by ID |
| GET | `/user/jellyfin/:jellyfinUserId` | Session | Get user by Jellyfin user ID |
| PUT | `/user/:id` | `MANAGE_USERS` | Update user (username, permissions) |
| DELETE | `/user/:id` | `MANAGE_USERS` | Delete user |
| GET | `/user/:id/requests?take=&skip=` | Session | User's request history |
| GET | `/user/:id/quota` | Session or `MANAGE_USERS+MANAGE_REQUESTS` | User request quota status |
| GET | `/user/:id/watchlist?page=` | Session | User's watchlist (DB or Plex) |
| GET | `/user/:id/watch_data` | Own profile or admin | Tautulli watch history |
| POST | `/user/import-from-plex` | `MANAGE_USERS` | Bulk import Plex users |
| POST | `/user/import-from-jellyfin` | `MANAGE_USERS` | Bulk import Jellyfin users |
| POST | `/user/registerPushSubscription` | Session | Register Web Push subscription |
| GET | `/user/:id/pushSubscriptions` | Own or admin | List push subscriptions |
| GET | `/user/:id/pushSubscription/:endpoint` | Own or admin | Single push subscription |
| DELETE | `/user/:id/pushSubscription/:endpoint` | Own or admin | Remove push subscription |

### User Settings — `/api/v1/user/:id/settings`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/user/:id/settings/main` | Own or admin | Get user display/notification settings |
| POST | `/user/:id/settings/main` | Own or admin | Update user settings |
| GET | `/user/:id/settings/notifications` | Own or admin | Get notification type settings |
| POST | `/user/:id/settings/notifications` | Own or admin | Update notification settings |
| GET | `/user/:id/settings/password` | Own | Check if user has password set |
| POST | `/user/:id/settings/password` | Own | Change password |

### Watchlist — `/api/v1/watchlist`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/watchlist` | Session | Add item to watchlist. Body: `{ tmdbId, mediaType, title?, ratingKey? }` |
| DELETE | `/watchlist/:tmdbId?mediaType=` | Session | Remove item from watchlist |

### Blocklist — `/api/v1/blocklist`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/blocklist?take=&skip=&search=&filter=` | `MANAGE_BLOCKLIST` or `VIEW_BLOCKLIST` | Paginated blocklist |
| POST | `/blocklist` | `MANAGE_BLOCKLIST` | Block a title |
| DELETE | `/blocklist/:tmdbId?mediaType=` | `MANAGE_BLOCKLIST` | Remove from blocklist |

### Issues — `/api/v1/issue`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/issue?take=&skip=&filter=&sort=&createdBy=` | `MANAGE_ISSUES`, `VIEW_ISSUES`, or `CREATE_ISSUES` | Paginated issue list |
| POST | `/issue` | Session (`CREATE_ISSUES`) | Create issue report |
| GET | `/issue/:issueId` | Session | Get single issue |
| PUT | `/issue/:issueId` | Own or `MANAGE_ISSUES` | Update issue |
| DELETE | `/issue/:issueId` | `MANAGE_ISSUES` | Delete issue |
| POST | `/issue/:issueId/:status` | `MANAGE_ISSUES` | Set issue status (`open`, `resolved`) |

### Issue Comments — `/api/v1/issueComment`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/issueComment/:commentId` | Session | Get single comment |
| PUT | `/issueComment/:commentId` | Own or `MANAGE_ISSUES` | Update comment |
| DELETE | `/issueComment/:commentId` | Own or `MANAGE_ISSUES` | Delete comment |
| POST | `/issue/:issueId/comment` | Session | Add comment to issue |

### Service (DVR servers) — `/api/v1/service`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/service/radarr` | Session | List configured Radarr servers (summary) |
| GET | `/service/radarr/:radarrId` | Session | Radarr server details: profiles, root folders, tags |
| GET | `/service/sonarr` | Session | List configured Sonarr servers (summary) |
| GET | `/service/sonarr/:sonarrId` | Session | Sonarr server details: profiles, root folders, language profiles, tags |
| GET | `/service/sonarr/lookup/:tmdbId` | Session | Look up TVDB series in Sonarr |

### Settings — `/api/v1/settings` (all require `ADMIN`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/settings/public` | None | Public app settings (media server type, feature flags) |
| GET | `/settings/discover` | Session | Discover slider configuration |
| GET | `/settings/notifications/pushover/sounds` | Session | Pushover sound list |
| GET/POST | `/settings/main` | Admin | Main app settings |
| GET/POST | `/settings/plex` | Admin | Plex configuration |
| GET/POST | `/settings/jellyfin` | Admin | Jellyfin/Emby configuration |
| GET/POST | `/settings/radarr` | Admin | Radarr server management |
| GET/POST | `/settings/sonarr` | Admin | Sonarr server management |
| GET/POST | `/settings/notifications/*` | Admin | Per-agent notification settings |
| GET/POST | `/settings/metadata` | Admin | Metadata provider preferences |
| GET | `/settings/logs` | Admin | Server log stream |
| GET | `/settings/jobs` | Admin | Scheduled job status |
| GET/POST | `/settings/discover` | Admin | Discover slider CRUD |
| GET | `/settings/about` | Admin | Version info, total requests/media count |
| GET/POST | `/settings/cache` | Admin | Cache stats + invalidation |

### Misc — `/api/v1/`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/status` | None | Version, update available, commits behind |
| GET | `/status/appdata` | None | AppData volume status |
| GET | `/regions` | Session | TMDB regions list |
| GET | `/languages` | Session | TMDB languages list |
| GET | `/genres/movie` | Session | TMDB movie genres |
| GET | `/genres/tv` | Session | TMDB TV genres |
| GET | `/studio/:id` | None | Studio details |
| GET | `/network/:id` | None | TV network details |
| GET | `/keyword/:keywordId` | None | Keyword details |
| GET | `/backdrops` | None | Trending backdrop images (for login page) |
| GET | `/watchproviders/regions` | None | Available watch provider regions |
| GET | `/watchproviders/movies?watchRegion=` | None | Movie watch providers |
| GET | `/watchproviders/tv?watchRegion=` | None | TV watch providers |
| GET | `/certifications/movie` | Session | TMDB movie certifications |
| GET | `/certifications/tv` | Session | TMDB TV certifications |
| GET | `/collection/:id?language=` | Session | TMDB collection details |
| GET | `/person/:id?language=` | Session | Person details |
| GET | `/person/:id/combined_credits?language=` | Session | Person combined credits |
| GET | `/overrideRule` | Admin | List override rules |
| POST | `/overrideRule` | Admin | Create override rule |
| DELETE | `/overrideRule/:id` | Admin | Delete override rule |

---

## Key Data Models

### Enums

```typescript
// server/constants/media.ts
enum MediaRequestStatus { PENDING = 1, APPROVED, DECLINED, FAILED, COMPLETED }
enum MediaType { MOVIE = 'movie', TV = 'tv' }
enum MediaStatus {
  UNKNOWN = 1, PENDING, PROCESSING,
  PARTIALLY_AVAILABLE, AVAILABLE, BLOCKLISTED, DELETED
}

// server/constants/server.ts
enum MediaServerType { PLEX = 1, JELLYFIN, EMBY, NOT_CONFIGURED }

// server/constants/user.ts
enum UserType { PLEX = 1, LOCAL, JELLYFIN, EMBY }
```

### Permission Bitmask

```typescript
// server/lib/permissions.ts — stored as integer on User.permissions
enum Permission {
  NONE = 0, ADMIN = 2, MANAGE_SETTINGS = 4, MANAGE_USERS = 8,
  MANAGE_REQUESTS = 16, REQUEST = 32, VOTE = 64,
  AUTO_APPROVE = 128, AUTO_APPROVE_MOVIE = 256, AUTO_APPROVE_TV = 512,
  REQUEST_4K = 1024, REQUEST_4K_MOVIE = 2048, REQUEST_4K_TV = 4096,
  REQUEST_ADVANCED = 8192, REQUEST_VIEW = 16384,
  AUTO_APPROVE_4K = 32768, AUTO_APPROVE_4K_MOVIE = 65536, AUTO_APPROVE_4K_TV = 131072,
  REQUEST_MOVIE = 262144, REQUEST_TV = 524288,
  MANAGE_ISSUES = 1048576, VIEW_ISSUES = 2097152, CREATE_ISSUES = 4194304,
  AUTO_REQUEST = 8388608, AUTO_REQUEST_MOVIE = 16777216, AUTO_REQUEST_TV = 33554432,
  RECENT_VIEW = 67108864, WATCHLIST_VIEW = 134217728,
  MANAGE_BLOCKLIST = 268435456, VIEW_BLOCKLIST = 1073741824,
}
```

### Media Entity (TypeORM)

```typescript
// server/entity/Media.ts
class Media {
  id: number;
  mediaType: MediaType;          // 'movie' | 'tv'
  tmdbId: number;
  tvdbId?: number;
  imdbId?: string;
  status: MediaStatus;           // standard quality
  status4k: MediaStatus;         // 4K quality
  requests: MediaRequest[];
  watchlists: Watchlist[] | null;
  seasons: Season[];             // TV only
  issues: Issue[];
  blocklist: Promise<Blocklist>;
  createdAt: Date;
  updatedAt: Date;
  lastSeasonChange: Date;
  mediaAddedAt: Date;
  serviceId?: number;            // Radarr/Sonarr server ID
  serviceId4k?: number;
  externalServiceId?: number;    // Movie/series ID within *arr
  externalServiceId4k?: number;
  externalServiceSlug?: string;  // URL slug in Radarr/Sonarr
  externalServiceSlug4k?: string;
  ratingKey?: string;            // Plex rating key
  ratingKey4k?: string;
  jellyfinMediaId?: string;      // Jellyfin item ID
  jellyfinMediaId4k?: string;
  // Computed at load:
  serviceUrl?: string;           // Link to Radarr/Sonarr
  serviceUrl4k?: string;
  mediaUrl?: string;             // Link to Plex/Jellyfin player
  mediaUrl4k?: string;
  downloadStatus?: DownloadingItem[];   // Live download progress
  downloadStatus4k?: DownloadingItem[];
}
```

### MediaRequest Entity

```typescript
// server/entity/MediaRequest.ts
class MediaRequest {
  id: number;
  status: MediaRequestStatus;
  media: Media;
  requestedBy: User;
  modifiedBy?: User;
  createdAt: Date;
  updatedAt: Date;
  type: MediaType;
  seasons: SeasonRequest[];      // TV only
  seasonCount: number;
  is4k: boolean;
  serverId: number;              // Target Radarr/Sonarr server
  profileId: number;             // Quality profile ID
  rootFolder: string;
  languageProfileId: number;     // Sonarr only
  tags?: number[];               // *arr tag IDs
  isAutoRequest: boolean;
}
```

### SeasonRequest Entity

```typescript
class SeasonRequest {
  id: number;
  seasonNumber: number;
  status: MediaRequestStatus;
  request: MediaRequest;
  createdAt: Date;
  updatedAt: Date;
}
```

### Season Entity

```typescript
class Season {
  id: number;
  seasonNumber: number;
  status: MediaStatus;           // standard quality availability
  status4k: MediaStatus;
  media: Promise<Media>;
  createdAt: Date;
  updatedAt: Date;
}
```

### User Entity

```typescript
class User {
  id: number;
  email: string;
  plexUsername?: string;
  jellyfinUsername?: string;
  username?: string;
  password?: string;             // bcrypt, select: false
  userType: UserType;
  plexId?: number;
  jellyfinUserId?: string;
  jellyfinDeviceId?: string;     // select: false
  jellyfinAuthToken?: string;    // select: false
  plexToken?: string;            // select: false
  permissions: number;           // Permission bitmask
  avatar: string;
  avatarETag?: string;
  avatarVersion?: string;
  requestCount: number;
  requests: MediaRequest[];
  watchlists: Watchlist[];
  movieQuotaLimit?: number;
  movieQuotaDays?: number;
  tvQuotaLimit?: number;
  tvQuotaDays?: number;
  settings?: UserSettings;
  pushSubscriptions: UserPushSubscription[];
  createdAt: Date;
  updatedAt: Date;
  displayName: string;           // computed: username || plexUsername || jellyfinUsername || email
  warnings: string[];            // transient (e.g. 'userEmailRequired')
}
```

### UserSettings Entity

```typescript
class UserSettings {
  id: number;
  user: User;
  locale?: string;
  region?: string;
  discoverRegion?: string;
  streamingRegion?: string;
  originalLanguage?: string;
  discordId?: string;
  telegramChatId?: string;
  notificationTypes: { [agentKey: string]: number };  // bitmask per agent
  watchlistSyncMovies: boolean;
  watchlistSyncTv: boolean;
}
```

### Watchlist Entity

```typescript
class Watchlist {
  id: number;
  ratingKey: string;    // Plex rating key (empty string if from DB)
  mediaType: MediaType;
  title: string;
  tmdbId: number;
  requestedBy: User;
  media: Media;
  createdAt: Date;
  updatedAt: Date;
}
```

### Issue Entity

```typescript
// server/constants/issue.ts
enum IssueType { VIDEO = 1, AUDIO, SUBTITLE, OTHER }
enum IssueStatus { OPEN = 1, RESOLVED }

class Issue {
  id: number;
  issueType: IssueType;
  status: IssueStatus;
  problemSeason: number;    // 0 = all/N/A
  problemEpisode: number;   // 0 = all/N/A
  media: Media;
  createdBy: User;
  modifiedBy?: User;
  comments: IssueComment[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Search Result Types (API response shapes)

```typescript
// server/models/Search.ts
interface SearchResult {
  id: number;
  mediaType: 'tv' | 'movie' | 'person' | 'collection';
  popularity: number;
  posterPath?: string;
  backdropPath?: string;
  voteCount: number;
  voteAverage: number;
  genreIds: number[];
  overview: string;
  originalLanguage: string;
  mediaInfo?: Media;       // null if not yet requested/tracked
}

interface MovieResult extends SearchResult {
  mediaType: 'movie';
  title: string;
  originalTitle: string;
  releaseDate: string;
  adult: boolean;
}

interface TvResult extends SearchResult {
  mediaType: 'tv';
  name: string;
  originalName: string;
  originCountry: string[];
  firstAirDate: string;
}

interface PersonResult {
  id: number; name: string; popularity: number;
  profilePath?: string; adult: boolean; mediaType: 'person';
  knownFor: (MovieResult | TvResult)[];
}
```

### Settings Interfaces

```typescript
// server/lib/settings/index.ts
interface MainSettings {
  apiKey: string;
  applicationTitle: string;
  applicationUrl: string;
  cacheImages: boolean;
  defaultPermissions: number;
  defaultQuotas: { movie: Quota; tv: Quota };
  hideAvailable: boolean;
  hideBlocklisted: boolean;
  localLogin: boolean;
  mediaServerLogin: boolean;
  newPlexLogin: boolean;
  discoverRegion: string;
  streamingRegion: string;
  originalLanguage: string;
  mediaServerType: MediaServerType;
  // ...
}

interface DVRSettings {
  id: number; name: string; hostname: string; port: number;
  apiKey: string; useSsl: boolean; baseUrl?: string;
  activeProfileId: number; activeDirectory: string;
  is4k: boolean; isDefault: boolean;
  externalUrl?: string; syncEnabled: boolean;
  tagRequests: boolean; overrideRule: number[];
}
```

### Public Settings Response (sent to frontend)

```typescript
// server/interfaces/api/settingsInterfaces.ts
interface PublicSettingsResponse {
  initialized: boolean;
  applicationTitle: string;
  applicationUrl: string;
  hideAvailable: boolean;
  hideBlocklisted: boolean;
  localLogin: boolean;
  mediaServerLogin: boolean;
  movie4kEnabled: boolean;
  series4kEnabled: boolean;
  discoverRegion: string;
  streamingRegion: string;
  originalLanguage: string;
  mediaServerType: number;         // MediaServerType enum value
  partialRequestsEnabled: boolean;
  enableSpecialEpisodes: boolean;
  cacheImages: boolean;
  vapidPublic: string;
  enablePushRegistration: boolean;
  locale: string;
  emailEnabled: boolean;
  newPlexLogin: boolean;
  jellyfinHost?: string;
  jellyfinExternalHost?: string;
  jellyfinServerName?: string;
  jellyfinForgotPasswordUrl?: string;
}
```

---

## Frontend Architecture

### Entry Point / App Shell (`src/pages/_app.tsx`)

The `_app.tsx` does server-side data fetching for the initial user and public settings, then wraps the entire app with:

```
<IntlProvider locale messages>
  <SWRConfig value={{ fetcher }}>
    <SettingsProvider currentSettings>
      <UserContext initialUser>
        <InteractionProvider>
          <LanguageContext>
            <Layout>
              <Component {...pageProps} />
            </Layout>
          </LanguageContext>
        </InteractionProvider>
      </UserContext>
    </SettingsProvider>
  </SWRConfig>
</IntlProvider>
```

### State Management Pattern

There is **no Redux or Zustand**. State is managed through:
- **SWR** for all server data (keyed by API URL string)
- **React Context** for app-level globals (settings, user session, locale, interaction mode)
- **Local `useState`** for component-local UI state (modals open, loading flags)
- **`useSWRInfinite`** for paginated/infinite-scroll lists (discover pages, request lists)
- **`axios`** for mutations (POST/PUT/DELETE), followed by `mutate()` to revalidate SWR cache

### Page Organization (Pages Router)

Pages use Next.js `getServerSideProps` or `getInitialProps` to pre-fetch initial data on the server. The `_app.tsx` `getInitialProps` fetches `/api/v1/auth/me` and `/api/v1/settings/public` for every page load.

| Page | Route | Key Component |
|---|---|---|
| Discover (home) | `/` | `DiscoverMovies`, `DiscoverTv`, `MediaSlider` |
| Movie detail | `/movie/:id` | `MovieDetails` |
| TV detail | `/tv/:id` | `TvDetails` |
| Collection | `/collection/:id` | `CollectionDetails` |
| Person | `/person/:id` | `PersonDetails` |
| Search | `/search?query=` | `Search` component |
| Requests | `/requests` | `RequestList` |
| Issues | `/issues/:id` | `IssueDetails` |
| Blocklist | `/blocklist` | `Blocklist` |
| Users | `/users/:id` | `UserList`, `UserProfile` |
| Settings | `/settings/*` | `Settings/*` sub-components |
| Setup | `/setup` | `Setup` wizard |
| Login | `/login` | `Login` |

### Key Components

**Media Display**
- `TitleCard` — poster card shown in grids/sliders. Handles hover state, watchlist toggle, request modal trigger, status badge overlay.
- `MediaSlider` — horizontal scrollable row of `TitleCard`s backed by `useSWRInfinite`.
- `Slider` — generic touch/mouse draggable horizontal scroll container (likely wraps the scroll logic).
- `PersonCard`, `GenreCard`, `CompanyCard` — card variants for people, genres, studios.

**Request Flow**
- `RequestButton` — the primary CTA button on detail pages. Shows status, triggers `RequestModal`.
- `RequestModal` — dispatcher that renders `MovieRequestModal`, `TvRequestModal`, or `CollectionRequestModal` depending on type.
- `RequestModal/AdvancedRequester` — quality profile / root folder / tags selector for users with `REQUEST_ADVANCED`.
- `RequestModal/QuotaDisplay` — shows remaining quota to the user before submitting.
- `RequestCard` — compact card shown in the requests list.

**Layout**
- `Layout/Sidebar` — navigation sidebar. Links: Discover, Movies, Series, Requests, Blocklist, Issues, Users, Settings. Shows permission-gated items. Includes pending request count badge.
- `Layout/SearchInput` — debounced search input that routes to `/search?query=`.
- `Layout/UserDropdown` — avatar + logout.
- `Layout/Notifications` — notification bell with live count.
- `Layout/MobileMenu` — mobile nav overlay.

**Detail Pages**
- `MovieDetails`, `TvDetails` — full detail view with backdrop hero, cast/crew sections, download status, media links, request status, issues, related sliders.
- `DownloadBlock` — shows current download progress from Radarr/Sonarr.
- `ExternalLinkBlock` — links to Plex/Jellyfin player, Radarr/Sonarr service page, IMDB/TMDB.
- `ManageSlideOver` — admin slide-over for manual status changes, deletion, file removal.
- `IssueBlock`, `IssueModal` — issue reporting on detail pages.

**Discover**
- `Discover/*` — page-level components for each discover mode (movies by genre, by keyword, by language, trending, etc.).
- `FilterSlideover` — full-screen filter panel for discover pages (genre, year range, runtime, rating, etc.).

**Common UI**
- `Modal` — portal-based accessible modal with primary/secondary/cancel actions.
- `SlideOver` — side panel that slides in from the right (used for ManageSlideOver, FilterSlideover).
- `Badge` — small status indicator.
- `StatusBadge`, `StatusBadgeMini` — colored badge encoding `MediaStatus`.
- `CachedImage` — Next.js `<Image>` wrapper that optionally rewrites TMDB/TVDB URLs to `/imageproxy/` for local caching.
- `Button`, `ButtonWithDropdown`, `ConfirmButton` — button variants.
- `Table`, `List`, `ListView` — data display.
- `Alert`, `Toast` — feedback components.
- `LoadingSpinner`, `LoadingBar` — loading states.

### i18n

Uses `react-intl`. All user-facing strings are defined via a custom `defineMessages` utility in each component file. Locale JSON files live in `src/i18n/locale/` (40+ languages). The locale is determined server-side from user settings and passed to `_app.tsx` via `getInitialProps`.

---

## External Service Integrations

### TMDB (The Movie Database)
- **File:** `server/api/themoviedb/index.ts`
- Base: `ExternalAPI` with node-cache caching and axios
- Used for: all search, discover, movie/TV details, genres, regions, certifications, watch providers, keywords, collections, people
- Auth: API key in settings, passed as query param `api_key`
- Image base URL: `https://image.tmdb.org/t/p/{size}{path}`

### Jellyfin / Emby
- **File:** `server/api/jellyfin.ts`
- Used for: login auth, user management (import, avatar), library scanning
- Auth: `X-Emby-Authorization` header with `MediaBrowser Client="Seerr"` format; API key created on first login
- Key operations: `login()`, `getUsers()`, `getLibraries()`, `getItems()`, `getItemData()`, `createApiToken()`, `getServerName()`
- Scanner: `server/lib/scanners/jellyfin/` syncs library items to `Media` entities, resolving TMDB IDs from provider IDs (Tmdb, Imdb, AniDB)

### Plex
- **Files:** `server/api/plexapi.ts` (library), `server/api/plextv.ts` (account)
- `PlexTvAPI`: login, user management, watchlist access — auth via `X-Plex-Token`
- `PlexAPI`: library scanning — auth via token + `X-Plex-Client-Identifier`
- Scanner: `server/lib/scanners/plex/`

### Radarr
- **File:** `server/api/servarr/radarr.ts`
- Endpoints used: `/api/v3/movie`, `/api/v3/qualityprofile`, `/api/v3/rootfolder`, `/api/v3/tag`, `/api/v3/queue`
- Auth: `X-Api-Key` header
- Used for: adding movies on request approval, monitoring download progress, looking up existing movies
- URL builder: `RadarrAPI.buildUrl(settings, path)` → `{http|https}://hostname:port{baseUrl}{path}`

### Sonarr
- **File:** `server/api/servarr/sonarr.ts`
- Endpoints used: `/api/v3/series`, `/api/v3/qualityprofile`, `/api/v3/rootfolder`, `/api/v3/languageprofile`, `/api/v3/tag`, `/api/v3/queue`
- Auth: `X-Api-Key` header
- Supports v3 and v4 (language profiles removed in v4)

### TVDB
- **File:** `server/api/tvdb/`
- Used for TV metadata when `MetadataSettings.tv = 'tvdb'` or `anime = 'tvdb'`

### Tautulli
- **File:** `server/api/tautulli.ts`
- Used for: watch statistics per media item and per user (play counts, recent history)
- Only accessed from admin-gated endpoints

### Pushover
- **File:** `server/api/pushover.ts`
- Used for push notifications to Pushover

### AniDB / Anime List
- **File:** `server/api/animelist.ts`
- Local ID mapping file for anime (AniDB → TMDB/IMDB)

### Rating Providers
- **Files:** `server/api/rating/imdbRadarrProxy.ts`, `server/api/rating/rottentomatoes.ts`
- IMDB ratings proxied through Radarr's embedded rating API
- Rotten Tomatoes scraped directly (no official API)

---

## Reusable Components / Hooks

### Hooks Worth Extracting

| Hook | File | What it does |
|---|---|---|
| `useUser` | `src/hooks/useUser.ts` | SWR-backed current user + `hasPermission()` helper |
| `useSettings` | `src/hooks/useSettings.ts` | Access `SettingsContext` (public app config) |
| `useDiscover` | `src/hooks/useDiscover.ts` | `useSWRInfinite` wrapper for paginated discover/search lists. Handles dedup, `hideAvailable` filtering, `hideBlocklisted` filtering |
| `useDebouncedState` | `src/hooks/useDebouncedState.ts` | Debounce for search inputs |
| `useSearchInput` | `src/hooks/useSearchInput.ts` | Search input with router integration |
| `useClickOutside` | `src/hooks/useClickOutside.ts` | Close dropdowns/modals on outside click |
| `useLockBodyScroll` | `src/hooks/useLockBodyScroll.ts` | Prevent scroll behind modals |
| `useIsTouch` | `src/hooks/useIsTouch.ts` | Detect touch device for hover vs tap interactions |
| `useToasts` | `src/hooks/useToasts.tsx` | Toast notification queue |
| `useUpdateQueryParams` | `src/hooks/useUpdateQueryParams.ts` | Update URL query string without page reload |
| `useRouteGuard` | `src/hooks/useRouteGuard.ts` | Redirect unauthenticated users |
| `useDeepLinks` | `src/hooks/useDeepLinks.ts` | Plex iOS deep link construction |

### Components Worth Extracting

| Component | Description |
|---|---|
| `TitleCard` | Core media card. Self-contained watchlist toggle, request modal trigger, status overlay. Props: `{ id, image, title, year, mediaType, status, summary, inProgress, isAddedToWatchlist }` |
| `MediaSlider` | Horizontal infinite-scroll slider. Props: `{ title, url, linkUrl, sliderKey, extraParams }` |
| `RequestModal` | Full request flow modal (movie/TV/collection). Props: `{ show, type, tmdbId, is4k, editRequest, onComplete, onCancel }` |
| `Modal` | Generic accessible modal portal. Up to 4 action buttons (ok/cancel/secondary/tertiary), backdrop image support, scroll lock |
| `SlideOver` | Side panel overlay (used for filters, manage actions) |
| `StatusBadge` / `StatusBadgeMini` | `MediaStatus` → colored label badge |
| `CachedImage` | Image proxy wrapper for TMDB/TVDB images |
| `Button` / `ButtonWithDropdown` | Styled button with `default`, `primary`, `danger`, `warning` types |
| `Badge` | Small colored label |
| `Alert` | Info/warning/error alert box |
| `LoadingSpinner` | Loading indicator |
| `DownloadBlock` | Shows download progress bar from Radarr/Sonarr |
| `ExternalLinkBlock` | Renders media service links (Plex, Jellyfin, *arr, IMDB, TMDB) |
| `PermissionEdit` | Checkbox tree for editing user permission bitmask |
| `QuotaSelector` | Admin UI for setting user quotas |
| `Slider` | Touch/mouse draggable horizontal scroll container |
| `FilterSlideover` | Full discover filter panel (genre, year, runtime, rating, watch provider, certification) |

### Context Providers

| Provider | What to replicate |
|---|---|
| `SettingsProvider` | Wraps `PublicSettingsResponse` from `/api/v1/settings/public` in context with SWR background refresh |
| `UserContext` | Wraps `useUser()` to seed SWR cache on SSR and handle unauthenticated redirects |

---

## Notes for Unified App

### What to Extract Directly

1. **Permission system** — `server/lib/permissions.ts` is a clean, self-contained bitmask system. Copy as-is. The `hasPermission()` function handles arrays, `and`/`or` modes, and admin bypass.

2. **`useUser` hook** — drop-in usable. Just change the SWR endpoint if the unified app exposes seerr's API as a proxy.

3. **`useDiscover` hook** — the generic infinite-scroll pattern is solid and reusable for any paginated endpoint.

4. **`TitleCard` + `RequestModal`** — these two components represent the core UX of the app. Extract them together; `TitleCard` depends on `RequestModal`, both depend on `useUser` + `useSettings`.

5. **`MediaSlider` + `Slider`** — clean abstraction. `MediaSlider` composes `TitleCard` + `Slider` + SWR pagination. Works for any `/api/v1/discover/*` endpoint.

6. **`CachedImage`** — the TMDB image proxy pattern is critical for self-hosting. Port to the unified app's image route.

7. **`Modal` component** — the accessibility patterns (portal, scroll lock, click-outside) are solid. Reuse or adapt.

### What to Rebuild

1. **Auth flow** — seerr's auth ties tightly to Plex/Jellyfin login. In the unified app you likely want an external SSO provider as the primary auth path (matching your BunkerWeb/Headscale stack). Keep the session pattern (`req.session.userId`) but replace the login handlers.

2. **Settings storage** — seerr uses a JSON file on disk (`config/settings.json`) via a singleton. In a unified app, consolidate into a proper config store or environment variables for the merged services.

3. **Server architecture** — seerr runs as a custom Next.js server with Express mounted alongside. This is a good pattern to copy: use Express for your API routes and let Next.js handle the frontend, all on one port.

4. **Discover page sliders** — the `DiscoverSlider` entity lets admins configure the dashboard. For the unified app, expand this concept to include Jellyfin library sections and qBittorrent active torrents as configurable "slider" sources.

5. **i18n** — if you don't need 40 languages, simplify. The `defineMessages` pattern is clean but adds bundle weight. Keep it only if multi-language is a goal.

### API Patterns to Replicate in the Unified App

1. **Auth middleware pattern** — `checkUser` middleware checks `X-API-Key` header first (for programmatic access), then falls back to session cookie. This dual-mode auth is important for the unified app since you'll want both a web UI session and an API key for integrations.

2. **`mediaInfo` embedding in search results** — when returning search results, seerr fetches and embeds the corresponding `Media` entity (if tracked). This single query avoids N+1 on the frontend. Use this pattern when surfacing Jellyfin library status alongside TMDB search results.

3. **Pagination shape** — all paginated endpoints return: `{ pageInfo: { pages, pageSize, results, page }, results: [...] }`. Standardize on this for all unified app list endpoints.

4. **Status dual-tracking (standard + 4K)** — `Media.status` and `Media.status4k` are separate. `MediaRequest.is4k` flags which quality the request is for. If your unified app supports 4K, preserve this split rather than merging them.

5. **TypeORM subscriber pattern** — `server/subscriber/` contains event listeners that fire on `MediaRequest` insert/update to dispatch to Radarr/Sonarr. For the unified app, this is the right place to hook qBittorrent actions (e.g., auto-add a torrent when a request is approved for a source that doesn't use *arr).

6. **Download tracker** — `server/lib/downloadtracker.ts` polls Radarr/Sonarr queues on a background interval and stores progress in memory. The progress is then embedded in `Media` entities via `@AfterLoad`. Extend this to poll qBittorrent's API and expose torrent status the same way.

7. **OpenAPI spec** — `seerr-api.yml` is a full OpenAPI 3.0 spec. Use it as the source of truth for frontend type generation. The unified app should maintain its own spec that extends this.

### Jellyfin Integration Notes (for merging with Jellyfin source)

- Seerr tracks Jellyfin media via `Media.jellyfinMediaId` (UUID string, normalized by `normalizeJellyfinGuid`).
- The `JellyfinScanner` resolves TMDB IDs from Jellyfin provider IDs — this is the bridge between Jellyfin's library and seerr's request tracking. Preserve this logic.
- Jellyfin user login creates a device entry (`BOT_seerr_{username}` base64) that gets deleted on logout.
- The Jellyfin API key is stored in `settings.jellyfin.apiKey` and is created by seerr during first-run setup via `jellyfinClient.createApiToken('Seerr')`.
- The media URL format for Jellyfin: `{host}/web/index.html#!/details?id={jellyfinMediaId}&context=home&serverId={serverId}` (Jellyfin) or `#!/item?id=...` (Emby).

### qBittorrent Integration Gap

Seerr has no qBittorrent integration whatsoever. The download tracking (`downloadtracker.ts`) only polls Radarr/Sonarr queues. To integrate qBittorrent:
- Add a `qBittorrentAPI` client class extending `ExternalAPI` (mirrors Radarr/Sonarr pattern)
- Add a new `DownloadClient` type to settings
- Extend `Media` entity with `torrentHash` / `downloadClientId` fields
- Add a qBittorrent scanner to `lib/scanners/`
- The `/api/v1/media/:id/watch_data` and download status patterns in the frontend (`DownloadBlock`) are the right places to surface torrent-level progress

### Architecture Considerations

- **Monorepo structure**: seerr keeps frontend (`src/`) and backend (`server/`) in the same package with separate tsconfigs and path aliases. This is a good model for the unified app — `@app/` for frontend, `@server/` for backend.
- **Session-based auth vs JWT**: seerr uses express-session with TypeORM session store. If an external SSO provider replaces the login page, you can keep the session store but delegate credential validation to its OAuth2 flow.
- **Image proxy**: `/imageproxy/tmdb/` and `/imageproxy/tvdb/` routes proxy TMDB/TVDB images locally for caching. The `avatarproxy` route proxies Jellyfin user avatars. Both patterns are useful in a unified app for self-hosted image caching behind your reverse proxy.
- **Single Next.js + Express binary**: the production build outputs to `dist/` (server) and `.next/` (frontend), both started by `dist/index.js`. This single-process model works well in Docker and is worth preserving in the unified app.
