/**
 * /settings/torrent — thin server component wrapper for TorrentSettingsClient.
 * No server-side data fetch here; qBittorrent preferences are loaded client-side
 * on mount via /api/qbit/app/preferences because the SID session cookie must
 * stay server-side and the proxy route handles auth transparently.
 */
import type { Metadata } from 'next'
import TorrentSettingsClient from './TorrentSettingsClient'

export const metadata: Metadata = { title: 'Torrent — Settings' }

export default function TorrentSettingsPage() {
  return <TorrentSettingsClient />
}
