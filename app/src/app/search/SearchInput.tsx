/**
 * Controlled search input that drives the server-rendered /search page.
 * Debounces keystrokes (300ms) and calls router.push() to update the URL,
 * which causes the server component to re-run with the new query param.
 * useTransition marks the navigation as a non-blocking transition so the
 * spinner shows while the server component is rendering without freezing the
 * input field.
 */
'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface SearchInputProps {
  initialQuery: string
}

export default function SearchInput({ initialQuery }: SearchInputProps) {
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)
  const [isPending, startTransition] = useTransition()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync if the server-side query changes (e.g. browser back/forward)
  useEffect(() => {
    setValue(initialQuery)
  }, [initialQuery])

  function navigate(q: string) {
    const trimmed = q.trim()
    const target = trimmed
      ? `/search?q=${encodeURIComponent(trimmed)}`
      : '/search'
    startTransition(() => {
      router.push(target)
    })
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = e.target.value
    setValue(next)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      navigate(next)
    }, 300)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Cancel any pending debounce so the explicit submit fires immediately
    if (debounceRef.current) clearTimeout(debounceRef.current)
    navigate(value)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <div className="relative flex-1">
        <input
          type="search"
          value={value}
          onChange={handleChange}
          placeholder="Search movies and TV shows..."
          className="w-full rounded-lg bg-zinc-800 px-4 py-2.5 pr-10 text-sm text-white placeholder-zinc-500 outline-none focus:ring-2 focus:ring-white/20"
          autoFocus
        />
        {isPending && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <svg
              className="h-4 w-4 animate-spin text-zinc-400"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          </span>
        )}
      </div>
      <button
        type="submit"
        className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-zinc-200 disabled:opacity-60"
        disabled={isPending}
      >
        Search
      </button>
    </form>
  )
}
