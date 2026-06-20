// Download client singleton registry.
// The client is created lazily on first getClient() call and cached, so the same
// instance (and its shared UMT SID cache inside QBittorrentClient) is returned to
// every caller. Lazy creation also means an unsupported DOWNLOAD_CLIENT selection
// fails with a clear, descriptive error at the point of use rather than crashing
// unrelated import-time code paths.
import { getDownloadClientConfig } from './config'
import type { DownloadClient } from './types'
import { QBittorrentClient } from './qbittorrent'

// A7-02: only 'umt' (qBittorrent) is actually implemented; transmission/deluge are
// throwing stubs. Callers that want to gate UI/behaviour can check this instead of
// catching a deep operation-level error.
const IMPLEMENTED_CLIENTS = new Set(['umt'])

export function isDownloadClientImplemented(): boolean {
  return IMPLEMENTED_CLIENTS.has(getDownloadClientConfig().type)
}

function createClient(): DownloadClient {
  const config = getDownloadClientConfig()

  switch (config.type) {
    case 'umt':
      return new QBittorrentClient(config.url, config.username, config.password)
    case 'transmission':
    case 'deluge':
      // A7-02: fail clearly at SELECTION naming the unsupported client, instead of
      // returning a stub whose every method throws a generic mid-operation error.
      throw new Error(
        `DOWNLOAD_CLIENT='${config.type}' is not implemented — only 'umt' (qBittorrent) is supported. ` +
        `Set DOWNLOAD_CLIENT=umt or implement the ${config.type} client.`
      )
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
