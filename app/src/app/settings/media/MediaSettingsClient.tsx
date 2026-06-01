'use client'

import { useState } from 'react'
import type { ProwlarrIndexer } from '@/lib/prowlarr/types'
import type { SonarrQualityProfile, SonarrRootFolder } from '@/lib/sonarr/types'
import type { RadarrQualityProfile, RadarrRootFolder } from '@/lib/radarr/types'
import type { BazarrProvider, BazarrSystemStatus } from '@/lib/bazarr/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBytes(b: number) {
  if (b > 1e12) return (b / 1e12).toFixed(1) + ' TB'
  if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'
  return (b / 1e6).toFixed(0) + ' MB'
}

function Unavailable({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <p className="text-sm text-muted-foreground">{label} is unavailable</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tab bar
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'indexers', label: 'Indexers' },
  { id: 'tv', label: 'TV' },
  { id: 'movies', label: 'Movies' },
  { id: 'subtitles', label: 'Subtitles' },
] as const

type TabId = (typeof TABS)[number]['id']

function TabBar({
  activeTab,
  setActiveTab,
  indexerCount,
}: {
  activeTab: TabId
  setActiveTab: (id: TabId) => void
  indexerCount: number | null
}) {
  return (
    <div className="flex gap-1 border-b border-border mb-6 overflow-x-auto">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
            activeTab === tab.id
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.label}
          {tab.id === 'indexers' && indexerCount !== null && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground leading-none">
              {indexerCount}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Indexers tab
// ---------------------------------------------------------------------------

function IndexersTab({ indexers }: { indexers: ProwlarrIndexer[] | null }) {
  const [toggling, setToggling] = useState<Set<number>>(new Set())
  const [localEnabled, setLocalEnabled] = useState<Record<number, boolean>>({})
  const [testingId, setTestingId] = useState<number | null>(null)
  const [testResults, setTestResults] = useState<Record<number, 'ok' | 'fail'>>({})

  if (indexers === null) return <Unavailable label="Prowlarr" />

  function isEnabled(indexer: ProwlarrIndexer) {
    return indexer.id in localEnabled ? localEnabled[indexer.id] : indexer.enable
  }

  async function handleToggle(indexer: ProwlarrIndexer) {
    const nextEnabled = !isEnabled(indexer)
    setToggling((prev) => new Set(prev).add(indexer.id))
    try {
      const res = await fetch(`/api/prowlarr/indexer/${indexer.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enable: nextEnabled }),
      })
      if (res.ok) {
        setLocalEnabled((prev) => ({ ...prev, [indexer.id]: nextEnabled }))
      }
    } catch {
      // silently ignore — toggle reverts
    } finally {
      setToggling((prev) => {
        const next = new Set(prev)
        next.delete(indexer.id)
        return next
      })
    }
  }

  async function handleTest(indexer: ProwlarrIndexer) {
    setTestingId(indexer.id)
    try {
      const res = await fetch(`/api/prowlarr/indexer/${indexer.id}/test`, { method: 'POST' })
      setTestResults((prev) => ({ ...prev, [indexer.id]: res.ok ? 'ok' : 'fail' }))
    } catch {
      setTestResults((prev) => ({ ...prev, [indexer.id]: 'fail' }))
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Name</th>
              <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Protocol</th>
              <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Privacy</th>
              <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Categories</th>
              <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Status</th>
              <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {indexers.map((indexer) => {
              const enabled = isEnabled(indexer)
              const result = testResults[indexer.id]
              return (
                <tr key={indexer.id} className="border-b border-border last:border-0 hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{indexer.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      indexer.protocol === 'torrent'
                        ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                        : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                    }`}>
                      {indexer.protocol}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      indexer.privacy === 'public'
                        ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                        : indexer.privacy === 'private'
                          ? 'bg-red-500/15 text-red-600 dark:text-red-400'
                          : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}>
                      {indexer.privacy}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {indexer.capabilities.categories.length}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      role="switch"
                      aria-checked={enabled}
                      disabled={toggling.has(indexer.id)}
                      onClick={() => handleToggle(indexer)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                        enabled ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                      }`} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      disabled={testingId === indexer.id}
                      onClick={() => handleTest(indexer)}
                      className={`rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                        result === 'ok'
                          ? 'border-green-500 text-green-600 dark:text-green-400'
                          : result === 'fail'
                            ? 'border-red-500 text-red-600 dark:text-red-400'
                            : 'border-border hover:bg-accent'
                      }`}
                    >
                      {testingId === indexer.id ? 'Testing…' : result === 'ok' ? 'OK' : result === 'fail' ? 'Failed' : 'Test'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{indexers.length} indexers configured</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Quality profile card shared by TV and Movies tabs
// ---------------------------------------------------------------------------

function QualityProfileCard({ profile }: { profile: SonarrQualityProfile | RadarrQualityProfile }) {
  // Count leaf quality items that are allowed
  function countAllowed(items: SonarrQualityProfile['items'] | RadarrQualityProfile['items']): number {
    let n = 0
    for (const item of items) {
      if (item.items && item.items.length > 0) {
        n += countAllowed(item.items)
      } else if (item.allowed) {
        n++
      }
    }
    return n
  }

  // Find the cutoff quality name
  function findCutoffName(items: SonarrQualityProfile['items'] | RadarrQualityProfile['items'], cutoffId: number): string {
    for (const item of items) {
      if (item.quality && item.quality.id === cutoffId) return item.quality.name
      if (item.items && item.items.length > 0) {
        const found = findCutoffName(item.items, cutoffId)
        if (found) return found
      }
    }
    return String(cutoffId)
  }

  const allowedCount = countAllowed(profile.items)
  const cutoffName = findCutoffName(profile.items, profile.cutoff)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-medium text-sm">{profile.name}</span>
        {profile.upgradeAllowed && (
          <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-primary/15 text-primary">
            Upgrades on
          </span>
        )}
      </div>
      <div className="text-xs text-muted-foreground space-y-0.5">
        <div>Cutoff: <span className="text-foreground">{cutoffName}</span></div>
        <div>Allowed qualities: <span className="text-foreground">{allowedCount}</span></div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Root folders table shared by TV and Movies tabs
// ---------------------------------------------------------------------------

function RootFoldersTable({ folders }: { folders: SonarrRootFolder[] | RadarrRootFolder[] }) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Path</th>
            <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Free Space</th>
            <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Accessible</th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => (
            <tr key={folder.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3 font-mono text-xs">{folder.path}</td>
              <td className="px-4 py-3 text-muted-foreground">{fmtBytes(folder.freeSpace)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${folder.accessible ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className={`text-xs ${folder.accessible ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {folder.accessible ? 'OK' : 'Inaccessible'}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TV tab
// ---------------------------------------------------------------------------

function TVTab({
  profiles,
  folders,
  queueTotal,
}: {
  profiles: SonarrQualityProfile[] | null
  folders: SonarrRootFolder[] | null
  queueTotal: number | null
}) {
  if (profiles === null && folders === null) return <Unavailable label="Sonarr" />

  return (
    <div className="space-y-6">
      {queueTotal !== null && (
        <p className="text-xs text-muted-foreground">
          {profiles?.length ?? 0} quality profile{profiles?.length !== 1 ? 's' : ''} &middot; {folders?.length ?? 0} root folder{folders?.length !== 1 ? 's' : ''} &middot; {queueTotal} queued
        </p>
      )}

      {profiles !== null && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Quality Profiles</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((p) => <QualityProfileCard key={p.id} profile={p} />)}
          </div>
        </section>
      )}

      {folders !== null && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Root Folders</h2>
          <RootFoldersTable folders={folders} />
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Movies tab
// ---------------------------------------------------------------------------

function MoviesTab({
  profiles,
  folders,
  queueTotal,
}: {
  profiles: RadarrQualityProfile[] | null
  folders: RadarrRootFolder[] | null
  queueTotal: number | null
}) {
  if (profiles === null && folders === null) return <Unavailable label="Radarr" />

  return (
    <div className="space-y-6">
      {queueTotal !== null && (
        <p className="text-xs text-muted-foreground">
          {profiles?.length ?? 0} quality profile{profiles?.length !== 1 ? 's' : ''} &middot; {folders?.length ?? 0} root folder{folders?.length !== 1 ? 's' : ''} &middot; {queueTotal} queued
        </p>
      )}

      {profiles !== null && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Quality Profiles</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {profiles.map((p) => <QualityProfileCard key={p.id} profile={p} />)}
          </div>
        </section>
      )}

      {folders !== null && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Root Folders</h2>
          <RootFoldersTable folders={folders} />
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subtitles tab
// ---------------------------------------------------------------------------

function SubtitlesTab({
  providers,
  status,
}: {
  providers: BazarrProvider[] | null
  status: BazarrSystemStatus | null
}) {
  if (providers === null && status === null) return <Unavailable label="Bazarr" />

  return (
    <div className="space-y-6">
      {status !== null && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>Bazarr <span className="text-foreground font-medium">{status.bazarr_version}</span></span>
            <span>Python <span className="text-foreground font-medium">{status.python_version}</span></span>
            <span>DB <span className="text-foreground font-medium">{status.database_engine}</span></span>
            <span>OS <span className="text-foreground font-medium">{status.operating_system}</span></span>
          </div>
        </div>
      )}

      {providers !== null && (
        <section>
          <h2 className="text-sm font-semibold mb-3">Providers</h2>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Name</th>
                  <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Status</th>
                  <th className="text-left text-xs uppercase text-muted-foreground px-4 py-3 font-medium">Retry</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((provider) => {
                  const good = provider.status.toLowerCase() === 'good' || provider.status === ''
                  return (
                    <tr key={provider.name} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 font-medium">{provider.name}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${good ? 'bg-green-500' : 'bg-red-500'}`} />
                          <span className={`text-xs ${good ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {provider.status || 'Good'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{provider.retry || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

interface MediaSettingsClientProps {
  indexers: ProwlarrIndexer[] | null
  sonarrProfiles: SonarrQualityProfile[] | null
  sonarrFolders: SonarrRootFolder[] | null
  sonarrQueueTotal: number | null
  radarrProfiles: RadarrQualityProfile[] | null
  radarrFolders: RadarrRootFolder[] | null
  radarrQueueTotal: number | null
  providers: BazarrProvider[] | null
  bazarrStatus: BazarrSystemStatus | null
}

export default function MediaSettingsClient({
  indexers,
  sonarrProfiles,
  sonarrFolders,
  sonarrQueueTotal,
  radarrProfiles,
  radarrFolders,
  radarrQueueTotal,
  providers,
  bazarrStatus,
}: MediaSettingsClientProps) {
  const [activeTab, setActiveTab] = useState<TabId>('indexers')

  return (
    <div className="space-y-4">
      <TabBar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        indexerCount={indexers?.length ?? null}
      />

      {activeTab === 'indexers' && <IndexersTab indexers={indexers} />}
      {activeTab === 'tv' && (
        <TVTab profiles={sonarrProfiles} folders={sonarrFolders} queueTotal={sonarrQueueTotal} />
      )}
      {activeTab === 'movies' && (
        <MoviesTab profiles={radarrProfiles} folders={radarrFolders} queueTotal={radarrQueueTotal} />
      )}
      {activeTab === 'subtitles' && <SubtitlesTab providers={providers} status={bazarrStatus} />}
    </div>
  )
}
