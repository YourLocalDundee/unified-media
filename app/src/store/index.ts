/**
 * Global client-side store using Zustand.
 * Owns only the two pieces of UI state that need to cross component boundaries:
 * the in-app video player (open/closed, which item, resume position) and the
 * sidebar open/closed toggle. Everything else lives in component state or
 * React Query.
 */
import { create } from 'zustand'

interface AppState {
  // Player
  currentItemId: string | null
  isPlayerOpen: boolean
  // Resume position is stored in "ticks" (100-nanosecond units), not seconds
  playerStartTicks: number
  // UI
  sidebarOpen: boolean
}

interface AppActions {
  openPlayer: (itemId: string, startTicks?: number) => void
  closePlayer: () => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppState & AppActions>()((set) => ({
  // Initial state
  currentItemId: null,
  isPlayerOpen: false,
  playerStartTicks: 0,
  sidebarOpen: false,

  // Actions
  openPlayer: (itemId, startTicks = 0) =>
    set({ currentItemId: itemId, isPlayerOpen: true, playerStartTicks: startTicks }),

  closePlayer: () =>
    set({ isPlayerOpen: false, currentItemId: null, playerStartTicks: 0 }),

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))
