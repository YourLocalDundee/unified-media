// One-off backfill for fields the enricher had always written as null.
//
// Until 2026-08-14 the enricher identified titles with /search/movie and /search/tv and then
// wrote imdb_id, runtime, genres and external_ids — none of which those endpoints return. The
// code path is fixed now, but enrichAll only selects rows WHERE tmdb_id IS NULL OR poster_path
// IS NULL ("never enriched"), so already-enriched rows will never be revisited. That selector is
// deliberately narrow — widening it to include these fields would make anything TMDB genuinely
// has no value for re-search on every single pass, forever. Hence a one-off instead.
//
// Idempotent: only fills columns that are currently NULL (or an empty genres array), so it is
// safe to re-run and will never overwrite something already populated.
//
// Run INSIDE the unified-frontend container, from /app:
//   docker cp this unified-frontend:/app/ && docker exec -w /app unified-frontend node <file>
// Both module systems resolve node_modules from the SCRIPT's directory, so it cannot live in /tmp.
const Database = require('better-sqlite3')

const token = process.env.TMDB_ACCESS_TOKEN
if (!token) {
  console.error('TMDB_ACCESS_TOKEN not set in this container')
  process.exit(1)
}

const DRY = process.argv.includes('--dry-run')
const db = new Database('/data/unified.db')

const tmdb = async (path) => {
  const res = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`TMDB ${res.status}`)
  return res.json()
}

const isEmptyGenres = (g) => g == null || g === '' || g === '[]'

async function main() {
  // Movies: imdb_id, runtime_ticks, genres all come only from /movie/{id}.
  const movies = db
    .prepare(
      `SELECT id, title, tmdb_id, imdb_id, runtime_ticks, genres FROM media_items
       WHERE type = 'movie' AND tmdb_id IS NOT NULL
         AND (imdb_id IS NULL OR runtime_ticks IS NULL OR genres IS NULL OR genres = '[]')
       ORDER BY title`
    )
    .all()

  // Series: genres only. tvdb_id was already backfilled separately, but fill any stragglers too.
  const series = db
    .prepare(
      `SELECT id, title, tmdb_id, tvdb_id, genres FROM media_items
       WHERE type = 'series' AND tmdb_id IS NOT NULL
         AND (genres IS NULL OR genres = '[]' OR tvdb_id IS NULL)
       ORDER BY title`
    )
    .all()

  console.log(`movies needing detail: ${movies.length}   series needing detail: ${series.length}`)
  if (DRY) console.log('(dry run — nothing will be written)\n')

  const updMovie = db.prepare(
    `UPDATE media_items SET
       imdb_id       = COALESCE(imdb_id, @imdb_id),
       runtime_ticks = COALESCE(runtime_ticks, @runtime_ticks),
       genres        = CASE WHEN genres IS NULL OR genres = '[]' THEN @genres ELSE genres END,
       updated_at    = @updated_at
     WHERE id = @id`
  )
  const updSeries = db.prepare(
    `UPDATE media_items SET
       tvdb_id    = COALESCE(tvdb_id, @tvdb_id),
       genres     = CASE WHEN genres IS NULL OR genres = '[]' THEN @genres ELSE genres END,
       updated_at = @updated_at
     WHERE id = @id`
  )

  let ok = 0
  let failed = 0

  for (const m of movies) {
    try {
      const d = await tmdb(`/movie/${m.tmdb_id}?language=en-US`)
      const genres = JSON.stringify((d.genres ?? []).map((g) => g.name))
      const gained = [
        !m.imdb_id && d.imdb_id ? 'imdb' : null,
        m.runtime_ticks == null && d.runtime ? 'runtime' : null,
        isEmptyGenres(m.genres) && genres !== '[]' ? 'genres' : null,
      ].filter(Boolean)
      if (!DRY) {
        updMovie.run({
          id: m.id,
          imdb_id: d.imdb_id ?? null,
          runtime_ticks: d.runtime ? d.runtime * 600_000_000 : null,
          genres,
          updated_at: Date.now(),
        })
      }
      console.log(`  movie  ${m.title.padEnd(40)} +${gained.join(',') || 'nothing new'}`)
      ok++
    } catch (err) {
      console.log(`  FAIL   ${m.title} — ${err.message}`)
      failed++
    }
    await new Promise((r) => setTimeout(r, 250)) // gentle on TMDB rate limits
  }

  for (const s of series) {
    try {
      const d = await tmdb(`/tv/${s.tmdb_id}?language=en-US&append_to_response=external_ids`)
      const genres = JSON.stringify((d.genres ?? []).map((g) => g.name))
      const gained = [
        s.tvdb_id == null && d.external_ids?.tvdb_id ? 'tvdb' : null,
        isEmptyGenres(s.genres) && genres !== '[]' ? 'genres' : null,
      ].filter(Boolean)
      if (!DRY) {
        updSeries.run({
          id: s.id,
          tvdb_id: d.external_ids?.tvdb_id ?? null,
          genres,
          updated_at: Date.now(),
        })
      }
      console.log(`  series ${s.title.padEnd(40)} +${gained.join(',') || 'nothing new'}`)
      ok++
    } catch (err) {
      console.log(`  FAIL   ${s.title} — ${err.message}`)
      failed++
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  console.log(`\n${DRY ? 'would update' : 'updated'} ${ok}, failed ${failed}`)
}

main()
