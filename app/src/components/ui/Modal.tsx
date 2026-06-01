'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export function Modal({ isOpen, onClose, title, children, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (isOpen) ref.current?.showModal()
    else ref.current?.close()
  }, [isOpen])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      className={cn(
        'rounded-xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/60',
        'w-full max-w-md open:animate-in open:fade-in open:zoom-in-95',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        {title && <h2 className="text-lg font-semibold">{title}</h2>}
        <button onClick={onClose} className="ml-auto rounded p-1 hover:bg-accent">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  )
}
