// Collapsible desktop sidebar — toggles between full (56) and icon-only (16) widths.
// Collapse state is persisted in Zustand (useAppStore) so it survives navigation.
// Hidden on mobile; MobileNav provides equivalent functionality there.
'use client'

import Link from 'next/link'
import { Suspense, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Home, Film, Library, ClipboardList, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useDisplayPrefs } from '@/hooks/useSettings'
import { useAuth } from '@/context/AuthContext'

const navItems = [
  { href: '/', icon: Home, label: 'Dashboard' },
  { href: '/browse', icon: Film, label: 'Browse' },
  { href: '/library', icon: Library, label: 'Library' },
  { href: '/requests', icon: ClipboardList, label: 'Requests' },
  // Downloads (qBittorrent queue) is admin-only — the /downloads route and /api/qbit proxy are both
  // admin-gated, so the link is hidden from regular users.
  { href: '/downloads', icon: Download, label: 'Downloads', adminOnly: true },
]

// Isolated into its own component so it can be wrapped in a Suspense boundary
// (Next.js requires client hooks like usePathname to be in a Suspense subtree on static pages).
function SidebarNav({ sidebarOpen }: { sidebarOpen: boolean }) {
  const pathname = usePathname()
  const { user } = useAuth()
  const items = navItems.filter((item) => !item.adminOnly || user?.role === 'admin')

  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <nav className="flex flex-1 flex-col gap-1 p-2">
      {items.map(({ href, icon: Icon, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            isActive(href) && 'bg-primary/10 text-primary',
            !sidebarOpen && 'justify-center px-2',
          )}
          title={!sidebarOpen ? label : undefined}
        >
          <Icon className="h-5 w-5 flex-shrink-0" />
          {sidebarOpen && <span>{label}</span>}
        </Link>
      ))}
    </nav>
  )
}

export function Sidebar() {
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const { prefs } = useDisplayPrefs()

  // Seed Zustand's sidebar state from the user's display pref on first mount.
  // Only runs once (no pref in deps) so the user's toggle during the session wins.
  useEffect(() => {
    setSidebarOpen(!prefs.sidebarCollapsed)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col border-r border-border bg-card transition-all duration-300 ease-in-out',
        sidebarOpen ? 'w-56' : 'w-16',
      )}
    >
      {/* Logo / toggle */}
      <div
        className={cn(
          'flex h-16 items-center border-b border-border px-4',
          sidebarOpen ? 'justify-between' : 'justify-center',
        )}
      >
        {sidebarOpen && (
          <Link href="/" className="flex items-center gap-0.5 text-lg font-bold select-none">
            <span className="text-primary">U</span>
            <span className="text-foreground">nified Media</span>
          </Link>
        )}
        <button onClick={toggleSidebar} className="rounded p-2 hover:bg-accent">
          {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>

      <Suspense fallback={<nav className="flex flex-1 flex-col gap-1 p-2" />}>
        <SidebarNav sidebarOpen={sidebarOpen} />
      </Suspense>
    </aside>
  )
}
