'use client'

import { usePlaybackPrefs } from '@/hooks/useSettings'
import type { PlaybackPrefs } from '@/hooks/useSettings'

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <span className="text-sm font-medium">{label}</span>
      <div className="ml-4">{children}</div>
    </div>
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

const QUALITY_OPTIONS: { value: PlaybackPrefs['quality']; label: string }[] = [
  { value: 0, label: 'Auto (Best available)' },
  { value: 120000000, label: '4K (120 Mbps)' },
  { value: 20000000, label: '1080p (20 Mbps)' },
  { value: 8000000, label: '1080p (8 Mbps)' },
  { value: 4000000, label: '720p (4 Mbps)' },
  { value: 1500000, label: '480p (1.5 Mbps)' },
]

const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
]

const SUBTITLE_LANG_OPTIONS = [
  { value: '', label: 'Off' },
  ...LANG_OPTIONS,
]

const DELAY_OPTIONS: { value: PlaybackPrefs['autoPlayDelay']; label: string }[] = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 0, label: 'Immediately' },
]

export default function PlaybackSettingsPage() {
  const { prefs, update } = usePlaybackPrefs()

  return (
    <div className="space-y-6">
      {/* Video Quality */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Video Quality</h2>
        <SettingRow label="Preferred Quality">
          <Select
            value={prefs.quality}
            onChange={(v) => update({ quality: v })}
            options={QUALITY_OPTIONS}
          />
        </SettingRow>
        <SettingRow label="Hardware Acceleration">
          <Select
            value={prefs.hwAccel}
            onChange={(v) => update({ hwAccel: v })}
            options={[
              { value: 'auto', label: 'Auto (recommended)' },
              { value: 'software', label: 'Software only' },
            ]}
          />
        </SettingRow>
      </section>

      {/* Audio & Subtitles */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Audio & Subtitles</h2>
        <SettingRow label="Audio Language">
          <Select
            value={prefs.audioLang}
            onChange={(v) => update({ audioLang: v })}
            options={LANG_OPTIONS}
          />
        </SettingRow>
        <SettingRow label="Subtitle Language">
          <Select
            value={prefs.subtitleLang}
            onChange={(v) => update({ subtitleLang: v })}
            options={SUBTITLE_LANG_OPTIONS}
          />
        </SettingRow>
        <SettingRow label="Subtitle Size">
          <Select
            value={prefs.subtitleSize}
            onChange={(v) => update({ subtitleSize: v })}
            options={[
              { value: 'small', label: 'Small' },
              { value: 'normal', label: 'Normal' },
              { value: 'large', label: 'Large' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Subtitle Background">
          <Select
            value={prefs.subtitleBg}
            onChange={(v) => update({ subtitleBg: v })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'semi', label: 'Semi-transparent' },
              { value: 'opaque', label: 'Opaque' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Subtitle Color">
          <Select
            value={prefs.subtitleColor}
            onChange={(v) => update({ subtitleColor: v })}
            options={[
              { value: 'white', label: 'White' },
              { value: 'yellow', label: 'Yellow' },
            ]}
          />
        </SettingRow>
      </section>

      {/* Playback Behavior */}
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold mb-4">Playback Behavior</h2>
        <SettingRow label="Auto-play Next Episode">
          <Toggle checked={prefs.autoPlayNext} onChange={(v) => update({ autoPlayNext: v })} />
        </SettingRow>
        <SettingRow label="Auto-play Delay">
          <Select
            value={prefs.autoPlayDelay}
            onChange={(v) => update({ autoPlayDelay: v })}
            options={DELAY_OPTIONS}
          />
        </SettingRow>
        <SettingRow label="Skip Intro">
          <Toggle checked={prefs.skipIntro} onChange={(v) => update({ skipIntro: v })} />
        </SettingRow>
        <SettingRow label="Resume Mode">
          <Select
            value={prefs.resumeMode}
            onChange={(v) => update({ resumeMode: v })}
            options={[
              { value: 'ask', label: 'Always ask' },
              { value: 'resume', label: 'Resume automatically' },
              { value: 'restart', label: 'Always restart' },
            ]}
          />
        </SettingRow>
      </section>
    </div>
  )
}
