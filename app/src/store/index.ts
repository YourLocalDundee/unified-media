/**
 * Global client-side store using Zustand.
 * Owns the one piece of UI state that needs to cross component boundaries: the
 * sidebar open/closed toggle. Everything else lives in component state or React
 * Query.
 *
 * A modal-player slice (openPlayer/closePlayer/currentItemId/isPlayerOpen/
 * playerStartTicks) lived here until playback moved to the /play/[id] route; it
 * was referenced by nothing for some time before being removed.
 */
import { create } from 'zustand'

interface AppState {
  sidebarOpen: boolean
}

interface AppActions {
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

export const useAppStore = create<AppState & AppActions>()((set) => ({
  sidebarOpen: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),
}))
