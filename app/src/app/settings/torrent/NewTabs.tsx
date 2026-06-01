'use client'
import type { QbtPreferences } from '@/types/torrent'

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

export function AdvancedTab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  return (
    <div className="space-y-6">
      <SectionCard title="Disk I/O">
        <SettingRow label="Asynchronous I/O threads">
          <NumberInput value={prefs.async_io_threads} onChange={(v) => update('async_io_threads', v)} min={1} />
        </SettingRow>
        <SettingRow label="Hashing threads">
          <NumberInput value={prefs.hashing_threads} onChange={(v) => update('hashing_threads', v)} min={1} />
        </SettingRow>
        <SettingRow label="File pool size">
          <NumberInput value={prefs.file_pool_size} onChange={(v) => update('file_pool_size', v)} min={1} />
        </SettingRow>
        <SettingRow label="Outstanding memory when checking (MiB)">
          <NumberInput value={prefs.checking_memory_use} onChange={(v) => update('checking_memory_use', v)} min={0} />
        </SettingRow>
        <SettingRow label="Disk cache (MiB, -1=auto)">
          <NumberInput value={prefs.disk_cache} onChange={(v) => update('disk_cache', v)} min={-1} />
        </SettingRow>
        <SettingRow label="Disk cache expiry (seconds)">
          <NumberInput value={prefs.disk_cache_ttl} onChange={(v) => update('disk_cache_ttl', v)} min={0} />
        </SettingRow>
        <SettingRow label="Disk queue size">
          <NumberInput value={prefs.disk_queue_size} onChange={(v) => update('disk_queue_size', v)} min={0} />
        </SettingRow>
        <SettingRow label="Use OS cache">
          <Toggle checked={prefs.use_os_cache} onChange={(v) => update('use_os_cache', v)} />
        </SettingRow>
        <SettingRow label="Coalesce reads & writes">
          <Toggle checked={prefs.enable_coalesce_read_write} onChange={(v) => update('enable_coalesce_read_write', v)} />
        </SettingRow>
        <SettingRow label="Piece extent affinity">
          <Toggle checked={prefs.enable_piece_extent_affinity} onChange={(v) => update('enable_piece_extent_affinity', v)} />
        </SettingRow>
        <SettingRow label="Send upload piece suggestions">
          <Toggle checked={prefs.enable_upload_suggestions} onChange={(v) => update('enable_upload_suggestions', v)} />
        </SettingRow>
        <SettingRow label="Disk I/O type">
          <SelectField
            value={prefs.disk_io_type}
            onChange={(v) => update('disk_io_type', v)}
            options={[
              { value: 0, label: 'Default' },
              { value: 1, label: 'Memory Mapped Files' },
              { value: 2, label: 'POSIX' },
              { value: 3, label: 'Simple Read/Write' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Disk I/O read mode">
          <SelectField
            value={prefs.disk_io_read_mode}
            onChange={(v) => update('disk_io_read_mode', v)}
            options={[
              { value: 0, label: 'Disable OS Cache' },
              { value: 1, label: 'Enable OS Cache' },
              { value: 2, label: 'Write Through' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Disk I/O write mode">
          <SelectField
            value={prefs.disk_io_write_mode}
            onChange={(v) => update('disk_io_write_mode', v)}
            options={[
              { value: 0, label: 'Disable OS Cache' },
              { value: 1, label: 'Enable OS Cache' },
              { value: 2, label: 'Write Through' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Save resume data interval (minutes)">
          <NumberInput value={prefs.save_resume_data_interval} onChange={(v) => update('save_resume_data_interval', v)} min={1} />
        </SettingRow>
        <SettingRow label="Resume data storage type">
          <SelectField
            value={prefs.resume_data_storage_type}
            onChange={(v) => update('resume_data_storage_type', v)}
            options={[
              { value: 0, label: 'Legacy (fastresume files)' },
              { value: 1, label: 'SQLite database' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Torrent content remove option">
          <SelectField
            value={prefs.torrent_content_remove_option}
            onChange={(v) => update('torrent_content_remove_option', v)}
            options={[
              { value: 0, label: 'Delete' },
              { value: 1, label: 'Move to Trash' },
            ]}
          />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Network Buffers">
        <SettingRow label="Send buffer watermark (KiB)">
          <NumberInput value={prefs.send_buffer_watermark} onChange={(v) => update('send_buffer_watermark', v)} min={0} />
        </SettingRow>
        <SettingRow label="Send buffer low watermark (KiB)">
          <NumberInput value={prefs.send_buffer_low_watermark} onChange={(v) => update('send_buffer_low_watermark', v)} min={0} />
        </SettingRow>
        <SettingRow label="Send buffer watermark factor (%)">
          <NumberInput value={prefs.send_buffer_watermark_factor} onChange={(v) => update('send_buffer_watermark_factor', v)} min={0} />
        </SettingRow>
        <SettingRow label="Socket send buffer size (bytes, 0=OS default)">
          <NumberInput value={prefs.socket_send_buffer_size} onChange={(v) => update('socket_send_buffer_size', v)} min={0} />
        </SettingRow>
        <SettingRow label="Socket receive buffer size (bytes, 0=OS default)">
          <NumberInput value={prefs.socket_receive_buffer_size} onChange={(v) => update('socket_receive_buffer_size', v)} min={0} />
        </SettingRow>
        <SettingRow label="Socket backlog size">
          <NumberInput value={prefs.socket_backlog_size} onChange={(v) => update('socket_backlog_size', v)} min={1} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Connections">
        <SettingRow label="Outgoing connections per second">
          <NumberInput value={prefs.connection_speed} onChange={(v) => update('connection_speed', v)} min={0} />
        </SettingRow>
        <SettingRow label="uTP/TCP mixed mode">
          <SelectField
            value={prefs.utp_tcp_mixed_mode}
            onChange={(v) => update('utp_tcp_mixed_mode', v)}
            options={[
              { value: 0, label: 'Prefer TCP' },
              { value: 1, label: 'Peer Proportional' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Upload slots behavior">
          <SelectField
            value={prefs.upload_slots_behavior}
            onChange={(v) => update('upload_slots_behavior', v)}
            options={[
              { value: 0, label: 'Fixed Slots' },
              { value: 1, label: 'Upload Rate Based' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Upload choking algorithm">
          <SelectField
            value={prefs.upload_choking_algorithm}
            onChange={(v) => update('upload_choking_algorithm', v)}
            options={[
              { value: 0, label: 'Round Robin' },
              { value: 1, label: 'Fastest Upload' },
              { value: 2, label: 'Anti Leech' },
            ]}
          />
        </SettingRow>
        <SettingRow label="Max outstanding requests to a peer">
          <NumberInput value={prefs.request_queue_size} onChange={(v) => update('request_queue_size', v)} min={1} />
        </SettingRow>
        <SettingRow label="Max concurrent HTTP announces">
          <NumberInput value={prefs.max_concurrent_http_announces} onChange={(v) => update('max_concurrent_http_announces', v)} min={0} />
        </SettingRow>
        <SettingRow label="Stop tracker timeout (seconds)">
          <NumberInput value={prefs.stop_tracker_timeout} onChange={(v) => update('stop_tracker_timeout', v)} min={0} />
        </SettingRow>
        <SettingRow label="Type of service (ToS) for peer connections">
          <NumberInput value={prefs.peer_tos} onChange={(v) => update('peer_tos', v)} min={0} max={255} />
        </SettingRow>
        <SettingRow label="Peer turnover disconnect percentage">
          <NumberInput value={prefs.peer_turnover} onChange={(v) => update('peer_turnover', v)} min={0} />
        </SettingRow>
        <SettingRow label="Peer turnover threshold percentage">
          <NumberInput value={prefs.peer_turnover_cutoff} onChange={(v) => update('peer_turnover_cutoff', v)} min={0} />
        </SettingRow>
        <SettingRow label="Peer turnover interval (seconds)">
          <NumberInput value={prefs.peer_turnover_interval} onChange={(v) => update('peer_turnover_interval', v)} min={0} />
        </SettingRow>
        <SettingRow label="DHT bootstrap nodes">
          <TextInput
            value={prefs.dht_bootstrap_nodes}
            onChange={(v) => update('dht_bootstrap_nodes', v)}
            placeholder="host:port (comma-separated)"
          />
        </SettingRow>
        <SettingRow label="Support internationalized domain names (IDN)">
          <Toggle checked={prefs.idn_support_enabled} onChange={(v) => update('idn_support_enabled', v)} />
        </SettingRow>
        <SettingRow label="Allow multiple connections from the same IP">
          <Toggle checked={prefs.enable_multi_connections_from_same_ip} onChange={(v) => update('enable_multi_connections_from_same_ip', v)} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Security">
        <SettingRow label="Validate HTTPS tracker certificates">
          <Toggle checked={prefs.validate_https_tracker_certificate} onChange={(v) => update('validate_https_tracker_certificate', v)} />
        </SettingRow>
        <SettingRow label="SSRF mitigation">
          <Toggle checked={prefs.ssrf_mitigation} onChange={(v) => update('ssrf_mitigation', v)} />
        </SettingRow>
        <SettingRow label="Block peers on privileged ports (< 1024)">
          <Toggle checked={prefs.block_peers_on_privileged_ports} onChange={(v) => update('block_peers_on_privileged_ports', v)} />
        </SettingRow>
        <SettingRow label="Enable embedded tracker">
          <Toggle checked={prefs.enable_embedded_tracker} onChange={(v) => update('enable_embedded_tracker', v)} />
        </SettingRow>
        {prefs.enable_embedded_tracker && (
          <>
            <SettingRow label="Embedded tracker port">
              <NumberInput value={prefs.embedded_tracker_port} onChange={(v) => update('embedded_tracker_port', v)} min={1} max={65535} />
            </SettingRow>
            <SettingRow label="Enable port forwarding for embedded tracker">
              <Toggle checked={prefs.embedded_tracker_port_forwarding} onChange={(v) => update('embedded_tracker_port_forwarding', v)} />
            </SettingRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="Performance">
        <SettingRow label="Bencoding depth limit">
          <NumberInput value={prefs.bdecode_depth_limit} onChange={(v) => update('bdecode_depth_limit', v)} min={1} />
        </SettingRow>
        <SettingRow label="Bencoding token limit">
          <NumberInput value={prefs.bdecode_token_limit} onChange={(v) => update('bdecode_token_limit', v)} min={1} />
        </SettingRow>
        <SettingRow label="Recheck completed torrents on startup">
          <Toggle checked={prefs.recheck_completed_torrents} onChange={(v) => update('recheck_completed_torrents', v)} />
        </SettingRow>
        <SettingRow label="Resolve peer countries (flag display)">
          <Toggle checked={prefs.resolve_peer_countries} onChange={(v) => update('resolve_peer_countries', v)} />
        </SettingRow>
        <SettingRow label="Reannounce to all trackers when IP/port changes">
          <Toggle checked={prefs.reannounce_when_address_changed} onChange={(v) => update('reannounce_when_address_changed', v)} />
        </SettingRow>
        <SettingRow label="Physical memory usage limit (MiB, 0=disabled)">
          <NumberInput value={prefs.memory_working_set_limit} onChange={(v) => update('memory_working_set_limit', v)} min={0} />
        </SettingRow>
        <SettingRow label="Log performance warnings">
          <Toggle checked={prefs.performance_warning} onChange={(v) => update('performance_warning', v)} />
        </SettingRow>
      </SectionCard>
    </div>
  )
}

export function RSSTab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  return (
    <div className="space-y-6">
      <SectionCard title="RSS Feed Settings">
        <SettingRow label="Enable RSS feed processing">
          <Toggle checked={prefs.rss_processing_enabled} onChange={(v) => update('rss_processing_enabled', v)} />
        </SettingRow>
        {prefs.rss_processing_enabled && (
          <>
            <SettingRow label="Refresh interval (minutes)">
              <NumberInput value={prefs.rss_refresh_interval} onChange={(v) => update('rss_refresh_interval', v)} min={5} />
            </SettingRow>
            <SettingRow label="Max articles per feed">
              <NumberInput value={prefs.rss_max_articles_per_feed} onChange={(v) => update('rss_max_articles_per_feed', v)} min={1} />
            </SettingRow>
            <SettingRow label="Same-host fetch delay (seconds)">
              <NumberInput value={prefs.rss_fetch_delay} onChange={(v) => update('rss_fetch_delay', v)} min={0} />
            </SettingRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="Auto-downloading">
        <SettingRow label="Enable auto-downloading from RSS">
          <Toggle checked={prefs.rss_auto_downloading_enabled} onChange={(v) => update('rss_auto_downloading_enabled', v)} />
        </SettingRow>
        {prefs.rss_auto_downloading_enabled && (
          <>
            <SettingRow label="Prefer repack/proper episodes">
              <Toggle checked={prefs.rss_download_repack_proper_episodes} onChange={(v) => update('rss_download_repack_proper_episodes', v)} />
            </SettingRow>
            <div className="py-2">
              <label className="block text-sm font-medium mb-1">
                Smart episode filters (one per line)
              </label>
              <p className="text-xs text-muted-foreground mb-2">e.g. |720p to only download 720p releases</p>
              <textarea
                value={prefs.rss_smart_episode_filters}
                onChange={(e) => update('rss_smart_episode_filters', e.target.value)}
                rows={4}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              />
            </div>
          </>
        )}
      </SectionCard>
    </div>
  )
}

export function WebUITab({
  prefs,
  update,
}: {
  prefs: QbtPreferences
  update: <K extends keyof QbtPreferences>(k: K, v: QbtPreferences[K]) => void
}) {
  return (
    <div className="space-y-6">
      <SectionCard title="Listening">
        <SettingRow label="IP address">
          <TextInput value={prefs.web_ui_address} onChange={(v) => update('web_ui_address', v)} placeholder="* (all interfaces)" />
        </SettingRow>
        <SettingRow label="Port">
          <NumberInput value={prefs.web_ui_port} onChange={(v) => update('web_ui_port', v)} min={1} max={65535} />
        </SettingRow>
        <SettingRow label="Use UPnP to forward port">
          <Toggle checked={prefs.web_ui_upnp} onChange={(v) => update('web_ui_upnp', v)} />
        </SettingRow>
        <SettingRow label="Use HTTPS">
          <Toggle checked={prefs.use_https} onChange={(v) => update('use_https', v)} />
        </SettingRow>
        {prefs.use_https && (
          <>
            <SettingRow label="SSL certificate path">
              <TextInput value={prefs.web_ui_https_cert_path} onChange={(v) => update('web_ui_https_cert_path', v)} />
            </SettingRow>
            <SettingRow label="SSL key path">
              <TextInput value={prefs.web_ui_https_key_path} onChange={(v) => update('web_ui_https_key_path', v)} />
            </SettingRow>
          </>
        )}
      </SectionCard>

      <SectionCard title="Authentication">
        <SettingRow label="Username">
          <TextInput value={prefs.web_ui_username} onChange={(v) => update('web_ui_username', v)} />
        </SettingRow>
        <SettingRow label="Bypass authentication for localhost (127.0.0.1)">
          <Toggle checked={prefs.bypass_local_auth} onChange={(v) => update('bypass_local_auth', v)} />
        </SettingRow>
        <SettingRow label="Bypass authentication for whitelisted subnets">
          <Toggle checked={prefs.bypass_auth_subnet_whitelist_enabled} onChange={(v) => update('bypass_auth_subnet_whitelist_enabled', v)} />
        </SettingRow>
        {prefs.bypass_auth_subnet_whitelist_enabled && (
          <SettingRow label="Whitelisted subnets (comma-separated)">
            <TextInput
              value={prefs.bypass_auth_subnet_whitelist}
              onChange={(v) => update('bypass_auth_subnet_whitelist', v)}
              placeholder="192.168.1.0/24, ..."
            />
          </SettingRow>
        )}
        <SettingRow label="Max authentication failures before ban">
          <NumberInput value={prefs.web_ui_max_auth_fail_count} onChange={(v) => update('web_ui_max_auth_fail_count', v)} min={0} />
        </SettingRow>
        <SettingRow label="IP ban duration (seconds)">
          <NumberInput value={prefs.web_ui_ban_duration} onChange={(v) => update('web_ui_ban_duration', v)} min={0} />
        </SettingRow>
        <SettingRow label="Session timeout (seconds)">
          <NumberInput value={prefs.web_ui_session_timeout} onChange={(v) => update('web_ui_session_timeout', v)} min={0} />
        </SettingRow>
      </SectionCard>

      <SectionCard title="Security">
        <SettingRow label="Enable clickjacking protection">
          <Toggle checked={prefs.web_ui_clickjacking_protection_enabled} onChange={(v) => update('web_ui_clickjacking_protection_enabled', v)} />
        </SettingRow>
        <SettingRow label="Enable CSRF protection">
          <Toggle checked={prefs.web_ui_csrf_protection_enabled} onChange={(v) => update('web_ui_csrf_protection_enabled', v)} />
        </SettingRow>
        <SettingRow label="Mark cookie Secure (HTTPS only)">
          <Toggle checked={prefs.web_ui_secure_cookie_enabled} onChange={(v) => update('web_ui_secure_cookie_enabled', v)} />
        </SettingRow>
        <SettingRow label="Enable host header validation">
          <Toggle checked={prefs.web_ui_host_header_validation_enabled} onChange={(v) => update('web_ui_host_header_validation_enabled', v)} />
        </SettingRow>
        {prefs.web_ui_host_header_validation_enabled && (
          <SettingRow label="Allowed domains (comma-separated)">
            <TextInput value={prefs.web_ui_domain_list} onChange={(v) => update('web_ui_domain_list', v)} />
          </SettingRow>
        )}
        <SettingRow label="Enable reverse proxy support">
          <Toggle checked={prefs.web_ui_reverse_proxy_enabled} onChange={(v) => update('web_ui_reverse_proxy_enabled', v)} />
        </SettingRow>
        {prefs.web_ui_reverse_proxy_enabled && (
          <SettingRow label="Trusted reverse proxies (comma-separated)">
            <TextInput value={prefs.web_ui_reverse_proxies_list} onChange={(v) => update('web_ui_reverse_proxies_list', v)} />
          </SettingRow>
        )}
        <SettingRow label="Add custom HTTP headers">
          <Toggle checked={prefs.web_ui_use_custom_http_headers_enabled} onChange={(v) => update('web_ui_use_custom_http_headers_enabled', v)} />
        </SettingRow>
        {prefs.web_ui_use_custom_http_headers_enabled && (
          <div className="py-2">
            <label className="block text-sm font-medium mb-2">Custom HTTP headers (one per line)</label>
            <textarea
              value={prefs.web_ui_custom_http_headers}
              onChange={(e) => update('web_ui_custom_http_headers', e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary resize-y"
            />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Alternative UI">
        <SettingRow label="Use alternative WebUI">
          <Toggle checked={prefs.alternative_webui_enabled} onChange={(v) => update('alternative_webui_enabled', v)} />
        </SettingRow>
        {prefs.alternative_webui_enabled && (
          <SettingRow label="Alternative WebUI path">
            <TextInput value={prefs.alternative_webui_path} onChange={(v) => update('alternative_webui_path', v)} />
          </SettingRow>
        )}
      </SectionCard>

      <SectionCard title="Dynamic DNS">
        <SettingRow label="Enable Dynamic DNS">
          <Toggle checked={prefs.dyndns_enabled} onChange={(v) => update('dyndns_enabled', v)} />
        </SettingRow>
        {prefs.dyndns_enabled && (
          <>
            <SettingRow label="Service">
              <SelectField
                value={prefs.dyndns_service}
                onChange={(v) => update('dyndns_service', v)}
                options={[
                  { value: 0, label: 'DynDNS' },
                  { value: 1, label: 'No-IP' },
                ]}
              />
            </SettingRow>
            <SettingRow label="Domain name">
              <TextInput value={prefs.dyndns_domain} onChange={(v) => update('dyndns_domain', v)} />
            </SettingRow>
            <SettingRow label="Username">
              <TextInput value={prefs.dyndns_username} onChange={(v) => update('dyndns_username', v)} />
            </SettingRow>
            <SettingRow label="Password">
              <TextInput type="password" value={prefs.dyndns_password} onChange={(v) => update('dyndns_password', v)} />
            </SettingRow>
          </>
        )}
      </SectionCard>
    </div>
  )
}
