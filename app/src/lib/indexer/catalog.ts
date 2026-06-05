import type { IndexerDefinition } from './types'

// Public indexers that need no account and can be seeded automatically.
export const PUBLIC_INDEXER_CATALOG: IndexerDefinition[] = [
  {
    name: 'YTS',
    description: 'High-quality movie torrents. No account required.',
    search_type: 'yts',
    base_url: 'https://yts.mx',
    torznab_url: '',
    api_key: '',
    requires_auth: false,
    requires_flaresolverr: false,
    pending_credentials: null,
  },
  {
    name: 'EZTV',
    description: 'TV show releases. Requires IMDB ID for reliable search. No account required.',
    search_type: 'eztv',
    base_url: 'https://eztv.re',
    torznab_url: '',
    api_key: '',
    requires_auth: false,
    requires_flaresolverr: false,
    pending_credentials: null,
  },
  {
    name: 'Nyaa',
    description: 'Anime and Japanese media tracker. No account required.',
    search_type: 'nyaa',
    base_url: 'https://nyaa.si',
    torznab_url: '',
    api_key: '',
    requires_auth: false,
    requires_flaresolverr: false,
    pending_credentials: null,
  },
]

// Indexers that require an account/API key — surfaced as "pending" in the admin UI.
export const PENDING_INDEXER_CATALOG: IndexerDefinition[] = [
  {
    name: 'IPTorrents',
    description: 'Large private tracker. Requires account + passkey.',
    search_type: 'torznab',
    base_url: 'https://iptorrents.com',
    torznab_url: '',
    api_key: '',
    requires_auth: true,
    requires_flaresolverr: false,
    pending_credentials: { torznab_url: 'Torznab URL (from Prowlarr/Jackett)', api_key: 'API Key' },
  },
  {
    name: 'TorrentLeech',
    description: 'UK-based private tracker. Requires account.',
    search_type: 'torznab',
    base_url: 'https://torrentleech.org',
    torznab_url: '',
    api_key: '',
    requires_auth: true,
    requires_flaresolverr: false,
    pending_credentials: { torznab_url: 'Torznab URL (from Prowlarr/Jackett)', api_key: 'API Key' },
  },
]
