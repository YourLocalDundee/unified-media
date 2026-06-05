import 'server-only'
import type Database from 'better-sqlite3'
import { getDb } from '@/lib/db/index'
import { PUBLIC_INDEXER_CATALOG, PENDING_INDEXER_CATALOG } from './catalog'

export async function initIndexerDiscovery(): Promise<void> {
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) as n FROM indexers').get() as { n: number }).n
  if (count > 0) return  // already seeded — don't overwrite user configuration

  console.log('[indexer] First-run: seeding indexer catalog...')

  const insert = db.prepare(`
    INSERT OR IGNORE INTO indexers
      (name, torznab_url, api_key, enabled, description, base_url, requires_auth, requires_flaresolverr, search_type, pending_credentials)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Seed public (no auth) indexers as enabled=1
  for (const def of PUBLIC_INDEXER_CATALOG) {
    insert.run(
      def.name, def.torznab_url, def.api_key, 1,
      def.description, def.base_url,
      def.requires_auth ? 1 : 0, def.requires_flaresolverr ? 1 : 0,
      def.search_type,
      def.pending_credentials ? JSON.stringify(def.pending_credentials) : null
    )
  }

  // Seed pending (auth-required) indexers as enabled=0
  for (const def of PENDING_INDEXER_CATALOG) {
    insert.run(
      def.name, def.torznab_url, def.api_key, 0,
      def.description, def.base_url,
      def.requires_auth ? 1 : 0, def.requires_flaresolverr ? 1 : 0,
      def.search_type,
      def.pending_credentials ? JSON.stringify(def.pending_credentials) : null
    )
  }

  console.log(`[indexer] Seeded ${PUBLIC_INDEXER_CATALOG.length} public + ${PENDING_INDEXER_CATALOG.length} pending indexers`)

  // Attempt Prowlarr bridge discovery (best-effort)
  await discoverProwlarr(db, insert)
}

async function discoverProwlarr(
  db: Database.Database,
  insert: Database.Statement
): Promise<void> {
  const prowlarrUrl = process.env.PROWLARR_URL
  const prowlarrKey = process.env.PROWLARR_API_KEY

  if (!prowlarrUrl || !prowlarrKey) {
    console.log('[indexer] Prowlarr env vars not set — skipping Prowlarr discovery')
    return
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5_000)
    let res: Response
    try {
      res = await fetch(`${prowlarrUrl}/api/v1/indexer?apikey=${prowlarrKey}`, {
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) {
      console.warn(`[indexer] Prowlarr returned HTTP ${res.status} — skipping bridge discovery`)
      return
    }

    const indexers = await res.json() as Array<{
      id: number
      name: string
      enable: boolean
      protocol: string
    }>

    let discovered = 0
    for (const idx of indexers) {
      if (!idx.enable) continue
      insert.run(
        `Prowlarr: ${idx.name}`,
        `${prowlarrUrl}/${idx.id}/api?apikey=${prowlarrKey}`,
        prowlarrKey,
        1,
        `Discovered from Prowlarr (${idx.protocol})`,
        prowlarrUrl,
        0, 0,
        'torznab',
        null
      )
      discovered++
    }

    console.log(`[indexer] Discovered ${discovered} indexers from Prowlarr`)
  } catch (err) {
    console.warn('[indexer] Prowlarr discovery failed (non-fatal):', err)
  }
}
