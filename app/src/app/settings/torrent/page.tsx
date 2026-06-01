import type { Metadata } from 'next'
import TorrentSettingsClient from './TorrentSettingsClient'

export const metadata: Metadata = { title: 'Torrent — Settings' }

export default function TorrentSettingsPage() {
  return <TorrentSettingsClient />
}
