import type { Metadata } from 'next'
import { readFileSync } from 'fs'
import path from 'path'
import pkg from '../../../../package.json'

export const metadata: Metadata = { title: 'About — Settings' }

export const dynamic = 'force-static'

interface ChangelogVersion {
  version: string
  date: string
  sections: { heading: string; bullets: string[] }[]
}

function parseChangelog(): ChangelogVersion[] {
  try {
    const raw = readFileSync(path.join(process.cwd(), '..', 'CHANGELOG.md'), 'utf8')
    const chunks = raw.split(/\n## \[/).slice(1)
    return chunks.slice(0, 3).map((chunk) => {
      const firstLine = chunk.split('\n')[0]
      const versionMatch = firstLine.match(/^([^\]]+)\]/)
      const dateMatch = firstLine.match(/—\s*(.+)$/)
      const version = versionMatch ? versionMatch[1].trim() : '?'
      const date = dateMatch ? dateMatch[1].trim() : ''

      const sections: { heading: string; bullets: string[] }[] = []
      const sectionRegex = /### (Added|Changed|Fixed|Security|Removed)\n([\s\S]*?)(?=\n### |\n---|\n## |$)/g
      let match
      while ((match = sectionRegex.exec(chunk)) !== null) {
        const heading = match[1]
        const body = match[2]
        const bullets = body
          .split('\n')
          .filter((line) => line.startsWith('- '))
          .map((line) => line.replace(/^- /, '').replace(/\*\*/g, ''))
        if (bullets.length > 0) {
          sections.push({ heading, bullets })
        }
      }

      return { version, date, sections }
    })
  } catch {
    return []
  }
}

const tips = [
  {
    title: 'Searching',
    body: 'Typing in the search bar finds content in your library or discovers new titles to request.',
  },
  {
    title: 'Requesting Content',
    body: "If something isn't in the library, hit Request on its detail page and it will be queued for download.",
  },
  {
    title: 'Player Tools',
    body: 'The sliders icon during playback opens equalizer, speed controls, A/B loop, bookmarks, and more.',
  },
  {
    title: 'Keyboard Shortcuts',
    body: 'Space plays or pauses, F toggles fullscreen, M mutes, and arrow keys seek and adjust volume.',
  },
]

export default function AboutPage() {
  const versions = parseChangelog()

  return (
    <div className="space-y-6">
      {/* Section 1: Version block */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Version</h2>
        <div className="flex items-center justify-between py-3">
          <span className="text-sm font-medium">Unified Media</span>
          <span className="text-sm text-muted-foreground font-mono">{pkg.version}</span>
        </div>
      </section>

      {/* Section 2: What's New */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">{"What's New"}</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Changelog unavailable.</p>
        ) : (
          <div className="space-y-2">
            {versions.map((v, i) => (
              <details
                key={v.version}
                {...(i === 0 ? { open: true } : {})}
                className="rounded-md border border-border bg-background"
              >
                <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
                  v{v.version} — {v.date}
                </summary>
                <div className="px-4 pb-4 pt-2 space-y-3">
                  {v.sections.map((section) => (
                    <div key={section.heading}>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">
                        {section.heading}
                      </p>
                      <ul className="space-y-1">
                        {section.bullets.map((bullet, j) => (
                          <li key={j} className="text-sm text-muted-foreground flex gap-2">
                            <span className="mt-0.5 shrink-0 text-muted-foreground/50">–</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      {/* Section 3: Help & Tips */}
      <section className="rounded-lg border border-border bg-card p-6 space-y-4">
        <h2 className="text-lg font-semibold">Help & Tips</h2>
        <div className="grid grid-cols-2 gap-4">
          {tips.map((tip) => (
            <div key={tip.title} className="rounded-lg border border-border bg-card p-4 space-y-2">
              <p className="text-sm font-bold">{tip.title}</p>
              <p className="text-sm text-muted-foreground">{tip.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Section 4: About blurb */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-2">About</h2>
        <p className="text-sm text-muted-foreground">
          Unified Media brings your entire media collection into one place.
          Browse, request, and watch — all without switching apps.
        </p>
      </section>
    </div>
  )
}
