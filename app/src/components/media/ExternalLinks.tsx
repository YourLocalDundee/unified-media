'use client'

interface ExternalLink {
  label: string
  url: string
}

interface ExternalLinksProps {
  links: ExternalLink[]
}

export function ExternalLinks({ links }: ExternalLinksProps) {
  const valid = links.filter((l) => Boolean(l.url))
  if (valid.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {valid.map((link) => (
        <a
          key={link.label}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-full bg-zinc-700 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-zinc-600"
        >
          {link.label}
        </a>
      ))}
    </div>
  )
}
