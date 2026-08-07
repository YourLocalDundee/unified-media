'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

/**
 * Returns `false` during SSR and the hydration pass, then `true` once mounted on the
 * client. Built on `useSyncExternalStore` so the server/client snapshot difference is
 * reconciled by React without a hydration mismatch — and crucially without a
 * synchronous `setState` inside an effect (react-hooks/set-state-in-effect), which is
 * what the old `useState(false)` + `useEffect(() => setMounted(true))` pattern tripped.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(emptySubscribe, () => true, () => false)
}
