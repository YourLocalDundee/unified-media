import { getDownloadClientConfig } from './config'
import type { DownloadClient } from './types'
import { QBittorrentClient } from './qbittorrent'
import { TransmissionClient } from './transmission'
import { DelugeClient } from './deluge'

function createClient(): DownloadClient {
  const config = getDownloadClientConfig()

  switch (config.type) {
    case 'qbittorrent':
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
