/**
 * Single source of truth for the video player's keyboard shortcuts.
 *
 * The reference page at /settings/shortcuts is generated from this registry (it does not
 * hand-maintain its own list), and each binding here carries the `id` annotated on the
 * matching `case` in `components/media/VideoPlayer.tsx`'s keydown handler so the docs and
 * the implementation stay traceable to each other. `keys` holds the raw `e.key` values the
 * player matches on (the player lowercases letter keys, so both cases collapse to one entry);
 * `display` is the human-readable chip text.
 *
 * This is client-safe data only — no browser APIs — so it can be imported from a server
 * component (the reference page) as well as the player.
 */

export interface Shortcut {
  /** Stable id; mirrored as a comment on the corresponding VideoPlayer keydown case. */
  id: string
  /** Raw e.key values this binds (for reference / future runtime matching). */
  keys: string[]
  /** Human-readable key chip text shown in the reference. */
  display: string
  /** What the shortcut does. */
  action: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

export const PLAYER_SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Playback',
    shortcuts: [
      { id: 'playPause', keys: [' ', 'k'], display: 'Space / K', action: 'Play / Pause' },
      { id: 'mute', keys: ['m'], display: 'M', action: 'Toggle mute' },
      { id: 'fullscreen', keys: ['f'], display: 'F', action: 'Toggle fullscreen' },
      { id: 'frameStep', keys: [',', '.'], display: ', .', action: 'Step one frame backward / forward (while paused)' },
    ],
  },
  {
    title: 'Seeking',
    shortcuts: [
      { id: 'seek10', keys: ['ArrowLeft', 'ArrowRight', 'j', 'l'], display: '← → / J L', action: 'Seek ±10 seconds' },
      { id: 'seek30', keys: ['ArrowLeft', 'ArrowRight'], display: 'Shift + ← →', action: 'Seek ±30 seconds' },
      { id: 'seekPercent', keys: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'], display: '0 – 9', action: 'Seek to 0% – 90% of duration' },
    ],
  },
  {
    title: 'Volume',
    shortcuts: [
      { id: 'volume', keys: ['ArrowUp', 'ArrowDown'], display: '↑ ↓', action: 'Volume ±10%' },
    ],
  },
  {
    title: 'Tracks & navigation',
    shortcuts: [
      { id: 'cycleSubtitles', keys: ['s'], display: 'S', action: 'Cycle subtitle tracks (off → first → … → off)' },
      { id: 'nextEpisode', keys: ['n'], display: 'N', action: 'Skip to next episode' },
      { id: 'statsOverlay', keys: ['i'], display: 'I', action: 'Toggle stats overlay' },
    ],
  },
]
