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
}: MediaCardProps) {
  const [imgError, setImgError] = useState(false)
  const isWide = aspectRatio === 'wide' || type === 'Episode'

  const widthClass = isWide ? 'w-[213px] sm:w-[284px]' : 'w-[120px] sm:w-[160px]'
  const aspectClass = isWide ? 'aspect-video' : 'aspect-[2/3]'
  const sizes = isWide
    ? '(max-width: 640px) 213px, 284px'
    : '(max-width: 640px) 120px, 160px'

  const inner = (
    <div
      className={`group flex-shrink-0 ${widthClass} cursor-pointer`}
      onClick={onClick}
    >
      {/* Image container — height derived from aspect ratio */}
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
            unoptimized
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-900 rounded-lg">
            <p className="text-zinc-500 text-xs px-2 text-center leading-tight line-clamp-3">{title}</p>
          </div>
        )}

        {/* Type badge */}
        {type && (
          <span className="absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/80 uppercase tracking-wide">
            {type === 'Series' ? 'TV' : type}
          </span>
        )}
      </div>

      {/* Text below image */}
      <div className="mt-1.5 px-0.5">
        <p className="text-sm font-medium text-white truncate leading-tight">{title}</p>
        {year && <p className="text-xs text-zinc-400 mt-0.5">{year}</p>}
      </div>
    </div>
  )

  if (onClick) return inner
  // Default to the owned-items surface, not /browse. MediaCard is a library
  // component, so a missing href should never drop the user into the acquisition
  // UI for content they already own (CLAUDE.md routing rule; A3-18).
  return <Link href={href ?? `/library/${id}`}>{inner}</Link>
}
