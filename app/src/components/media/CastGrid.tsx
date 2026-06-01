'use client'

import Image from 'next/image'

interface CastMember {
  id: number
  name: string
  character: string
  profilePath?: string | null
}

interface CastGridProps {
  cast: CastMember[]
}

function InitialsPlaceholder({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase()
  return (
    <div className="flex h-24 w-16 items-center justify-center rounded bg-zinc-700 text-sm font-semibold text-zinc-300">
      {initial}
    </div>
  )
}

export function CastGrid({ cast }: CastGridProps) {
  const members = cast.slice(0, 10)
  if (members.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 pb-2" style={{ minWidth: 'max-content' }}>
        {members.map((member) => (
          <div key={member.id} className="flex w-16 flex-col gap-1">
            {member.profilePath ? (
              <div className="relative h-24 w-16 overflow-hidden rounded">
                <Image
                  src={`https://image.tmdb.org/t/p/w185${member.profilePath}`}
                  alt={member.name}
                  fill
                  unoptimized
                  className="object-cover"
                  sizes="64px"
                />
              </div>
            ) : (
              <InitialsPlaceholder name={member.name} />
            )}
            <p className="truncate text-xs font-bold text-zinc-100" title={member.name}>
              {member.name}
            </p>
            <p className="truncate text-xs text-zinc-400" title={member.character}>
              {member.character}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
