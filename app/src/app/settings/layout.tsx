/**
 * Settings section layout — persistent sidebar nav shared by all /settings/*
 * pages. Runs as a server component so it can read the session role without
 * a client-side fetch. The "Admin Panel" link is conditionally rendered only
 * for admin accounts to avoid exposing the route to regular users.
 */
import Link from 'next/link'
import { requireAuth } from '@/lib/dal'

const USER_NAV = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/playback', label: 'Playback' },
  { href: '/settings/display', label: 'Display' },
  { href: '/settings/torrent', label: 'Torrent' },
  { href: '/settings/media', label: 'Media' },
  { href: '/settings/advanced', label: 'Advanced' },
  { href: '/settings/about', label: 'About' },
  { href: '/settings/shortcuts', label: 'Shortcuts' },
]

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAuth()
  const isAdmin = session.role === 'admin'

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="flex flex-col md:flex-row gap-6">
        <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-x-visible md:w-48 flex-shrink-0">
          {USER_NAV.map(({ href, label }) => (
            <Link key={href} href={href}
              className="flex-shrink-0 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors text-muted-foreground">
              {label}
            </Link>
          ))}
          {isAdmin && (
            <>
              {/* Divider only visible on md+ where the nav is vertical */}
              <div className="hidden md:block h-px bg-border my-1" />
              <Link href="/admin"
                className="flex-shrink-0 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors text-purple-400 hover:text-purple-300">
                Admin Panel
              </Link>
            </>
          )}
        </nav>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  )
}
