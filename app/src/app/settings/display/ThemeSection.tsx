'use client'

import { useState, useEffect } from 'react'
import { Plus, X, Check } from 'lucide-react'
import {
  BUILTIN_THEMES,
  CreateThemeModal,
  CustomTheme,
  applyTheme,
  loadCustomThemes,
  saveCustomThemes,
  buildCustomThemeCSS,
  injectCustomThemeStyle,
  removeCustomThemeStyle,
} from '@/components/ui/ThemeToggle'

function getActiveTheme(): string {
  try {
    const stored = localStorage.getItem('unified-theme')
    if (stored) return stored
  } catch {}
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

export default function ThemeSection() {
  const [active, setActive] = useState<string>('dark')
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([])
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    const saved = loadCustomThemes()
    setCustomThemes(saved)
    for (const ct of saved) {
      injectCustomThemeStyle(ct.id, buildCustomThemeCSS(ct.id, ct.colors))
    }
    setActive(getActiveTheme())
  }, [])

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'unified-theme' && e.newValue) {
        setActive(e.newValue)
      }
      if (e.key === 'unified-custom-themes') {
        const next = loadCustomThemes()
        setCustomThemes(next)
        for (const ct of next) {
          injectCustomThemeStyle(ct.id, buildCustomThemeCSS(ct.id, ct.colors))
        }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function select(id: string) {
    setActive(id)
    applyTheme(id)
  }

  function handleSaveCustomTheme(theme: CustomTheme) {
    setCustomThemes(prev => {
      const next = [...prev.filter(t => t.id !== theme.id), theme]
      saveCustomThemes(next)
      return next
    })
    setActive(theme.id)
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    removeCustomThemeStyle(id)
    setCustomThemes(prev => {
      const next = prev.filter(t => t.id !== id)
      saveCustomThemes(next)
      return next
    })
    if (active === id) {
      setActive('dark')
      applyTheme('dark')
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {BUILTIN_THEMES.map(({ id, label, colors }) => {
          const isActive = active === id
          return (
            <div
              key={id}
              onClick={() => select(id)}
              className={`group relative cursor-pointer rounded-lg border-2 p-3 transition-all w-28 ${
                isActive
                  ? 'border-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex gap-1.5 mb-2">
                {colors.map((c, i) => (
                  <span
                    key={i}
                    className="inline-block h-4 w-4 rounded-full border border-white/10 flex-shrink-0"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <p className="text-xs font-medium text-foreground truncate">{label}</p>
              {isActive && (
                <span className="absolute top-1.5 right-1.5 text-primary">
                  <Check className="h-3 w-3" />
                </span>
              )}
            </div>
          )
        })}

        {customThemes.map(ct => {
          const isActive = active === ct.id
          return (
            <div
              key={ct.id}
              onClick={() => select(ct.id)}
              className={`group relative cursor-pointer rounded-lg border-2 p-3 transition-all w-28 ${
                isActive
                  ? 'border-primary'
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex gap-1.5 mb-2">
                {(['bg', 'surface', 'accent'] as const).map((k, i) => (
                  <span
                    key={i}
                    className="inline-block h-4 w-4 rounded-full border border-white/10 flex-shrink-0"
                    style={{ backgroundColor: ct.colors[k] }}
                  />
                ))}
              </div>
              <p className="text-xs font-medium text-foreground truncate">{ct.name}</p>
              {isActive && (
                <span className="absolute top-1.5 right-1.5 text-primary">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <button
                onClick={e => handleDelete(ct.id, e)}
                className="absolute top-1 right-1 rounded p-0.5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                aria-label={`Delete ${ct.name} theme`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}

        <div
          onClick={() => setModalOpen(true)}
          className="group relative cursor-pointer rounded-lg border-2 border-dashed border-border hover:border-primary/50 p-3 transition-all w-28 flex flex-col items-center justify-center gap-1.5 min-h-[4.5rem]"
        >
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border group-hover:border-primary/50 transition-colors">
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
          <p className="text-xs text-muted-foreground">Add custom</p>
        </div>
      </div>

      {modalOpen && (
        <CreateThemeModal
          onClose={() => setModalOpen(false)}
          onSave={handleSaveCustomTheme}
        />
      )}
    </>
  )
}
