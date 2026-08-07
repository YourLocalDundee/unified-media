// Configuration loader for the download client abstraction.
// The active client type is chosen by the DOWNLOAD_CLIENT env var; it defaults
// to 'umt' (qBittorrent). Each client reads its own *_URL / *_USERNAME / *_PASSWORD
// vars, falling back to the UMT_* vars so a single-client deployment can keep using
// the original UMT_* names regardless of which backend is selected.

export interface DownloadClientConfig {
  type: 'umt' | 'transmission' | 'deluge'
  url: string
  username?: string
  password?: string
}

export function getDownloadClientConfig(): DownloadClientConfig {
  const type = (process.env.DOWNLOAD_CLIENT ?? 'umt') as DownloadClientConfig['type']

  if (type === 'transmission') {
    return {
      type,
      // Transmission's RPC default listens on :9091.
      url: process.env.TRANSMISSION_URL ?? process.env.UMT_URL ?? 'http://transmission:9091',
      username: process.env.TRANSMISSION_USERNAME ?? process.env.UMT_USERNAME,
      password: process.env.TRANSMISSION_PASSWORD ?? process.env.UMT_PASSWORD,
    }
  }

  if (type === 'deluge') {
    return {
      type,
      // Deluge-web defaults to :8112; auth is password-only (no username).
      url: process.env.DELUGE_URL ?? process.env.UMT_URL ?? 'http://deluge:8112',
      password: process.env.DELUGE_PASSWORD ?? process.env.UMT_PASSWORD,
    }
  }

  return {
    type,
    url: process.env.UMT_URL ?? 'http://qbittorrent:8080',
    username: process.env.UMT_USERNAME,
    password: process.env.UMT_PASSWORD,
  }
}
