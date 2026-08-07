import 'server-only'
import { getDb } from '@/lib/db/index'
import { PUBLIC_INDEXER_CATALOG, PENDING_INDEXER_CATALOG } from './catalog'

export async function initIndexerDiscovery(): Promise<void> {
  const db = getDb()
  const wasEmpty = (db.prepare('SELECT COUNT(*) as n FROM indexers').get() as { n: number }).n === 0

  const insert = db.prepare(`
    INSERT OR IGNORE INTO indexers
      (name, torznab_url, api_key, enabled, description, base_url, requires_auth, requires_flaresolverr, search_type, pending_credentials)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Runs every boot, not just on an empty table: indexers.name has a unique index, so INSERT OR
  // IGNORE only adds catalog entries genuinely missing by name — it never touches enabled/
  // rate_limit_*/health_status on a row that already exists, including one a user disabled by
  // hand. This lets new adapters land in catalog.ts and reach production on the next restart
  // without a one-off manual DB script.
  let seeded = 0
  for (const def of PUBLIC_INDEXER_CATALOG) {
    const result = insert.run(
      def.name, def.torznab_url, def.api_key, 1,
      def.description, def.base_url,
      def.requires_auth ? 1 : 0, def.requires_flaresolverr ? 1 : 0,
      def.search_type,
      def.pending_credentials ? JSON.stringify(def.pending_credentials) : null
    )
    if (result.changes > 0) seeded++
  }

  // Seed pending (auth-required) indexers as enabled=0
  for (const def of PENDING_INDEXER_CATALOG) {
    const result = insert.run(
      def.name, def.torznab_url, def.api_key, 0,
      def.description, def.base_url,
      def.requires_auth ? 1 : 0, def.requires_flaresolverr ? 1 : 0,
      def.search_type,
      def.pending_credentials ? JSON.stringify(def.pending_credentials) : null
    )
    if (result.changes > 0) seeded++
  }

  if (seeded > 0) console.log(`[indexer] Synced ${seeded} new catalog indexer(s)`)
  if (wasEmpty) console.log('[indexer] First-run: indexer catalog seeded')
}
