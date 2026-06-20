'use client'

import MediaCard from '@/components/media/MediaCard'
import { useDisplayPrefs } from '@/hooks/useSettings'

interface LibraryCardProps {
  id: string
  title: string
  year?: number
  imageUrl?: string
  type: 'Movie' | 'Series'
}

export function LibraryCard({ id, title, year, imageUrl, type }: LibraryCardProps) {
  const { prefs } = useDisplayPrefs()
  return (
    <MediaCard
      id={id}
      title={title}
      year={year}
      imageUrl={imageUrl}
      type={type}
      href={`/library/${id}`}
      showTypeBadge={prefs.showTypeBadge}
      showYear={prefs.showYear}
    />
  )
}
