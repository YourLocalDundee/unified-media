// Newznab/Torznab standard category tree (prowlarr-analysis.md #5) — a fixed, indexer-agnostic
// set of IDs every Torznab endpoint in this app (Jackett/Prowlarr-backed, see discovery.ts) already
// understands and normalizes its own tracker categories into. Kept to the subset that matters at
// home-server scale rather than porting all ~40 of Prowlarr's NewznabStandardCategory entries.
export interface StandardCategory {
  id: string
  name: string
  parent?: string
}

export const NEWZNAB_STANDARD_CATEGORIES: StandardCategory[] = [
  { id: '2000', name: 'Movies' },
  { id: '2040', name: 'Movies/HD', parent: '2000' },
  { id: '2045', name: 'Movies/UHD', parent: '2000' },
  { id: '5000', name: 'TV' },
  { id: '5040', name: 'TV/HD', parent: '5000' },
  { id: '5045', name: 'TV/UHD', parent: '5000' },
  { id: '5070', name: 'TV/Anime', parent: '5000' },
  { id: '5080', name: 'TV/Documentary', parent: '5000' },
  { id: '3000', name: 'Audio' },
  { id: '7000', name: 'Books' },
]

export function childCategoryIds(parentId: string): string[] {
  return NEWZNAB_STANDARD_CATEGORIES.filter(c => c.parent === parentId).map(c => c.id)
}

/**
 * Widen (never narrow) a requested category list for a specific indexer, using its last caps
 * probe. Additive-only by design: the automation grabber's wanted-item searches share this code
 * path, and caps parsing is best-effort, so a false-negative caps read must never suppress a
 * query that would otherwise have run. If the indexer's own caps don't include a requested
 * top-level ID (e.g. bare `5000`) but do include one of its known standard subcats (e.g. `5040`),
 * that subcat is appended so the search still reaches it — the original requested ID is always
 * kept as-is. Caller passes `caps_categories` straight from the `indexers` row (may be null).
 */
export function resolveCategoriesForIndexer(capsCategoriesJson: string | null, requestedCats: string): string {
  if (!capsCategoriesJson) return requestedCats

  let caps: Array<{ id: string; subcats?: { id: string }[] }>
  try {
    caps = JSON.parse(capsCategoriesJson)
  } catch {
    return requestedCats
  }

  const capsIds = new Set<string>()
  for (const c of caps) {
    capsIds.add(c.id)
    for (const s of c.subcats ?? []) capsIds.add(s.id)
  }

  const requested = requestedCats.split(',').map(s => s.trim()).filter(Boolean)
  const extra: string[] = []
  for (const reqId of requested) {
    if (capsIds.has(reqId)) continue
    for (const childId of childCategoryIds(reqId)) {
      if (capsIds.has(childId) && !requested.includes(childId) && !extra.includes(childId)) {
        extra.push(childId)
      }
    }
  }

  return extra.length > 0 ? [...requested, ...extra].join(',') : requestedCats
}
