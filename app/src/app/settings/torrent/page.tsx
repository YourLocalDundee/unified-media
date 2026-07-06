/**
 * /settings/torrent — thin server component wrapper for TorrentSettingsClient.
 * No server-side data fetch here; qBittorrent preferences are loaded client-side
 * on mount via /api/qbit/app/preferences because the SID session cookie must
 * stay server-side and the proxy route handles auth transparently.
 */
import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/dal'
import TorrentSettingsClient from './TorrentSettingsClient'

export const metadata: Metadata = { title: 'Torrent — Settings' }

// Admin-only: qBittorrent preferences are download infrastructure. Non-admins are redirected home
// (the /api/qbit proxy is also admin-gated, so this page can't function for them anyway).
export default async function TorrentSettingsPage() {
  await requireAdmin()
  return <TorrentSettingsClient />
}
