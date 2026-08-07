'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

export interface MediaCardProps {
  id: string
  title: string
  year?: number
  imageUrl?: string
  type?: string
  href?: string
  onClick?: () => void
  // If type is 'Episode' or caller passes aspectRatio='wide', use 16:9; otherwise 2:3 poster
  aspectRatio?: 'poster' | 'wide'
  // Display-pref overrides — undefined means "show" (default behaviour)
  showTypeBadge?: boolean
  showYear?: boolean
}

export default function MediaCard({
  id,
  title,
  year,
  imageUrl,
  type,
  href,
  onClick,
  aspectRatio,
  showTypeBadge = true,
  showYear = true,
}: MediaCardProps) {
  const [imgError, setImgError] = useState(false)
  const isWide = aspectRatio === 'wide' || type === 'Episode'

  const widthClass = isWide ? 'w-[213px] sm:w-[284px]' : 'w-[120px] sm:w-[160px]'
  const aspectClass = isWide ? 'aspect-video' : 'aspect-[2/3]'
  const sizes = isWide
    ? '(max-width: 640px) 213px, 284px'
    : '(max-width: 640px) 120px, 160px'

  // Shared visual content — no interaction wrapper, just the image + metadata.
  const content = (
    <>
      <div
        className={`relative w-full ${aspectClass} overflow-hidden bg-zinc-800 rounded-lg transition-transform duration-200 group-hover:scale-105 group-hover:ring-2 group-hover:ring-white/20`}
      >
        {imageUrl && !imgError ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes={sizes}
            className="object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900 rounded-lg">
            <p className="text-zinc-500 text-xs px-2 text-center leading-tight line-clamp-3">{title}</p>
          </div>
        )}

        {/* Type badge */}
        {showTypeBadge && type && (
          <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/80 uppercase tracking-wide">
            {type === 'Series' ? 'TV' : type}
          </span>
        )}
      </div>

      {/* Text below image */}
      <div className="mt-1.5 px-0.5">
        <p className="text-sm font-medium text-white truncate leading-tight">{title}</p>
        {showYear && year && <p className="text-xs text-zinc-400 mt-0.5">{year}</p>}
      </div>
    </>
  )

  const sharedClass = `group flex-shrink-0 ${widthClass}`

  // A16-M9: onClick callers must get a keyboard-operable element (<button>), not a
  // bare <div onClick> which is unreachable for keyboard and assistive-tech users.
  if (onClick) {
    return (
      <button
        type="button"
        className={`${sharedClass} text-left cursor-pointer`}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }

  return (
    <Link href={href ?? `/library/${id}`} className={sharedClass}>
      {content}
    </Link>
  )
}
