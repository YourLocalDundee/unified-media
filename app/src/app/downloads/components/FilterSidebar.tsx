'use client'

import type { Torrent } from '@/lib/qbittorrent/types'

export const STATUS_FILTERS = {
  all: null,
  downloading: ['downloading', 'forcedDL', 'metaDL', 'stalledDL'],
  seeding: ['uploading', 'forcedUP', 'stalledUP'],
  paused: ['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP'],
  errored: ['error', 'missingFiles'],
  checking: ['checkingDL', 'checkingUP', 'checkingResumeData', 'allocating'],
  queued: ['queuedDL', 'queuedUP'],
  stalled: ['stalledDL', 'stalledUP'],
} as const

export type StatusFilterKey = keyof typeof STATUS_FILTERS

const STATUS_LABELS: Record<StatusFilterKey, string> = {
  all: 'All',
  downloading: 'Downloading',
  seeding: 'Seeding',
  paused: 'Paused',
  errored: 'Errored',
  checking: 'Checking',
  queued: 'Queued',
  stalled: 'Stalled',
}

interface FilterSidebarProps {
  torrents: Torrent[]
  statusFilter: StatusFilterKey
  categoryFilter: string | null
  tagFilter: string | null
  categories: Record<string, { name: string; savePath: string }>
  tags: string[]
  collapsed: boolean
  onStatusChange: (s: StatusFilterKey) => void
  onCategoryChange: (c: string | null) => void
  onTagChange: (t: string | null) => void
  onToggleCollapse: () => void
}

function countForStatus(torrents: Torrent[], key: StatusFilterKey): number {
  const states = STATUS_FILTERS[key]
  if (!states) return torrents.length
  return torrents.filter((t) => (states as readonly string[]).includes(t.state)).length
}

export default function FilterSidebar({
  torrents,
  statusFilter,
  categoryFilter,
  tagFilter,
  categories,
  tags,
  collapsed,
  onStatusChange,
  onCategoryChange,
  onTagChange,
  onToggleCollapse,
}: FilterSidebarProps) {
  return (
    <aside
      className={`flex flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 transition-all duration-200 ${
        collapsed ? 'w-10 min-w-[2.5rem]' : 'w-52 min-w-[13rem]'
      }`}
    >
      {/* Collapse toggle */}
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-2 py-2">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 select-none">
            Filters
          </span>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="ml-auto rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            {collapsed ? (
              <path
                fillRule="evenodd"
                d="M3 5a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1ZM3 10a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1ZM3 15a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Z"
                clipRule="evenodd"
              />
            ) : (
              <path
                fillRule="evenodd"
                d="M15.707 15.707a1 1 0 0 1-1.414 0l-5-5a1 1 0 0 1 0-1.414l5-5a1 1 0 1 1 1.414 1.414L11.414 10l4.293 4.293a1 1 0 0 1 0 1.414ZM4 4a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1Z"
                clipRule="evenodd"
              />
            )}
          </svg>
        </button>
      </div>

      {collapsed ? null : (
        <div className="flex flex-col gap-4 overflow-y-auto p-2">
          {/* Status filters */}
          <div>
            <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              Status
            </p>
            <ul className="space-y-0.5">
              {(Object.keys(STATUS_FILTERS) as StatusFilterKey[]).map((key) => {
                const count = countForStatus(torrents, key)
                const active = statusFilter === key
                return (
                  <li key={key}>
                    <button
                      onClick={() => onStatusChange(key)}
                      className={`flex w-full items-center justify-between rounded px-2 py-1 text-sm transition-colors ${
                        active
                          ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-400'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span>{STATUS_LABELS[key]}</span>
                      <span
                        className={`text-xs tabular-nums ${
                          active ? 'text-blue-500' : 'text-gray-400'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Categories */}
          {Object.keys(categories).length > 0 && (
            <div>
              <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Category
              </p>
              <ul className="space-y-0.5">
                <li>
                  <button
                    onClick={() => onCategoryChange(null)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-sm transition-colors ${
                      categoryFilter === null
                        ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-400'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span>All</span>
                  </button>
                </li>
                {Object.entries(categories).map(([catKey, cat]) => {
                  const count = torrents.filter((t) => t.category === cat.name).length
                  const active = categoryFilter === cat.name
                  return (
                    <li key={catKey}>
                      <button
                        onClick={() => onCategoryChange(cat.name)}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 text-sm transition-colors ${
                          active
                            ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-400'
                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="truncate">{cat.name}</span>
                        <span className="ml-1 shrink-0 text-xs tabular-nums text-gray-400">
                          {count}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <p className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Tags
              </p>
              <ul className="space-y-0.5">
                <li>
                  <button
                    onClick={() => onTagChange(null)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1 text-sm transition-colors ${
                      tagFilter === null
                        ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-400'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span>All</span>
                  </button>
                </li>
                {tags.map((tag) => {
                  const count = torrents.filter((t) =>
                    t.tags
                      .split(',')
                      .map((s) => s.trim())
                      .includes(tag)
                  ).length
                  const active = tagFilter === tag
                  return (
                    <li key={tag}>
                      <button
                        onClick={() => onTagChange(tag)}
                        className={`flex w-full items-center justify-between rounded px-2 py-1 text-sm transition-colors ${
                          active
                            ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/30 dark:text-blue-400'
                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}
                      >
                        <span className="truncate">{tag}</span>
                        <span className="ml-1 shrink-0 text-xs tabular-nums text-gray-400">
                          {count}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
