'use client'

/**
 * AuthContext — client-side auth state for the entire app.
 *
 * Session truth lives in the `unified-session` HttpOnly cookie validated
 * server-side via DAL. This context just caches the decoded identity for UI
 * use; it does NOT enforce access control (that is done server-side).
 *
 * Components that need the current user call `useAuth()`. The `loading` flag
 * lets layout components avoid a flash of unauthenticated UI on first render.
 *
 * Security boundary: this file has zero authority. A lying /api/auth/me response
 * cannot elevate privileges — all privileged actions are re-verified server-side
 * via requireAuth() / requireAdmin() in route handlers and server components.
 */

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

export interface AuthUser {
  userId: string
  username: string
  displayName: string | null
  role: string
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

// Default context value keeps `loading: true` so consumers can distinguish
// "not yet fetched" from "definitely unauthenticated" on initial render.
const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => {},
  refresh: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  const refresh = useCallback(async () => {
    try {
      // cache: 'no-store' prevents the browser from serving a stale identity
      // after logout or a session change (e.g. role upgrade by admin).
      const res = await fetch('/api/auth/me', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json() as AuthUser
        setUser(data)
      } else {
        setUser(null)
      }
    } catch {
      // Network failure — treat as unauthenticated rather than crash.
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Fetch on mount so auth state is ready before any child renders. Deferred a tick
  // so refresh()'s setState runs outside the effect's synchronous commit path
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0)
    return () => clearTimeout(id)
  }, [refresh])

  const logout = useCallback(async () => {
    // The POST call deletes the server-side session record and clears the
    // cookie. We optimistically clear local state before the redirect so
    // any in-flight renders don't flash the authenticated UI.
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    router.push('/login')
  }, [router])

  return (
    <AuthContext.Provider value={{ user, loading, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
