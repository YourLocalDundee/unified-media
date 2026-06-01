'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Film, Search, ClipboardList, Download } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', icon: Home, label: 'Dashboard' },
  { href: '/browse', icon: Film, label: 'Browse' },
  { href: '/search', icon: Search, label: 'Search' },
  { href: '/requests', icon: ClipboardList, label: 'Requests' },
  { href: '/downloads', icon: Download, label: 'Downloads' },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t border-border bg-card md:hidden">
      {navItems.map(({ href, icon: Icon, label }) => {
        const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex flex-col items-center gap-0.5 px-3 py-2',
              isActive ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
