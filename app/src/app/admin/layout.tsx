import { requireAdmin } from '@/lib/dal'
import Link from 'next/link'

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/monitoring', label: 'User Monitoring' },
  { href: '/admin/users', label: 'User Management' },
  { href: '/admin/invites', label: 'Invites' },
  { href: '/admin/requests', label: 'Requests' },
  { href: '/admin/activity', label: 'Watch Activity' },
  { href: '/admin/audit', label: 'Audit Log' },
  { href: '/admin/server', label: 'Server Status' },
  { href: '/admin/indexers', label: 'Indexers' },
  { href: '/admin/automation', label: 'Automation' },
  { href: '/admin/automation/bridge', label: 'Request Bridge' },
  { href: '/admin/subtitles', label: 'Subtitles' },
  { href: '/admin/media-server', label: 'Media Server' },
]

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin()

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar nav (desktop) */}
      <nav className="hidden md:flex w-48 flex-shrink-0 flex-col border-r border-border bg-card p-4 gap-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">Admin</p>
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg px-3 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {label}
          </Link>
        ))}
      </nav>

      {/* Mobile tabs */}
      <div className="flex md:hidden overflow-x-auto border-b border-border bg-card px-4 gap-1 shrink-0 fixed top-0 left-0 right-0 z-10">
        {NAV.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            className="shrink-0 px-3 py-3 text-xs font-medium text-muted-foreground hover:text-foreground whitespace-nowrap"
          >
            {label}
          </Link>
        ))}
      </div>

      <main className="flex-1 p-6 md:p-8 mt-0 md:mt-0 pt-14 md:pt-6 min-w-0">
        {children}
      </main>
    </div>
  )
}
