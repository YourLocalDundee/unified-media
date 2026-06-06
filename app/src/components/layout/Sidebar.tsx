// Collapsible desktop sidebar — toggles between full (56) and icon-only (16) widths.
// Collapse state is persisted in Zustand (useAppStore) so it survives navigation.
// Hidden on mobile; MobileNav provides equivalent functionality there.
'use client'

import Link from 'next/link'
import { Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Home, Film, Library, ClipboardList, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

const navItems = [
  { href: '/', icon: Home, label: 'Dashboard' },
  { href: '/browse', icon: Film, label: 'Browse' },
  { href: '/browse?type=all', icon: Library, label: 'Library' },
  { href: '/requests', icon: ClipboardList, label: 'Requests' },
  { href: '/downloads', icon: Download, label: 'Downloads' },
]

// Isolated into its own component so useSearchParams is inside a Suspense boundary
// (Next.js requires this to avoid a prerender error on static pages).
function SidebarNav({ sidebarOpen }: { sidebarOpen: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function isActive(href: string): boolean {
    const [hrefPath, hrefQuery] = href.split('?')
    if (hrefQuery) {
      const paramKey = hrefQuery.split('=')[0]
      const paramVal = hrefQuery.split('=')[1]
      return pathname === hrefPath && searchParams.get(paramKey) === paramVal
    }
    if (href === '/') return pathname === '/'
    // /browse is active only when NOT in library mode (type=all)
    if (href === '/browse') {
      return pathname.startsWith('/browse') && searchParams.get('type') !== 'all'
    }
    return pathname === href || pathname.startsWith(href)
  }

  return (
    <nav className="flex flex-1 flex-col gap-1 p-2">
      {navItems.map(({ href, icon: Icon, label }) => (
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
  const { sidebarOpen, toggleSidebar } = useAppStore()

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col border-r border-border bg-card transition-all duration-300 ease-in-out',
        sidebarOpen ? 'w-56' : 'w-16',
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex h-16 items-center border-b border-border px-4',
          sidebarOpen ? 'justify-between' : 'justify-center',
        )}
      >
        {sidebarOpen && <span className="text-lg font-bold text-primary">minime</span>}
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
