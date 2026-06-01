import { create } from 'zustand'

interface AppState {
  // Player
  currentItemId: string | null
  isPlayerOpen: boolean
  playerStartTicks: number
  // UI
  sidebarOpen: boolean
}

interface AppActions {
  openPlayer: (itemId: string, startTicks?: number) => void
  closePlayer: () => void
  toggleSidebar: () => void
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
}))
