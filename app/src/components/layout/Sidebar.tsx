'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Film, Library, Search, ClipboardList, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'

const navItems = [
  { href: '/', icon: Home, label: 'Dashboard' },
  { href: '/browse', icon: Film, label: 'Browse' },
  { href: '/browse?type=all', icon: Library, label: 'Library' },
  { href: '/search', icon: Search, label: 'Search' },
  { href: '/requests', icon: ClipboardList, label: 'Requests' },
  { href: '/downloads', icon: Download, label: 'Downloads' },
]

export function Sidebar() {
  const pathname = usePathname()
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

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                isActive && 'bg-primary/10 text-primary',
                !sidebarOpen && 'justify-center px-2',
              )}
              title={!sidebarOpen ? label : undefined}
            >
              <Icon className="h-5 w-5 flex-shrink-0" />
              {sidebarOpen && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
