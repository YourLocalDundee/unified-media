'use client'

import { useEffect, useState, useCallback } from 'react'
import type { QbtPreferences, TorrentUIPreferences } from '@/types/torrent'

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="mr-4 min-w-0">
        <span className="text-sm font-medium">{label}</span>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
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

function SelectField<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  disabled?: boolean
}) {
  return (
    <select
      value={String(value)}
      disabled={disabled}
      onChange={(e) => {
        const raw = e.target.value
        const match = options.find((o) => String(o.value) === raw)
        if (match !== undefined) onChange(match.value)
      }}
      className="rounded-md border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  disabled?: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10)
        if (!isNaN(n)) onChange(n)
      }}
      className="w-28 rounded-md border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
    />
  )
}

function TextInput({
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
  className,
}: {
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed ${className ?? 'w-64'}`}
    />
  )
}

function SectionCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 space-y-0">
      {title && <h2 className="text-base font-semibold mb-4">{title}</h2>}
      {children}
    </section>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="h-4 w-48 rounded bg-muted animate-pulse" />
      <div className="h-6 w-11 rounded-full bg-muted animate-pulse" />
    </div>
  )
}

function TabBar({
  tabs,
  activeTab,
  setActiveTab,
  dirtyTabs,
}: {
  tabs: { id: string; label: string }[]
  activeTab: string
  setActiveTab: (id: string) => void
  dirtyTabs: Set<string>
}) {
  return (
    <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
      {tabs.map((tab) => {
        const isDirty = dirtyTabs.has(tab.id)
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {isDirty && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
          </button>
        )
      })}
    </div>
  )
}

function TabActions({
  onSave,
  onReset,
  saving,
  hasDirty,
}: {
  onSave: () => void
  onReset: () => void
  saving: boolean
  hasDirty: boolean
}) {
  return (
    <div className="flex items-center gap-3 mt-6">
      <button
        onClick={onSave}
        disabled={saving || !hasDirty}
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Save changes'}
        {hasDirty && !saving && (
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />
        )}
      </button>
      <button
        onClick={onReset}
        disabled={saving || !hasDirty}
        className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Reset to saved
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'downloads', label: 'Downloads' },
  { id: 'connection', label: 'Connection' },
  { id: 'speed', label: 'Speed' },
  { id: 'bittorrent', label: 'BitTorrent' },
  { id: 'queue', label: 'Queue' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'interface', label: 'Interface' },
]

// Fields owned by each qBit tab (used for diff & dirty detection)
const TAB_FIELDS: Record<string, (keyof QbtPreferences)[]> = {
  downloads: [
    'save_path', 'temp_path_enabled', 'temp_path', 'incomplete_files_ext',
    'preallocate_all', 'auto_delete_mode', 'create_subfolder_enabled',
    'start_paused_enabled', 'auto_tmm_enabled', 'export_dir', 'export_dir_fin',
  ],
  connection: [
    'listen_port', 'upnp', 'random_port', 'encryption', 'dht', 'pex', 'lsd',
    'max_connec', 'max_connec_per_torrent', 'max_uploads', 'max_uploads_per_torrent',
    'outgoing_ports_min', 'outgoing_ports_max',
  ],
  speed: [
    'dl_limit', 'up_limit', 'alt_dl_limit', 'alt_up_limit', 'scheduler_enabled',
    'schedule_from_hour', 'schedule_from_min', 'schedule_to_hour', 'schedule_to_min',
    'scheduler_days', 'limit_utp_rate', 'limit_tcp_overhead', 'limit_lan_peers',
  ],
  bittorrent: [
    'anonymous_mode', 'max_ratio_enabled', 'max_ratio', 'max_seeding_time_enabled',
    'max_seeding_time', 'max_inactive_seeding_time_enabled', 'max_inactive_seeding_time',
    'max_ratio_act', 'announce_to_all_trackers', 'announce_to_all_tiers',
  ],
  queue: [
    'queueing_enabled', 'max_active_downloads', 'max_active_uploads', 'max_active_torrents',
    'dont_count_slow_torrents', 'slow_torrent_dl_rate_threshold',
    'slow_torrent_ul_rate_threshold', 'slow_torrent_inactive_timer',
  ],
  privacy: [
    'proxy_type', 'proxy_ip', 'proxy_port', 'proxy_auth_enabled', 'proxy_username',
    'proxy_password', 'proxy_peer_connections', 'proxy_torrents_only',
    'ip_filter_enabled', 'ip_filter_path', 'ip_filter_trackers', 'banned_IPs',
  ],
}

// ---------------------------------------------------------------------------
// Default UI preferences
// ---------------------------------------------------------------------------

const ALL_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'state', label: 'Status' },
  { key: 'size', label: 'Size' },
  { key: 'progress', label: 'Progress' },
  { key: 'dlspeed', label: 'DL Speed' },
  { key: 'upspeed', label: 'UL Speed' },
  { key: 'eta', label: 'ETA' },
  { key: 'ratio', label: 'Ratio' },
  { key: 'num_seeds', label: 'Seeds' },
  { key: 'num_leechs', label: 'Peers' },
  { key: 'added_on', label: 'Added' },
  { key: 'category', label: 'Category' },
  { key: 'tags', label: 'Tags' },
  { key: 'save_path', label: 'Save Path' },
  { key: 'completion_on', label: 'Completed' },
  { key: 'time_active', label: 'Time Active' },
  { key: 'uploaded', label: 'Upload Total' },
  { key: 'downloaded', label: 'Download Total' },
  { key: 'availability', label: 'Availability' },
]

const UI_PREFS_KEY = 'unified-torrent-prefs'

const DEFAULT_UI_PREFS: TorrentUIPreferences = {
  visibleColumns: ['name', 'state', 'size', 'progress', 'dlspeed', 'upspeed', 'eta', 'ratio'],
  columnOrder: ALL_COLUMNS.map((c) => c.key),
  sortColumn: 'added_on',
  sortReverse: false,
  rowsPerPage: 50,
  refreshInterval: 5000,
  confirmDelete: true,
  confirmDeleteFiles: true,
  showSpeedInToolbar: true,
  dateFormat: 'relative',
  defaultFilter: 'all',
  sidebarCollapsed: false,
}

function loadUIPrefs(): TorrentUIPreferences {
  if (typeof window === 'undefined') return DEFAULT_UI_PREFS
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY)
    if (!raw) return DEFAULT_UI_PREFS
    return { ...DEFAULT_UI_PREFS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_UI_PREFS
  }
}

function saveUIPrefs(prefs: TorrentUIPreferences) {
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs))
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TorrentSettingsClient() {
  const [activeTab, setActiveTab] = useState('downloads')
  const [original, setOriginal] = useState<QbtPreferences | null>(null)
  const [current, setCurrent] = useState<QbtPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [uiPrefs, setUIPrefs] = useState<TorrentUIPreferences>(DEFAULT_UI_PREFS)
  const [originalUIPrefs, setOriginalUIPrefs] = useState<TorrentUIPreferences>(DEFAULT_UI_PREFS)
  const [showPassword, setShowPassword] = useState(false)

  // Load UI prefs from localStorage on mount
  useEffect(() => {
    const loaded = loadUIPrefs()
    setUIPrefs(loaded)
    setOriginalUIPrefs(loaded)
  }, [])

  const fetchPrefs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/qbit/app/preferences')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: QbtPreferences = await res.json()
      setOriginal(data)
      setCurrent(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPrefs() }, [fetchPrefs])

  // Compute dirty tabs
  const dirtyTabs = new Set<string>()
  if (current && original) {
    const cur = current as unknown as Record<string, unknown>
    const orig = original as unknown as Record<string, unknown>
    for (const [tabId, fields] of Object.entries(TAB_FIELDS)) {
      for (const field of fields) {
        if (cur[field] !== orig[field]) {
          dirtyTabs.add(tabId)
          break
        }
      }
    }
  }
  // Check UI prefs dirty
  if (JSON.stringify(uiPrefs) !== JSON.stringify(originalUIPrefs)) {
    dirtyTabs.add('interface')
  }

  const currentTabDirty = dirtyTabs.has(activeTab)

  function updateField<K extends keyof QbtPreferences>(key: K, value: QbtPreferences[K]) {
    setCurrent((prev) => prev ? { ...prev, [key]: value } : prev)
  }

  async function handleSave() {
    if (activeTab === 'interface') {
      saveUIPrefs(uiPrefs)
      setOriginalUIPrefs(uiPrefs)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
      return
    }

    if (!current || !original) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    // Compute diff for current tab's fields only
    const tabFields = TAB_FIELDS[activeTab] ?? []
    const diff: Record<string, unknown> = {}
    const cur = current as unknown as Record<string, unknown>
    const orig = original as unknown as Record<string, unknown>
    for (const field of tabFields) {
      if (cur[field] !== orig[field]) {
        diff[field] = cur[field]
      }
    }

    if (Object.keys(diff).length === 0) {
      setSaving(false)
      return
    }

    try {
      const body = new URLSearchParams({ json: JSON.stringify(diff) })
      const res = await fetch('/api/qbit/app/setPreferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Merge saved fields into original
      setOriginal((prev) => prev ? { ...prev, ...diff } as QbtPreferences : prev)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (activeTab === 'interface') {
      setUIPrefs(originalUIPrefs)
      return
    }
    if (!original || !current) return
    // Reset only current tab's fields
    const tabFields = TAB_FIELDS[activeTab] ?? []
    const patch: Partial<QbtPreferences> = {}
    const orig = original as unknown as Record<string, unknown>
    const patchRec = patch as unknown as Record<string, unknown>
    for (const field of tabFields) {
      patchRec[field] = orig[field]
    }
    setCurrent((prev) => prev ? { ...prev, ...patch } : prev)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4">
      <TabBar
        tabs={TABS}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        dirtyTabs={dirtyTabs}
      />

      {error && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 flex items-center justify-between">
          <p className="text-sm text-destructive">Failed to load preferences: {error}</p>
          <button
            onClick={fetchPrefs}
            className="ml-4 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            Retry
          </button>
        </div>
      )}

      {saveError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
          <p className="text-sm text-destructive">Save failed: {saveError}</p>
        </div>
      )}

      {saveSuccess && (
        <div className="rounded-lg border border-green-500 bg-green-500/10 p-3">
          <p className="text-sm text-green-700 dark:text-green-400">Settings saved.</p>
        </div>
      )}

      {loading && activeTab !== 'interface' ? (
        <SectionCard>
          {Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
        </SectionCard>
      ) : (
        <>
          {activeTab === 'downloads' && current && (
            <DownloadsTab prefs={current} update={updateField} />
          )}
          {activeTab === 'connection' && current && (
            <ConnectionTab prefs={current} update={updateField} />
          )}
          {activeTab === 'speed' && current && (
            <SpeedTab prefs={current} update={updateField} />
          )}
          {activeTab === 'bittorrent' && current && (
            <BitTorrentTab prefs={current} update={updateField} />
          )}
          {activeTab === 'queue' && current && (
            <QueueTab prefs={current} update={updateField} />
          )}
          {activeTab === 'privacy' && current && (
            <PrivacyTab
              prefs={current}
              update={updateField}
              showPassword={showPassword}
              setShowPassword={setShowPassword}
            />
          )}
          {activeTab === 'interface' && (
            <InterfaceTab prefs={uiPrefs} update={(patch) => setUIPrefs((p) => ({ ...p, ...patch }))} />
          )}

          {!error && (
            <TabActions
              onSave={handleSave}
              onReset={handleReset}
              saving={saving}
              hasDirty={currentTabDirty}
            />
          )}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Downloads
// ---------------------------------------------------------------------------

function DownloadsTab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  return (
    <div className="space-y-6">
      <SectionCard title="Save Locations">
        <SettingRow label="Default Save Path">
          <TextInput value={prefs.save_path} onChange={(v) => update('save_path', v)} />
        </SettingRow>
        <SettingRow label="Keep incomplete files in separate folder">
          <Toggle checked={prefs.temp_path_enabled} onChange={(v) => update('temp_path_enabled', v)} />
        </SettingRow>
        {prefs.temp_path_enabled && (
          <SettingRow label="Incomplete Files Location">
            <TextInput value={prefs.temp_path} onChange={(v) => update('temp_path', v)} />
          </SettingRow>
        )}
        <SettingRow label="Export .torrent files to">
          <TextInput value={prefs.export_dir} onChange={(v) => update('export_dir', v)} placeholder="Leave empty to disable" />
        </SettingRow>
        <SettingRow label="Export .torrent files for finished downloads to">
          <TextInput value={prefs.export_dir_fin} onChange={(v) => update('export_dir_fin', v)} placeholder="Leave empty to disable" />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Download Behavior">
        <SettingRow label="Append .!qB extension to incomplete files">
          <Toggle checked={prefs.incomplete_files_ext} onChange={(v) => update('incomplete_files_ext', v)} />
        </SettingRow>
        <SettingRow label="Pre-allocate disk space for all files">
          <Toggle checked={prefs.preallocate_all} onChange={(v) => update('preallocate_all', v)} />
        </SettingRow>
        <SettingRow label="Create subfolder for multi-file torrents">
          <Toggle checked={prefs.create_subfolder_enabled} onChange={(v) => update('create_subfolder_enabled', v)} />
        </SettingRow>
        <SettingRow label="Start torrents in paused state">
          <Toggle checked={prefs.start_paused_enabled} onChange={(v) => update('start_paused_enabled', v)} />
        </SettingRow>
        <SettingRow label="Automatic Torrent Management by default">
          <Toggle checked={prefs.auto_tmm_enabled} onChange={(v) => update('auto_tmm_enabled', v)} />
        </SettingRow>
        <SettingRow label="Delete .torrent files after adding">
          <SelectField
            value={prefs.auto_delete_mode}
            onChange={(v) => update('auto_delete_mode', v)}
            options={[
              { value: 0, label: 'Never' },
              { value: 1, label: 'Always' },
              { value: 2, label: 'Only when download finished' },
            ]}
          />
        </SettingRow>
      </SectionCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Connection
// ---------------------------------------------------------------------------

function ConnectionTab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  function randomizePort() {
    const port = Math.floor(Math.random() * (65535 - 1024) + 1024)
    update('listen_port', port)
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Listening Port">
        <SettingRow label="Listening Port">
          <div className="flex items-center gap-2">
            <NumberInput
              value={prefs.listen_port}
              onChange={(v) => update('listen_port', v)}
              min={1024}
              max={65535}
            />
            <button
              onClick={randomizePort}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Randomize
            </button>
          </div>
        </SettingRow>
        <SettingRow label="Enable UPnP / NAT-PMP port forwarding">
          <Toggle checked={prefs.upnp} onChange={(v) => update('upnp', v)} />
        </SettingRow>
        <SettingRow label="Use random port on each startup">
          <Toggle checked={prefs.random_port} onChange={(v) => update('random_port', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Connections">
        <SettingRow label="Encryption Mode">
          <SelectField
            value={prefs.encryption}
            onChange={(v) => update('encryption', v)}
            options={[
              { value: 0, label: 'Prefer encryption' },
              { value: 1, label: 'Force encryption on' },
              { value: 2, label: 'Disable encryption' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Enable DHT (decentralized network to find peers without a tracker)">
          <Toggle checked={prefs.dht} onChange={(v) => update('dht', v)} />
        </SettingRow>
        <SettingRow label="Enable Peer Exchange (PeX)">
          <Toggle checked={prefs.pex} onChange={(v) => update('pex', v)} />
        </SettingRow>
        <SettingRow label="Enable Local Service Discovery (LSD)">
          <Toggle checked={prefs.lsd} onChange={(v) => update('lsd', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Connection Limits">
        <SettingRow label="Global maximum connections (-1 = unlimited)">
          <NumberInput value={prefs.max_connec} onChange={(v) => update('max_connec', v)} />
        </SettingRow>
        <SettingRow label="Maximum connections per torrent">
          <NumberInput value={prefs.max_connec_per_torrent} onChange={(v) => update('max_connec_per_torrent', v)} />
        </SettingRow>
        <SettingRow label="Maximum upload slots (-1 = unlimited)">
          <NumberInput value={prefs.max_uploads} onChange={(v) => update('max_uploads', v)} />
        </SettingRow>
        <SettingRow label="Maximum upload slots per torrent">
          <NumberInput value={prefs.max_uploads_per_torrent} onChange={(v) => update('max_uploads_per_torrent', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Outgoing Ports">
        <SettingRow label="Outgoing port range minimum (0 = disabled)">
          <NumberInput value={prefs.outgoing_ports_min} onChange={(v) => update('outgoing_ports_min', v)} min={0} max={65535} />
        </SettingRow>
        <SettingRow label="Outgoing port range maximum">
          <NumberInput value={prefs.outgoing_ports_max} onChange={(v) => update('outgoing_ports_max', v)} min={0} max={65535} />
        </SettingRow>
      </SectionCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Speed
// ---------------------------------------------------------------------------

const SCHEDULER_DAYS_OPTIONS = [
  { value: 0, label: 'Every day' },
  { value: 1, label: 'Weekdays' },
  { value: 2, label: 'Weekends' },
  { value: 3, label: 'Monday' },
  { value: 4, label: 'Tuesday' },
  { value: 5, label: 'Wednesday' },
  { value: 6, label: 'Thursday' },
  { value: 7, label: 'Friday' },
  { value: 8, label: 'Saturday' },
  { value: 9, label: 'Sunday' },
]

function TimeInput({
  hour,
  minute,
  onHourChange,
  onMinuteChange,
}: {
  hour: number
  minute: number
  onHourChange: (v: number) => void
  onMinuteChange: (v: number) => void
}) {
  const hStr = String(hour).padStart(2, '0')
  const mStr = String(minute).padStart(2, '0')
  return (
    <input
      type="time"
      value={`${hStr}:${mStr}`}
      onChange={(e) => {
        const [h, m] = e.target.value.split(':').map(Number)
        if (!isNaN(h)) onHourChange(h)
        if (!isNaN(m)) onMinuteChange(m)
      }}
      className="rounded-md border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
    />
  )
}

function SpeedTab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  return (
    <div className="space-y-6">
      <SectionCard title="Global Rate Limits">
        <SettingRow label="Global Download Rate Limit (KB/s, 0 = unlimited)">
          <NumberInput value={prefs.dl_limit} onChange={(v) => update('dl_limit', v)} min={0} />
        </SettingRow>
        <SettingRow label="Global Upload Rate Limit (KB/s, 0 = unlimited)">
          <NumberInput value={prefs.up_limit} onChange={(v) => update('up_limit', v)} min={0} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Alternative Rate Limits">
        <SettingRow label="Alternative Download Rate Limit (KB/s)">
          <NumberInput value={prefs.alt_dl_limit} onChange={(v) => update('alt_dl_limit', v)} min={0} />
        </SettingRow>
        <SettingRow label="Alternative Upload Rate Limit (KB/s)">
          <NumberInput value={prefs.alt_up_limit} onChange={(v) => update('alt_up_limit', v)} min={0} />
        </SettingRow>
        <SettingRow label="Schedule alternative speed limits">
          <Toggle checked={prefs.scheduler_enabled} onChange={(v) => update('scheduler_enabled', v)} />
        </SettingRow>
        {prefs.scheduler_enabled && (
          <>
            <SettingRow label="From">
              <TimeInput
                hour={prefs.schedule_from_hour}
                minute={prefs.schedule_from_min}
                onHourChange={(v) => update('schedule_from_hour', v)}
                onMinuteChange={(v) => update('schedule_from_min', v)}
              />
            </SettingRow>
            <SettingRow label="To">
              <TimeInput
                hour={prefs.schedule_to_hour}
                minute={prefs.schedule_to_min}
                onHourChange={(v) => update('schedule_to_hour', v)}
                onMinuteChange={(v) => update('schedule_to_min', v)}
              />
            </SettingRow>
            <SettingRow label="On days">
              <SelectField
                value={prefs.scheduler_days}
                onChange={(v) => update('scheduler_days', v)}
                options={SCHEDULER_DAYS_OPTIONS}
              />
            </SettingRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="Protocol Overhead">
        <SettingRow label="Limit uTP protocol speed separately">
          <Toggle checked={prefs.limit_utp_rate} onChange={(v) => update('limit_utp_rate', v)} />
        </SettingRow>
        <SettingRow label="Limit overhead for protocol communications">
          <Toggle checked={prefs.limit_tcp_overhead} onChange={(v) => update('limit_tcp_overhead', v)} />
        </SettingRow>
        <SettingRow label="Apply speed limits to peers on local network">
          <Toggle checked={prefs.limit_lan_peers} onChange={(v) => update('limit_lan_peers', v)} />
        </SettingRow>
      </SectionCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: BitTorrent
// ---------------------------------------------------------------------------

function BitTorrentTab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  return (
    <div className="space-y-6">
      <SectionCard title="Privacy">
        <SettingRow label="Anonymous Mode" description="Hides client identity from trackers and peers">
          <Toggle checked={prefs.anonymous_mode} onChange={(v) => update('anonymous_mode', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Seeding Limits">
        <SettingRow label="Enable seeding ratio limit">
          <Toggle checked={prefs.max_ratio_enabled} onChange={(v) => update('max_ratio_enabled', v)} />
        </SettingRow>
        {prefs.max_ratio_enabled && (
          <SettingRow label="Stop seeding when ratio reaches">
            <input
              type="number"
              step="0.01"
              min="0"
              value={prefs.max_ratio}
              onChange={(e) => {
                const n = parseFloat(e.target.value)
                if (!isNaN(n)) update('max_ratio', n)
              }}
              className="w-28 rounded-md border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </SettingRow>
        )}
        <SettingRow label="Enable seeding time limit">
          <Toggle checked={prefs.max_seeding_time_enabled} onChange={(v) => update('max_seeding_time_enabled', v)} />
        </SettingRow>
        {prefs.max_seeding_time_enabled && (
          <SettingRow label="Stop seeding after (minutes)">
            <NumberInput value={prefs.max_seeding_time} onChange={(v) => update('max_seeding_time', v)} min={0} />
          </SettingRow>
        )}
        <SettingRow label="Enable inactivity limit for seeding">
          <Toggle
            checked={prefs.max_inactive_seeding_time_enabled}
            onChange={(v) => update('max_inactive_seeding_time_enabled', v)}
          />
        </SettingRow>
        {prefs.max_inactive_seeding_time_enabled && (
          <SettingRow label="Stop seeding if inactive for (minutes)">
            <NumberInput
              value={prefs.max_inactive_seeding_time}
              onChange={(v) => update('max_inactive_seeding_time', v)}
              min={0}
            />
          </SettingRow>
        )}
        <SettingRow label="Action when limit reached">
          <SelectField
            value={prefs.max_ratio_act}
            onChange={(v) => update('max_ratio_act', v)}
            options={[
              { value: 0, label: 'Pause' },
              { value: 1, label: 'Remove' },
              { value: 3, label: 'Remove with files' },
            ]}
          />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Announce">
        <SettingRow label="Announce to all trackers in a tier simultaneously">
          <Toggle checked={prefs.announce_to_all_trackers} onChange={(v) => update('announce_to_all_trackers', v)} />
        </SettingRow>
        <SettingRow label="Announce to all tiers simultaneously">
          <Toggle checked={prefs.announce_to_all_tiers} onChange={(v) => update('announce_to_all_tiers', v)} />
        </SettingRow>
      </SectionCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Queue
// ---------------------------------------------------------------------------

function QueueTab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  return (
    <div className="space-y-6">
      <SectionCard title="Queue Settings">
        <SettingRow label="Enable torrent queuing">
          <Toggle checked={prefs.queueing_enabled} onChange={(v) => update('queueing_enabled', v)} />
        </SettingRow>
        <SettingRow label="Maximum active downloads">
          <NumberInput value={prefs.max_active_downloads} onChange={(v) => update('max_active_downloads', v)} min={-1} />
        </SettingRow>
        <SettingRow label="Maximum active uploads">
          <NumberInput value={prefs.max_active_uploads} onChange={(v) => update('max_active_uploads', v)} min={-1} />
        </SettingRow>
        <SettingRow label="Maximum active torrents">
          <NumberInput value={prefs.max_active_torrents} onChange={(v) => update('max_active_torrents', v)} min={-1} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Slow Torrent Detection">
        <SettingRow label="Do not count slow torrents in active limits">
          <Toggle checked={prefs.dont_count_slow_torrents} onChange={(v) => update('dont_count_slow_torrents', v)} />
        </SettingRow>
        <SettingRow label="Slow torrent download rate threshold (KB/s)">
          <NumberInput
            value={prefs.slow_torrent_dl_rate_threshold}
            onChange={(v) => update('slow_torrent_dl_rate_threshold', v)}
            min={0}
          />
        </SettingRow>
        <SettingRow label="Slow torrent upload rate threshold (KB/s)">
          <NumberInput
            value={prefs.slow_torrent_ul_rate_threshold}
            onChange={(v) => update('slow_torrent_ul_rate_threshold', v)}
            min={0}
          />
        </SettingRow>
        <SettingRow label="Inactive timeout (seconds)">
          <NumberInput
            value={prefs.slow_torrent_inactive_timer}
            onChange={(v) => update('slow_torrent_inactive_timer', v)}
            min={0}
          />
        </SettingRow>
      </SectionCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Privacy
// ---------------------------------------------------------------------------

function PrivacyTab({
  prefs,
  update,
  showPassword,
  setShowPassword,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
  showPassword: boolean
  setShowPassword: (v: boolean) => void
}) {
  const proxyEnabled = prefs.proxy_type > 0

  return (
    <div className="space-y-6">
      <SectionCard title="Proxy">
        <SettingRow label="Proxy Type">
          <SelectField
            value={prefs.proxy_type}
            onChange={(v) => update('proxy_type', v)}
            options={[
              { value: 0, label: 'None' },
              { value: 1, label: 'HTTP' },
              { value: 2, label: 'SOCKS4' },
              { value: 3, label: 'SOCKS5' },
            ]}
          />
        </SettingRow>
        {proxyEnabled && (
          <>
            <SettingRow label="Proxy host">
              <TextInput value={prefs.proxy_ip} onChange={(v) => update('proxy_ip', v)} placeholder="hostname or IP" />
            </SettingRow>
            <SettingRow label="Proxy port">
              <NumberInput value={prefs.proxy_port} onChange={(v) => update('proxy_port', v)} min={1} max={65535} />
            </SettingRow>
            <SettingRow label="Use authentication">
              <Toggle checked={prefs.proxy_auth_enabled} onChange={(v) => update('proxy_auth_enabled', v)} />
            </SettingRow>
            {prefs.proxy_auth_enabled && (
              <>
                <SettingRow label="Username">
                  <TextInput value={prefs.proxy_username} onChange={(v) => update('proxy_username', v)} />
                </SettingRow>
                <SettingRow label="Password">
                  <div className="flex items-center gap-2">
                    <TextInput
                      type={showPassword ? 'text' : 'password'}
                      value={prefs.proxy_password}
                      onChange={(v) => update('proxy_password', v)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </SettingRow>
              </>
            )}
            <SettingRow label="Use proxy for peer connections">
              <Toggle checked={prefs.proxy_peer_connections} onChange={(v) => update('proxy_peer_connections', v)} />
            </SettingRow>
            <SettingRow label="Use proxy for torrents only">
              <Toggle checked={prefs.proxy_torrents_only} onChange={(v) => update('proxy_torrents_only', v)} />
            </SettingRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="IP Filter">
        <SettingRow label="Enable IP filter">
          <Toggle checked={prefs.ip_filter_enabled} onChange={(v) => update('ip_filter_enabled', v)} />
        </SettingRow>
        {prefs.ip_filter_enabled && (
          <>
            <SettingRow label="IP filter file path">
              <TextInput value={prefs.ip_filter_path} onChange={(v) => update('ip_filter_path', v)} placeholder="/path/to/filter.dat" />
            </SettingRow>
            <SettingRow label="Apply IP filter to trackers">
              <Toggle checked={prefs.ip_filter_trackers} onChange={(v) => update('ip_filter_trackers', v)} />
            </SettingRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="Banned IP Addresses">
        <div className="py-2">
          <label className="block text-sm font-medium mb-2">Banned IP addresses (one per line)</label>
          <textarea
            value={prefs.banned_IPs}
            onChange={(e) => update('banned_IPs', e.target.value)}
            rows={6}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            placeholder="192.168.1.100&#10;10.0.0.0/8"
          />
        </div>
      </SectionCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab: Interface (localStorage only)
// ---------------------------------------------------------------------------

function InterfaceTab({
  prefs,
  update,
}: {
  prefs: TorrentUIPreferences
  update: (patch: Partial<TorrentUIPreferences>) => void
}) {
  function toggleColumn(key: string) {
    const next = prefs.visibleColumns.includes(key)
      ? prefs.visibleColumns.filter((c) => c !== key)
      : [...prefs.visibleColumns, key]
    update({ visibleColumns: next })
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Visible Columns">
        <div className="grid grid-cols-2 gap-2 py-2">
          {ALL_COLUMNS.map((col) => (
            <label key={col.key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input
                type="checkbox"
                checked={prefs.visibleColumns.includes(col.key)}
                onChange={() => toggleColumn(col.key)}
                className="rounded border-border accent-primary"
              />
              {col.label}
            </label>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Sorting">
        <SettingRow label="Default sort column">
          <SelectField
            value={prefs.sortColumn}
            onChange={(v) => update({ sortColumn: v })}
            options={ALL_COLUMNS.map((c) => ({ value: c.key, label: c.label }))}
          />
        </SettingRow>
        <SettingRow label="Default sort direction">
          <SelectField
            value={prefs.sortReverse ? 'desc' : 'asc'}
            onChange={(v) => update({ sortReverse: v === 'desc' })}
            options={[
              { value: 'asc', label: 'Ascending' },
              { value: 'desc', label: 'Descending' },
            ]}
          />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Display">
        <SettingRow label="Rows per page">
          <SelectField
            value={String(prefs.rowsPerPage)}
            onChange={(v) => update({ rowsPerPage: v === 'all' ? 'all' : (parseInt(v, 10) as 25 | 50 | 100) })}
            options={[
              { value: '25', label: '25' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
              { value: 'all', label: 'All' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Refresh interval">
          <SelectField
            value={prefs.refreshInterval}
            onChange={(v) => update({ refreshInterval: v as 1000 | 2000 | 5000 | 10000 })}
            options={[
              { value: 1000, label: '1 second' },
              { value: 2000, label: '2 seconds' },
              { value: 5000, label: '5 seconds' },
              { value: 10000, label: '10 seconds' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Date format">
          <SelectField
            value={prefs.dateFormat}
            onChange={(v) => update({ dateFormat: v as 'relative' | 'absolute' })}
            options={[
              { value: 'relative', label: 'Relative (2 hours ago)' },
              { value: 'absolute', label: 'Absolute (2026-05-25 14:30)' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Show speed in toolbar">
          <Toggle checked={prefs.showSpeedInToolbar} onChange={(v) => update({ showSpeedInToolbar: v })} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Confirmations">
        <SettingRow label="Confirm before deleting torrents">
          <Toggle checked={prefs.confirmDelete} onChange={(v) => update({ confirmDelete: v })} />
        </SettingRow>
        <SettingRow label="Confirm before deleting files">
          <Toggle checked={prefs.confirmDeleteFiles} onChange={(v) => update({ confirmDeleteFiles: v })} />
        </SettingRow>
      </SectionCard>
    </div>
  )
}
