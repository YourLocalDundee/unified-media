export interface DownloadClientConfig {
  type: 'qbittorrent' | 'transmission' | 'deluge'
  url: string
  username?: string
  password?: string
}

export function getDownloadClientConfig(): DownloadClientConfig {
  const type = (process.env.DOWNLOAD_CLIENT ?? 'qbittorrent') as DownloadClientConfig['type']
  return {
    type,
    url: process.env.QBIT_URL ?? 'http://qbittorrent:8080',
    username: process.env.QBIT_USERNAME,
    password: process.env.QBIT_PASSWORD,
  }
}
