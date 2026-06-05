/**
 * Full qBittorrent settings UI (tabs: Downloads, Connection, Speed, BitTorrent,
 * Queue, Privacy, Advanced, RSS, WebUI, Interface).
 *
 * The first 9 tabs read/write qBittorrent directly via GET /api/qbit/app/preferences
 * and POST /api/qbit/app/setPreferences. Only the diff for the active tab's
 * fields is sent on save — not the entire preferences object — to avoid
 * accidentally overwriting settings changed by another client since load time.
 *
 * The "Interface" tab is localStorage-only (TorrentUIPreferences) and never
 * touches qBittorrent; it controls how the /downloads page renders locally.
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import type { QbtPreferences, TorrentUIPreferences } from '@/types/torrent'
import { AdvancedTab, RSSTab, WebUITab } from './NewTabs'

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
  { id: 'advanced', label: 'Advanced' },
  { id: 'rss', label: 'RSS' },
  { id: 'webui', label: 'WebUI' },
  { id: 'interface', label: 'Interface' },
]

// Maps each tab ID to the QbtPreferences fields it owns. Used both to compute
// the save diff (only changed fields in scope) and to highlight dirty tabs.
const TAB_FIELDS: Record<string, (keyof QbtPreferences)[]> = {
  downloads: [
    'save_path', 'temp_path_enabled', 'temp_path', 'incomplete_files_ext',
    'preallocate_all', 'auto_delete_mode', 'create_subfolder_enabled',
    'start_paused_enabled', 'auto_tmm_enabled', 'export_dir', 'export_dir_fin',
    'torrent_changed_tmm_enabled', 'save_path_changed_tmm_enabled', 'category_changed_tmm_enabled',
    'use_category_paths_in_manual_mode', 'add_to_top_of_queue', 'add_stopped_enabled',
    'torrent_content_layout', 'torrent_stop_condition', 'merge_trackers',
    'excluded_file_names_enabled', 'excluded_file_names',
    'autorun_on_torrent_added_enabled', 'autorun_on_torrent_added_program',
    'autorun_enabled', 'autorun_program',
    'mail_notification_enabled', 'mail_notification_sender', 'mail_notification_email',
    'mail_notification_smtp', 'mail_notification_ssl_enabled', 'mail_notification_auth_enabled',
    'mail_notification_username', 'mail_notification_password',
  ],
  connection: [
    'listen_port', 'upnp', 'random_port', 'encryption', 'dht', 'pex', 'lsd',
    'max_connec', 'max_connec_per_torrent', 'max_uploads', 'max_uploads_per_torrent',
    'outgoing_ports_min', 'outgoing_ports_max',
    'bittorrent_protocol', 'connection_speed', 'current_network_interface', 'current_interface_address',
    'i2p_enabled', 'i2p_address', 'i2p_port', 'i2p_mixed_mode',
    'i2p_inbound_quantity', 'i2p_outbound_quantity', 'i2p_inbound_length', 'i2p_outbound_length',
    'proxy_bittorrent', 'proxy_rss', 'proxy_misc', 'proxy_hostname_lookup', 'upnp_lease_duration',
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
    'announce_ip', 'add_trackers_enabled', 'add_trackers',
    'add_trackers_from_url_enabled', 'add_trackers_url', 'max_active_checking_torrents',
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
  advanced: [
    'async_io_threads', 'hashing_threads', 'file_pool_size', 'checking_memory_use',
    'disk_cache', 'disk_cache_ttl', 'disk_queue_size', 'use_os_cache',
    'enable_coalesce_read_write', 'enable_piece_extent_affinity', 'enable_upload_suggestions',
    'disk_io_type', 'disk_io_read_mode', 'disk_io_write_mode',
    'save_resume_data_interval', 'resume_data_storage_type', 'torrent_content_remove_option',
    'send_buffer_watermark', 'send_buffer_low_watermark', 'send_buffer_watermark_factor',
    'socket_send_buffer_size', 'socket_receive_buffer_size', 'socket_backlog_size',
    'connection_speed', 'utp_tcp_mixed_mode', 'upload_slots_behavior', 'upload_choking_algorithm',
    'request_queue_size', 'max_concurrent_http_announces', 'stop_tracker_timeout',
    'peer_tos', 'peer_turnover', 'peer_turnover_cutoff', 'peer_turnover_interval',
    'dht_bootstrap_nodes', 'idn_support_enabled', 'enable_multi_connections_from_same_ip',
    'validate_https_tracker_certificate', 'ssrf_mitigation', 'block_peers_on_privileged_ports',
    'enable_embedded_tracker', 'embedded_tracker_port', 'embedded_tracker_port_forwarding',
    'bdecode_depth_limit', 'bdecode_token_limit', 'recheck_completed_torrents',
    'resolve_peer_countries', 'reannounce_when_address_changed',
    'memory_working_set_limit', 'performance_warning',
  ],
  rss: [
    'rss_processing_enabled', 'rss_refresh_interval', 'rss_max_articles_per_feed',
    'rss_fetch_delay', 'rss_auto_downloading_enabled', 'rss_download_repack_proper_episodes',
    'rss_smart_episode_filters',
  ],
  webui: [
    'web_ui_address', 'web_ui_port', 'web_ui_upnp', 'use_https',
    'web_ui_https_cert_path', 'web_ui_https_key_path', 'web_ui_username',
    'bypass_local_auth', 'bypass_auth_subnet_whitelist_enabled', 'bypass_auth_subnet_whitelist',
    'web_ui_max_auth_fail_count', 'web_ui_ban_duration', 'web_ui_session_timeout',
    'web_ui_clickjacking_protection_enabled', 'web_ui_csrf_protection_enabled',
    'web_ui_secure_cookie_enabled', 'web_ui_host_header_validation_enabled', 'web_ui_domain_list',
    'web_ui_reverse_proxy_enabled', 'web_ui_reverse_proxies_list',
    'web_ui_use_custom_http_headers_enabled', 'web_ui_custom_http_headers',
    'alternative_webui_enabled', 'alternative_webui_path',
    'dyndns_enabled', 'dyndns_service', 'dyndns_domain', 'dyndns_username', 'dyndns_password',
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
    // Spread defaults first so new fields added in future versions get their defaults
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

    // Send only the changed fields in scope for the active tab; qBittorrent
    // accepts a partial JSON object and merges it into its preferences.
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
      // qBittorrent's setPreferences endpoint expects form-urlencoded with a
      // single "json" field containing the stringified diff object.
      const body = new URLSearchParams({ json: JSON.stringify(diff) })
      const res = await fetch('/api/qbit/app/setPreferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // Advance the baseline so the dirty indicator resets without a full refetch
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
          {activeTab === 'advanced' && current && (
            <AdvancedTab prefs={current} update={updateField} />
          )}
          {activeTab === 'rss' && current && (
            <RSSTab prefs={current} update={updateField} />
          )}
          {activeTab === 'webui' && current && (
            <WebUITab prefs={current} update={updateField} />
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

      <SectionCard title="Automatic Torrent Management">
        <SettingRow label="Relocate torrent when its Category's save path changes">
          <Toggle checked={prefs.torrent_changed_tmm_enabled} onChange={(v) => update('torrent_changed_tmm_enabled', v)} />
        </SettingRow>
        <SettingRow label="Relocate torrent when the default save path changes">
          <Toggle checked={prefs.save_path_changed_tmm_enabled} onChange={(v) => update('save_path_changed_tmm_enabled', v)} />
        </SettingRow>
        <SettingRow label="Relocate torrent when its Category changes">
          <Toggle checked={prefs.category_changed_tmm_enabled} onChange={(v) => update('category_changed_tmm_enabled', v)} />
        </SettingRow>
        <SettingRow label="Use Category paths in manual mode">
          <Toggle checked={prefs.use_category_paths_in_manual_mode} onChange={(v) => update('use_category_paths_in_manual_mode', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Content Layout">
        <SettingRow label="Torrent content layout">
          <SelectField
            value={prefs.torrent_content_layout}
            onChange={(v) => update('torrent_content_layout', v)}
            options={[
              { value: 'Original', label: 'Original' },
              { value: 'Subfolder', label: 'Subfolder' },
              { value: 'NoSubfolder', label: 'No Subfolder' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Torrent stop condition">
          <SelectField
            value={prefs.torrent_stop_condition}
            onChange={(v) => update('torrent_stop_condition', v)}
            options={[
              { value: 'None', label: 'None' },
              { value: 'MetadataReceived', label: 'Metadata received' },
              { value: 'FilesChecked', label: 'Files checked' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Add torrents to top of queue">
          <Toggle checked={prefs.add_to_top_of_queue} onChange={(v) => update('add_to_top_of_queue', v)} />
        </SettingRow>
        <SettingRow label="Add torrents in stopped state">
          <Toggle checked={prefs.add_stopped_enabled} onChange={(v) => update('add_stopped_enabled', v)} />
        </SettingRow>
        <SettingRow label="Merge trackers when adding duplicate torrent">
          <Toggle checked={prefs.merge_trackers} onChange={(v) => update('merge_trackers', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="File Exclusions">
        <SettingRow label="Enable file name exclusion patterns">
          <Toggle checked={prefs.excluded_file_names_enabled} onChange={(v) => update('excluded_file_names_enabled', v)} />
        </SettingRow>
        {prefs.excluded_file_names_enabled && (
          <div className="py-2">
            <label className="block text-sm font-medium mb-2">Exclusion patterns (one per line)</label>
            <textarea
              value={prefs.excluded_file_names}
              onChange={(e) => update('excluded_file_names', e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              placeholder="*.nfo&#10;*.txt"
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Run External Program">
        <SettingRow label="Run program when torrent is added">
          <Toggle checked={prefs.autorun_on_torrent_added_enabled} onChange={(v) => update('autorun_on_torrent_added_enabled', v)} />
        </SettingRow>
        {prefs.autorun_on_torrent_added_enabled && (
          <SettingRow label="Program path/arguments (%f=path, %n=name)">
            <TextInput value={prefs.autorun_on_torrent_added_program} onChange={(v) => update('autorun_on_torrent_added_program', v)} placeholder="/usr/bin/notify-send %n" className="w-96" />
          </SettingRow>
        )}
        <SettingRow label="Run program when download finishes">
          <Toggle checked={prefs.autorun_enabled} onChange={(v) => update('autorun_enabled', v)} />
        </SettingRow>
        {prefs.autorun_enabled && (
          <SettingRow label="Program path/arguments (%f=path, %n=name)">
            <TextInput value={prefs.autorun_program} onChange={(v) => update('autorun_program', v)} placeholder="/usr/bin/notify-send %n" className="w-96" />
          </SettingRow>
        )}
      </SectionCard>

      <SectionCard title="Email Notifications">
        <SettingRow label="Enable email notifications">
          <Toggle checked={prefs.mail_notification_enabled} onChange={(v) => update('mail_notification_enabled', v)} />
        </SettingRow>
        {prefs.mail_notification_enabled && (
          <>
            <SettingRow label="SMTP server">
              <TextInput value={prefs.mail_notification_smtp} onChange={(v) => update('mail_notification_smtp', v)} placeholder="smtp.example.com" />
            </SettingRow>
            <SettingRow label="Use SSL">
              <Toggle checked={prefs.mail_notification_ssl_enabled} onChange={(v) => update('mail_notification_ssl_enabled', v)} />
            </SettingRow>
            <SettingRow label="From address">
              <TextInput value={prefs.mail_notification_sender} onChange={(v) => update('mail_notification_sender', v)} placeholder="qbt@example.com" />
            </SettingRow>
            <SettingRow label="To address">
              <TextInput value={prefs.mail_notification_email} onChange={(v) => update('mail_notification_email', v)} placeholder="you@example.com" />
            </SettingRow>
            <SettingRow label="Use authentication">
              <Toggle checked={prefs.mail_notification_auth_enabled} onChange={(v) => update('mail_notification_auth_enabled', v)} />
            </SettingRow>
            {prefs.mail_notification_auth_enabled && (
              <>
                <SettingRow label="SMTP username">
                  <TextInput value={prefs.mail_notification_username} onChange={(v) => update('mail_notification_username', v)} />
                </SettingRow>
                <SettingRow label="SMTP password">
                  <TextInput type="password" value={prefs.mail_notification_password} onChange={(v) => update('mail_notification_password', v)} />
                </SettingRow>
              </>
            )}
          </>
        )}
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
        <SettingRow label="UPnP lease duration (seconds, 0=permanent)">
          <NumberInput value={prefs.upnp_lease_duration} onChange={(v) => update('upnp_lease_duration', v)} min={0} />
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

      <SectionCard title="Protocol">
        <SettingRow label="Preferred BitTorrent protocol">
          <SelectField
            value={prefs.bittorrent_protocol}
            onChange={(v) => update('bittorrent_protocol', v)}
            options={[
              { value: 0, label: 'TCP and uTP' },
              { value: 1, label: 'TCP' },
              { value: 2, label: 'uTP' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Outgoing connections per second">
          <NumberInput value={prefs.connection_speed} onChange={(v) => update('connection_speed', v)} min={0} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Network Interface">
        <SettingRow label="Network interface">
          <TextInput value={prefs.current_network_interface} onChange={(v) => update('current_network_interface', v)} placeholder="(any)" />
        </SettingRow>
        <SettingRow label="Optional IP address">
          <TextInput value={prefs.current_interface_address} onChange={(v) => update('current_interface_address', v)} placeholder="(any IP)" />
        </SettingRow>
      </SectionCard>

      <SectionCard title="I2P">
        <SettingRow label="Enable I2P torrents">
          <Toggle checked={prefs.i2p_enabled} onChange={(v) => update('i2p_enabled', v)} />
        </SettingRow>
        {prefs.i2p_enabled && (
          <>
            <SettingRow label="I2P SAM host">
              <TextInput value={prefs.i2p_address} onChange={(v) => update('i2p_address', v)} placeholder="127.0.0.1" />
            </SettingRow>
            <SettingRow label="I2P SAM port">
              <NumberInput value={prefs.i2p_port} onChange={(v) => update('i2p_port', v)} min={1} max={65535} />
            </SettingRow>
            <SettingRow label="Mixed mode (I2P + clearnet)">
              <Toggle checked={prefs.i2p_mixed_mode} onChange={(v) => update('i2p_mixed_mode', v)} />
            </SettingRow>
            <SettingRow label="Inbound tunnels">
              <NumberInput value={prefs.i2p_inbound_quantity} onChange={(v) => update('i2p_inbound_quantity', v)} min={1} max={16} />
            </SettingRow>
            <SettingRow label="Outbound tunnels">
              <NumberInput value={prefs.i2p_outbound_quantity} onChange={(v) => update('i2p_outbound_quantity', v)} min={1} max={16} />
            </SettingRow>
            <SettingRow label="Inbound tunnel hops">
              <NumberInput value={prefs.i2p_inbound_length} onChange={(v) => update('i2p_inbound_length', v)} min={0} max={7} />
            </SettingRow>
            <SettingRow label="Outbound tunnel hops">
              <NumberInput value={prefs.i2p_outbound_length} onChange={(v) => update('i2p_outbound_length', v)} min={0} max={7} />
            </SettingRow>
          </>
        )}
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
        <SettingRow label="IP address announced to trackers">
          <TextInput value={prefs.announce_ip} onChange={(v) => update('announce_ip', v)} placeholder="Leave empty to use default" />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Tracker Augmentation">
        <SettingRow label="Automatically add trackers to new torrents">
          <Toggle checked={prefs.add_trackers_enabled} onChange={(v) => update('add_trackers_enabled', v)} />
        </SettingRow>
        {prefs.add_trackers_enabled && (
          <div className="py-2">
            <label className="block text-sm font-medium mb-2">Trackers to add (one per line)</label>
            <textarea
              value={prefs.add_trackers}
              onChange={(e) => update('add_trackers', e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              placeholder="https://tracker.example.com/announce"
            />
          </div>
        )}
        <SettingRow label="Fetch additional trackers from URL">
          <Toggle checked={prefs.add_trackers_from_url_enabled} onChange={(v) => update('add_trackers_from_url_enabled', v)} />
        </SettingRow>
        {prefs.add_trackers_from_url_enabled && (
          <SettingRow label="Tracker list URL">
            <TextInput value={prefs.add_trackers_url} onChange={(v) => update('add_trackers_url', v)} placeholder="https://example.com/trackers.txt" className="w-80" />
          </SettingRow>
        )}
        <SettingRow label="Max active checking torrents">
          <NumberInput value={prefs.max_active_checking_torrents} onChange={(v) => update('max_active_checking_torrents', v)} min={1} />
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
            <SettingRow label="Use proxy for BitTorrent">
              <Toggle checked={prefs.proxy_bittorrent} onChange={(v) => update('proxy_bittorrent', v)} />
            </SettingRow>
            <SettingRow label="Use proxy for RSS">
              <Toggle checked={prefs.proxy_rss} onChange={(v) => update('proxy_rss', v)} />
            </SettingRow>
            <SettingRow label="Use proxy for general purposes">
              <Toggle checked={prefs.proxy_misc} onChange={(v) => update('proxy_misc', v)} />
            </SettingRow>
            <SettingRow label="Perform hostname lookup via proxy">
              <Toggle checked={prefs.proxy_hostname_lookup} onChange={(v) => update('proxy_hostname_lookup', v)} />
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
