import type { Metadata } from 'next'
import { PLAYER_SHORTCUTS } from '@/lib/shortcuts'

export const metadata: Metadata = { title: 'Keyboard Shortcuts — Settings' }

// The list is generated from the PLAYER_SHORTCUTS registry (src/lib/shortcuts.ts), which is
// the same source the player's keydown cases are annotated against — there is no separately
// maintained table here, so a binding can't drift out of the docs.
export default function ShortcutsPage() {
  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Player Shortcuts</h2>
        <div className="space-y-6">
          {PLAYER_SHORTCUTS.map(group => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {group.title}
              </h3>
              <div className="divide-y divide-border">
                {group.shortcuts.map(({ id, action, display }) => (
                  <div key={id} className="flex items-center justify-between py-3">
                    <span className="text-sm text-muted-foreground">{action}</span>
                    <kbd className="inline-flex items-center rounded border border-border bg-muted px-2 py-1 text-xs font-mono font-medium">
                      {display}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Shortcuts are active when the video player is open. Keyboard shortcut customization is
          not yet supported.
        </p>
      </section>
    </div>
  )
}
