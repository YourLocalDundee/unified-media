import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Keyboard Shortcuts — Settings' }

const SHORTCUTS = [
  { key: 'Space', action: 'Play / Pause' },
  { key: 'F', action: 'Toggle fullscreen' },
  { key: 'M', action: 'Toggle mute' },
  { key: '← →', action: 'Seek ±10 seconds' },
  { key: '↑ ↓', action: 'Volume ±10%' },
  { key: 'S', action: 'Toggle subtitles' },
  { key: 'N', action: 'Next episode' },
  { key: 'Esc', action: 'Exit fullscreen / close modal' },
]

export default function ShortcutsPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Player Shortcuts</h2>
        <div className="divide-y divide-border">
          {SHORTCUTS.map(({ key, action }) => (
            <div key={key} className="flex items-center justify-between py-3">
              <span className="text-sm text-muted-foreground">{action}</span>
              <kbd className="inline-flex items-center rounded border border-border bg-muted px-2 py-1 text-xs font-mono font-medium">
                {key}
              </kbd>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Shortcuts are active when the video player has focus. Keyboard shortcut customization is
          not yet supported.
        </p>
      </section>
    </div>
  )
}
