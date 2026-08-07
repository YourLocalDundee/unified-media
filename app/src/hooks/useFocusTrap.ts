'use client'

/**
 * useFocusTrap — accessibility helper for custom (non-native-`<dialog>`) modals.
 *
 * When `isOpen` is true it:
 *   (a) traps Tab / Shift+Tab focus inside the element referenced by `ref`,
 *   (b) moves focus into the dialog on open (first focusable, or the container),
 *   (c) restores focus to whatever element was focused before opening on close,
 *   (d) closes on Escape via the supplied `onClose`.
 *
 * It is intentionally minimal and does not render anything — wire it into an
 * existing overlay component. Visuals and behavior otherwise are unchanged.
 *
 *   const ref = useRef<HTMLDivElement>(null)
 *   useFocusTrap(ref, isOpen, onClose)
 *   return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="…">…</div>
 */

import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetParent !== null || el === document.activeElement)
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!isOpen) return
    const container = ref.current
    if (!container) return

    // Remember where focus was so we can restore it on close.
    const previouslyFocused = document.activeElement as HTMLElement | null

    // Move focus into the dialog if it isn't already inside.
    if (!container.contains(document.activeElement)) {
      const focusable = getFocusable(container)
      ;(focusable[0] ?? container).focus()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const focusable = getFocusable(container)
      if (focusable.length === 0) {
        // Nothing focusable — keep focus on the container itself.
        e.preventDefault()
        container.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (e.shiftKey) {
        if (active === first || active === container || !container.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last || active === container || !container.contains(active)) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // Restore focus to the opener, if it's still in the document.
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus()
      }
    }
  }, [ref, isOpen, onClose])
}
