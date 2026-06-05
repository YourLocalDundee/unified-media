/**
 * /settings/display — controls for visual appearance, home page carousels,
 * library grid layout, and sidebar. All preferences are persisted to
 * localStorage via the useDisplayPrefs hook; no server round-trip on change.
 * ThemeSection is split out because it owns additional theme-creation state.
 */
'use client'

import { useDisplayPrefs } from '@/hooks/useSettings'
import ThemeSection from './ThemeSection'

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm font-medium">{label}</span>
      <div className="ml-4">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function Select<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => {
        const raw = e.target.value
        // Map back through options to preserve the original type (number vs string)
        const match = options.find((o) => String(o.value) === raw)
        if (match !== undefined) onChange(match.value)
      }}
      className="rounded-md border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export default function DisplaySettingsPage() {
  const { prefs, update } = useDisplayPrefs()

  return (
    <div className="space-y-6">
      {/* Appearance */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Appearance</h2>
        <ThemeSection />
      </section>

      {/* Home Page */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Home Page</h2>
        <SettingRow label="Show Continue Watching">
          <Toggle
            checked={prefs.showContinueWatching}
            onChange={(v) => update({ showContinueWatching: v })}
          />
        </SettingRow>
        <SettingRow label="Show Recently Added">
          <Toggle
            checked={prefs.showRecentlyAdded}
            onChange={(v) => update({ showRecentlyAdded: v })}
          />
        </SettingRow>
        <SettingRow label="Show Next Up">
          <Toggle checked={prefs.showNextUp} onChange={(v) => update({ showNextUp: v })} />
        </SettingRow>
        <SettingRow label="Carousel Item Limit">
          <Select
            value={prefs.carouselLimit}
            onChange={(v) => update({ carouselLimit: v })}
            options={[
              { value: 5 as const, label: '5 items' },
              { value: 8 as const, label: '8 items' },
              { value: 10 as const, label: '10 items' },
              { value: 0 as const, label: 'No limit' },
            ]}
          />
        </SettingRow>
      </section>

      {/* Library */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Library</h2>
        <SettingRow label="Default View">
          <Select
            value={prefs.defaultView}
            onChange={(v) => update({ defaultView: v })}
            options={[
              { value: 'grid', label: 'Grid' },
              { value: 'list', label: 'List' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Poster Size">
          <Select
            value={prefs.posterSize}
            onChange={(v) => update({ posterSize: v })}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'medium', label: 'Medium' },
              { value: 'large', label: 'Large' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Show Type Badge">
          <Toggle
            checked={prefs.showTypeBadge}
            onChange={(v) => update({ showTypeBadge: v })}
          />
        </SettingRow>
        <SettingRow label="Show Release Year">
          <Toggle checked={prefs.showYear} onChange={(v) => update({ showYear: v })} />
        </SettingRow>
      </section>

      {/* Sidebar */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Sidebar</h2>
        <SettingRow label="Collapsed by Default">
          <Toggle
            checked={prefs.sidebarCollapsed}
            onChange={(v) => update({ sidebarCollapsed: v })}
          />
        </SettingRow>
        <SettingRow label="Show Labels">
          <Toggle
            checked={prefs.sidebarLabels}
            onChange={(v) => update({ sidebarLabels: v })}
          />
        </SettingRow>
      </section>
    </div>
  )
}
