// Global top header bar — shows the app logo, search shortcut, theme toggle,
// and a user account dropdown with settings and sign-out links.
'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Search, User, Settings, Keyboard, LogOut } from 'lucide-react'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { useAuth } from '@/context/AuthContext'

interface HeaderProps {
  username?: string
  displayName?: string | null
}

export function Header({ username, displayName }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { logout } = useAuth()
  const shownName = displayName || username

  // Close the dropdown when the user clicks outside the menu ref boundary.
  // mousedown (not click) is used so it fires before the browser's focus event.
  useEffect(() => {
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <header className="flex h-16 items-center justify-end border-b border-border bg-card px-6">
      {/* Right actions */}
      <div className="flex flex-shrink-0 items-center gap-2">
        <Link
          href="/search"
          className="rounded-md p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Search className="h-5 w-5" />
        </Link>

        <ThemeToggle />

        {/* Account dropdown */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent transition-colors"
          >
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="hidden sm:inline">{shownName ?? 'Guest'}</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-10 z-50 w-52 rounded-lg border border-border bg-card shadow-xl py-1">
              <div className="px-3 py-2 text-xs text-muted-foreground font-medium">
                {shownName ?? 'Guest'}
              </div>
              <div className="border-t border-border my-1" />
              <Link
                href="/settings/profile"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
              >
                <Settings className="h-4 w-4" /> Settings
              </Link>
              <Link
                href="/settings/shortcuts"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent transition-colors"
              >
                <Keyboard className="h-4 w-4" /> Keyboard Shortcuts
              </Link>
              <div className="border-t border-border my-1" />
              <button
                onClick={() => {
                  setMenuOpen(false)
                  void logout()
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-destructive hover:bg-accent transition-colors"
              >
                <LogOut className="h-4 w-4" /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
