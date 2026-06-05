// Configuration loader for the download client abstraction.
// The active client type is chosen by the DOWNLOAD_CLIENT env var; it defaults
// to 'umt' since UMT (Unified Media Torrent) is the only fully implemented client.
// url/username/password are read from UMT_* vars regardless of client type —
// Transmission and Deluge stubs will need their own env vars when implemented.

export interface DownloadClientConfig {
  type: 'umt' | 'transmission' | 'deluge'
  url: string
  username?: string
  password?: string
}

export function getDownloadClientConfig(): DownloadClientConfig {
  const type = (process.env.DOWNLOAD_CLIENT ?? 'umt') as DownloadClientConfig['type']
  return {
    type,
    url: process.env.UMT_URL ?? 'http://qbittorrent:8080',
    username: process.env.UMT_USERNAME,
    password: process.env.UMT_PASSWORD,
  }
}
