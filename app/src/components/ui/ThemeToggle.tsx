'use client'

import { useState, useEffect, useRef } from 'react'
import { Palette, Plus, X } from 'lucide-react'
import { useFocusTrap } from '@/hooks/useFocusTrap'

// ── Built-in themes ────────────────────────────────────────────────────────────

export const BUILTIN_THEMES = [
  { id: 'dark',     label: 'Dark',     colors: ['#0f1117', '#1c2128', '#2f81f7'] },
  { id: 'midnight', label: 'Midnight', colors: ['#000000', '#111111', '#6e40c9'] },
  { id: 'light',    label: 'Light',    colors: ['#ffffff', '#f6f8fa', '#0969da'] },
  { id: 'dim',      label: 'Dim',      colors: ['#1b1f23', '#2d333b', '#539bf5'] },
  { id: 'cinema',   label: 'Cinema',   colors: ['#080808', '#161414', '#e5383b'] },
] as const

type BuiltinThemeId = typeof BUILTIN_THEMES[number]['id']

// ── Custom theme types ─────────────────────────────────────────────────────────

export interface CustomThemeColors {
  bg: string
  surface: string
  accent: string
  textPrimary: string
  textSecondary: string
  border: string
}

export interface CustomTheme {
  id: string
  name: string
  colors: CustomThemeColors
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Lighten a hex color by mixing it toward white by `amount` (0–1). */
function lightenHex(hex: string, amount: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) + (255 - parseInt(hex.slice(1, 3), 16)) * amount)
  const g = Math.round(parseInt(hex.slice(3, 5), 16) + (255 - parseInt(hex.slice(3, 5), 16)) * amount)
  const b = Math.round(parseInt(hex.slice(5, 7), 16) + (255 - parseInt(hex.slice(5, 7), 16)) * amount)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

const CUSTOM_THEMES_KEY = 'unified-custom-themes'

export function loadCustomThemes(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY)
    if (raw) return JSON.parse(raw) as CustomTheme[]
  } catch {}
  return []
}

export function saveCustomThemes(themes: CustomTheme[]) {
  try { localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes)) } catch {}
}

// Reject any color that is not a bare CSS hex color, preventing CSS injection
// via crafted localStorage values (A21-02).
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/
function sanitizeColor(value: string, fallback = '#000000'): string {
  return HEX_RE.test(value) ? value : fallback
}

function sanitizeColors(c: CustomThemeColors): CustomThemeColors {
  return {
    bg:            sanitizeColor(c.bg,            '#0f1117'),
    surface:       sanitizeColor(c.surface,       '#1c2128'),
    accent:        sanitizeColor(c.accent,        '#2f81f7'),
    textPrimary:   sanitizeColor(c.textPrimary,   '#e6edf3'),
    textSecondary: sanitizeColor(c.textSecondary, '#8b949e'),
    border:        sanitizeColor(c.border,        '#30363d'),
  }
}

export function buildCustomThemeCSS(slug: string, raw: CustomThemeColors): string {
  const c = sanitizeColors(raw)
  const hover = lightenHex(c.surface, 0.1)
  return `
[data-theme="${slug}"] {
  --theme-bg: ${c.bg};
  --theme-bg2: ${c.surface};
  --theme-card: ${c.surface};
  --theme-hover: ${hover};
  --theme-text: ${c.textPrimary};
  --theme-text2: ${c.textSecondary};
  --theme-muted: ${c.textSecondary};
  --theme-accent: ${c.accent};
  --theme-accent-h: ${c.accent};
  --theme-border: ${c.border};

  --background: ${hexToHsl(c.bg)};
  --foreground: ${hexToHsl(c.textPrimary)};
  --card: ${hexToHsl(c.surface)};
  --card-foreground: ${hexToHsl(c.textPrimary)};
  --primary: ${hexToHsl(c.accent)};
  --primary-foreground: ${hexToHsl(c.bg)};
  --secondary: ${hexToHsl(c.surface)};
  --secondary-foreground: ${hexToHsl(c.textPrimary)};
  --muted: ${hexToHsl(c.surface)};
  --muted-foreground: ${hexToHsl(c.textSecondary)};
  --accent: ${hexToHsl(c.accent)};
  --accent-foreground: ${hexToHsl(c.bg)};
  --destructive: 0 63% 51%;
  --destructive-foreground: ${hexToHsl(c.textPrimary)};
  --border: ${hexToHsl(c.border)};
  --ring: ${hexToHsl(c.accent)};
}`.trim()
}

export function injectCustomThemeStyle(slug: string, css: string) {
  const existingId = `custom-theme-${slug}`
  const existing = document.getElementById(existingId)
  if (existing) existing.remove()
  const style = document.createElement('style')
  style.id = existingId
  style.textContent = css
  document.head.appendChild(style)
}

export function removeCustomThemeStyle(slug: string) {
  const el = document.getElementById(`custom-theme-${slug}`)
  if (el) el.remove()
}

// ── applyTheme ─────────────────────────────────────────────────────────────────

export function applyTheme(id: string) {
  document.documentElement.setAttribute('data-theme', id)
  try { localStorage.setItem('unified-theme', id) } catch {}
}

function getInitialTheme(): string {
  try {
    const stored = localStorage.getItem('unified-theme')
    if (stored) return stored
  } catch {}
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

// ── Default colors for the create modal ───────────────────────────────────────

const DEFAULT_COLORS: CustomThemeColors = {
  bg:            '#0f1117',
  surface:       '#1c2128',
  accent:        '#2f81f7',
  textPrimary:   '#e6edf3',
  textSecondary: '#8b949e',
  border:        '#30363d',
}

// ── CreateThemeModal ───────────────────────────────────────────────────────────

interface CreateThemeModalProps {
  onClose: () => void
  onSave: (theme: CustomTheme) => void
}

export function CreateThemeModal({ onClose, onSave }: CreateThemeModalProps) {
  const [name, setName] = useState('')
  const [colors, setColors] = useState<CustomThemeColors>(DEFAULT_COLORS)

  const dialogRef = useRef<HTMLDivElement>(null)
  useFocusTrap(dialogRef, true, onClose)

  function setColor(key: keyof CustomThemeColors, value: string) {
    setColors(prev => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) return
    const slug = slugify(trimmed)
    if (!slug) return
    const theme: CustomTheme = { id: slug, name: trimmed, colors }
    const css = buildCustomThemeCSS(slug, colors)
    injectCustomThemeStyle(slug, css)
    applyTheme(slug)
    onSave(theme)
    onClose()
  }

  const colorFields: { key: keyof CustomThemeColors; label: string }[] = [
    { key: 'bg',            label: 'Background' },
    { key: 'surface',       label: 'Surface (card)' },
    { key: 'accent',        label: 'Accent' },
    { key: 'textPrimary',   label: 'Text primary' },
    { key: 'textSecondary', label: 'Text secondary' },
    { key: 'border',        label: 'Border' },
  ]

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-theme-title"
        className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-2xl"
      >

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 id="create-theme-title" className="text-base font-semibold text-foreground">Create theme</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Theme name */}
        <div className="mb-4">
          <label className="block text-xs text-muted-foreground mb-1">Theme name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="My Theme"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        {/* Color pickers */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4">
          {colorFields.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                value={colors[key]}
                onChange={e => setColor(key, e.target.value)}
                className="h-7 w-7 cursor-pointer rounded border border-border bg-transparent"
                title={label}
              />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>

        {/* Live preview */}
        <div className="mb-5 rounded-lg border overflow-hidden" style={{ borderColor: colors.border }}>
          <div className="p-3" style={{ backgroundColor: colors.surface }}>
            <p className="text-xs font-semibold mb-0.5" style={{ color: colors.textPrimary }}>Preview Card</p>
            <p className="text-xs mb-2" style={{ color: colors.textSecondary }}>Secondary text</p>
            <button
              className="px-3 py-1 rounded text-xs font-medium"
              style={{ backgroundColor: colors.accent, color: colors.bg }}
            >
              Button
            </button>
          </div>
          <div
            className="px-3 py-2 text-xs"
            style={{ backgroundColor: colors.bg, color: colors.textSecondary, borderTop: `1px solid ${colors.border}` }}
          >
            Background surface
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !slugify(name.trim())}
            className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save theme
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ThemeToggle ────────────────────────────────────────────────────────────────

export default function ThemeToggle() {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string>('dark')
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // On mount: restore theme + inject any saved custom theme styles
  useEffect(() => {
    const saved = loadCustomThemes()
    setCustomThemes(saved)
    for (const ct of saved) {
      const css = buildCustomThemeCSS(ct.id, ct.colors)
      injectCustomThemeStyle(ct.id, css)
    }
    const t = getInitialTheme()
    setActive(t)
    applyTheme(t)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function select(id: string) {
    setActive(id)
    applyTheme(id)
    setOpen(false)
  }

  function handleSaveCustomTheme(theme: CustomTheme) {
    setCustomThemes(prev => {
      const next = [...prev.filter(t => t.id !== theme.id), theme]
      saveCustomThemes(next)
      return next
    })
    setActive(theme.id)
  }

  function deleteCustomTheme(id: string, e: React.MouseEvent) {
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
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className="rounded-md p-2 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Change theme"
          title="Change theme"
        >
          <Palette className="h-5 w-5" />
        </button>

        {open && (
          <div className="absolute right-0 top-10 z-50 w-52 rounded-lg border border-border bg-card shadow-xl py-1">

            {/* Built-in themes */}
            {BUILTIN_THEMES.map(({ id, label, colors }) => (
              <button
                key={id}
                onClick={() => select(id)}
                className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent text-left transition-colors"
              >
                <span className="flex gap-0.5 flex-shrink-0">
                  {colors.map((c, i) => (
                    <span
                      key={i}
                      className="inline-block h-3 w-3 rounded-full border border-white/10"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </span>
                <span className="flex-1">{label}</span>
                {active === id && <span className="text-primary text-xs">✓</span>}
              </button>
            ))}

            {/* Custom themes */}
            {customThemes.length > 0 && (
              <div className="my-1 border-t border-border" />
            )}
            {customThemes.map(ct => (
              <div key={ct.id} className="flex items-center group">
                <button
                  onClick={() => select(ct.id)}
                  className="flex-1 flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent text-left transition-colors"
                >
                  <span className="flex gap-0.5 flex-shrink-0">
                    {(['bg', 'surface', 'accent'] as const).map((k, i) => (
                      <span
                        key={i}
                        className="inline-block h-3 w-3 rounded-full border border-white/10"
                        style={{ backgroundColor: ct.colors[k] }}
                      />
                    ))}
                  </span>
                  <span className="flex-1">{ct.name}</span>
                  {active === ct.id && <span className="text-primary text-xs">✓</span>}
                </button>
                <button
                  onClick={e => deleteCustomTheme(ct.id, e)}
                  className="pr-3 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Delete ${ct.name} theme`}
                  title="Delete theme"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}

            {/* Separator + Create theme */}
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => { setOpen(false); setModalOpen(true) }}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent text-muted-foreground hover:text-foreground text-left transition-colors"
            >
              <span className="flex gap-0.5 flex-shrink-0">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-border">
                  <Plus className="h-3.5 w-3.5" />
                </span>
              </span>
              <span className="flex-1">Create theme</span>
            </button>
          </div>
        )}
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
