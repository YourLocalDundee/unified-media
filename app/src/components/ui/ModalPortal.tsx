'use client'

import { createPortal } from 'react-dom'
import { useIsClient } from '@/hooks/useIsClient'

/**
 * Renders its children into <body> via a React portal.
 *
 * Why this exists: a `position: fixed` element is positioned relative to the
 * nearest ancestor that establishes a containing block — and any ancestor with a
 * non-`none` `transform` (e.g. the discover-grid cards' `hover:-translate-y-0.5`)
 * does exactly that. A fixed overlay rendered *inline* inside such a card is
 * therefore anchored to the card, not the viewport, and flips between "trapped in
 * the grid cell" and "centered overlay" as the hover transform toggles — the
 * infinite flicker. Portaling the overlay to <body> removes it from any
 * transformed ancestor, so `fixed` resolves against the viewport as intended.
 *
 * The `mounted` gate ensures the portal only renders client-side (there is no
 * <body> target during SSR), avoiding any hydration mismatch.
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const mounted = useIsClient()
  if (!mounted) return null
  return createPortal(children, document.body)
}
