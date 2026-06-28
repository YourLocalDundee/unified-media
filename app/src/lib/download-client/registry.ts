// Download client singleton registry.
// The client is created lazily on first getClient() call and cached, so the same
// instance (and its shared UMT SID cache inside QBittorrentClient) is returned to
// every caller. Lazy creation also means an unsupported DOWNLOAD_CLIENT selection
// fails with a clear, descriptive error at the point of use rather than crashing
// unrelated import-time code paths.
import { getDownloadClientConfig } from './config'
import type { DownloadClient } from './types'
import { QBittorrentClient } from './qbittorrent'
import { TransmissionClient } from './transmission'
import { DelugeClient } from './deluge'

// All three backends now implement the DownloadClient interface. Kept as the single
// gate so UI/behaviour can still cheaply ask "is the configured client real?" before
// showing a torrent-management surface that assumes a working backend.
const IMPLEMENTED_CLIENTS = new Set(['umt', 'transmission', 'deluge'])

export function isDownloadClientImplemented(): boolean {
  return IMPLEMENTED_CLIENTS.has(getDownloadClientConfig().type)
}

function createClient(): DownloadClient {
  const config = getDownloadClientConfig()

  switch (config.type) {
    case 'umt':
      return new QBittorrentClient(config.url, config.username, config.password)
    case 'transmission':
      return new TransmissionClient(config.url, config.username, config.password)
    case 'deluge':
      // Deluge auth is password-only (no username).
      return new DelugeClient(config.url, config.password)
    default: {
      // Exhaustiveness check — config.type should never fall through here
      const _exhaustive: never = config.type
      throw new Error(`Unknown download client type: ${String(_exhaustive)}`)
    }
  }
}

// Lazily-created singleton — see header note.
let client: DownloadClient | null = null

export function getClient(): DownloadClient {
  if (client === null) client = createClient()
  return client
}
