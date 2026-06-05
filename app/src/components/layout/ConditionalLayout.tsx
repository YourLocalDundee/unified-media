// ConditionalLayout — sits between the root layout and every page.
// Auth/invite pages render chromeless (no sidebar, no header) so they feel standalone.
// All other pages get the full AppLayout shell.
'use client'

import { usePathname } from 'next/navigation'
import { AppLayout } from './AppLayout'

// Pages whose routes start with any of these prefixes should not show the app chrome.
// Checked as prefix matches so /invite/[code] is also excluded.
const AUTH_PATHS = ['/login', '/register', '/forgot', '/change-password', '/invite']

export default function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthPage = AUTH_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
  if (isAuthPage) return <>{children}</>
  return <AppLayout>{children}</AppLayout>
}
