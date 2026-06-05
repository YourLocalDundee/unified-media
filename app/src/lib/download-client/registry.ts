// Download client singleton registry.
// createClient() is called once at module load time and the result is cached.
// Importing getClient() from multiple places returns the same instance, so the
// UMT SID cache inside QBittorrentClient is shared across all callers.
import { getDownloadClientConfig } from './config'
import type { DownloadClient } from './types'
import { QBittorrentClient } from './qbittorrent'
import { TransmissionClient } from './transmission'
import { DelugeClient } from './deluge'

function createClient(): DownloadClient {
  const config = getDownloadClientConfig()

  switch (config.type) {
    case 'umt':
      return new QBittorrentClient(config.url, config.username, config.password)
    case 'transmission':
      return new TransmissionClient()
    case 'deluge':
      return new DelugeClient()
    default: {
      // Exhaustiveness check — config.type should never fall through here
      const _exhaustive: never = config.type
      throw new Error(`Unknown download client type: ${String(_exhaustive)}`)
    }
  }
}

// Module-level singleton
const client: DownloadClient = createClient()

export function getClient(): DownloadClient {
  return client
}
