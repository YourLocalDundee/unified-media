#!/usr/bin/env node
// qbit.cjs — authenticate to a qBittorrent WebUI and run one operation, without opening a
// browser. Runs on the HOST (qBittorrent is host-networked, reachable directly over the LAN),
// not inside any container.
//
// Connection resolution order (first one fully set wins):
//   1. --host/--port/--user/--pass flags
//   2. QBIT_HOST / QBIT_PORT / QBIT_USER / QBIT_PASS env vars
//   3. Fallback: parse UMT_URL (host:port) + UMT_USERNAME + UMT_PASSWORD out of
//      unified-frontend's app/.env.local — i.e. "the instance unified-frontend itself talks
//      to" is the default target, since that's the one this project cares about day to day.
//      Point explicitly at another instance (e.g. the original shared qbittorrent on :8080)
//      with the flags/env vars above.
//
// Subcommands:
//   login                                just authenticate, print ok/fail
//   list                                 GET torrents/info — hash, category, progress, state, name
//   delete <hash...> [--files]           POST torrents/delete (--files also deletes the data on disk)
//   add <magnet-or-url> [--category X]   POST torrents/add
//   raw <METHOD> <api-path> [formBody]   escape hatch for anything else, e.g.:
//                                          qbit.cjs raw POST /api/v2/torrents/pause hashes=all
//
// Examples:
//   node qbit.cjs list
//   node qbit.cjs --port 8080 --user admin --pass '...' list      # the OTHER instance
//   node qbit.cjs delete 0f8478bf303bbe0e4c5bf159bbdefc823211af30 --files
//   node qbit.cjs raw GET /api/v2/app/version

const http = require('http')
const fs = require('fs')
const path = require('path')

const ENV_LOCAL_PATH = path.join(__dirname, '..', '..', '..', 'app', '.env.local')

function parseEnvFile(filePath) {
  const out = {}
  let text
  try {
    text = fs.readFileSync(filePath, 'utf-8')
  } catch {
    return out
  }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
  }
  return out
}

function resolveConnection(flags) {
  if (flags.host && flags.port && flags.user && flags.pass) {
    return { host: flags.host, port: flags.port, user: flags.user, pass: flags.pass }
  }
  if (process.env.QBIT_HOST && process.env.QBIT_PORT && process.env.QBIT_USER && process.env.QBIT_PASS) {
    return {
      host: process.env.QBIT_HOST,
      port: process.env.QBIT_PORT,
      user: process.env.QBIT_USER,
      pass: process.env.QBIT_PASS,
    }
  }
  const env = parseEnvFile(ENV_LOCAL_PATH)
  const m = (env.UMT_URL || '').match(/^https?:\/\/([^:/]+):(\d+)/)
  if (m && env.UMT_USERNAME && env.UMT_PASSWORD) {
    return { host: flags.host || m[1], port: flags.port || m[2], user: flags.user || env.UMT_USERNAME, pass: flags.pass || env.UMT_PASSWORD }
  }
  console.error(
    `Could not resolve qBittorrent connection details. Pass --host/--port/--user/--pass, set QBIT_HOST/QBIT_PORT/QBIT_USER/QBIT_PASS, or ensure ${ENV_LOCAL_PATH} has UMT_URL/UMT_USERNAME/UMT_PASSWORD.`,
  )
  process.exit(1)
}

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(opts, (res) => {
      let data = ''
      res.on('data', (d) => (data += d))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    r.on('error', reject)
    if (body) r.write(body)
    r.end()
  })
}

async function login(conn) {
  const body = `username=${encodeURIComponent(conn.user)}&password=${encodeURIComponent(conn.pass)}`
  const res = await req(
    {
      hostname: conn.host,
      port: conn.port,
      path: '/api/v2/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        // qBittorrent's CSRF check requires Referer to match the host it's being addressed as.
        Referer: `http://${conn.host}:${conn.port}`,
      },
    },
    body,
  )
  // qBittorrent returns 204 (not 200) on a successful login — verified against this stack's
  // v5.2.1 WebUI repeatedly. Accept any 2xx rather than hardcoding one status code.
  if (res.status < 200 || res.status >= 300 || !res.headers['set-cookie']) {
    throw new Error(`login failed: HTTP ${res.status} ${res.body}`)
  }
  return res.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ')
}

function parseFlags(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--host') flags.host = argv[++i]
    else if (a === '--port') flags.port = argv[++i]
    else if (a === '--user') flags.user = argv[++i]
    else if (a === '--pass') flags.pass = argv[++i]
    else if (a === '--category') flags.category = argv[++i]
    else if (a === '--files') flags.files = true
    else rest.push(a)
  }
  return { flags, rest }
}

async function main() {
  // Flags can appear anywhere (before or after the subcommand) — parse the whole argv first,
  // then the subcommand is simply the first token that wasn't consumed as a flag/flag-value.
  const { flags, rest: allRest } = parseFlags(process.argv.slice(2))
  const cmd = allRest[0]
  const rest = allRest.slice(1)
  if (!cmd) {
    console.error('usage: qbit.cjs <login|list|delete|add|raw> ...  (see comment header for full usage)')
    process.exit(1)
  }
  const conn = resolveConnection(flags)
  const cookie = await login(conn)

  if (cmd === 'login') {
    console.log(`ok — authenticated to ${conn.host}:${conn.port} as ${conn.user}`)
    return
  }

  if (cmd === 'list') {
    const res = await req({ hostname: conn.host, port: conn.port, path: '/api/v2/torrents/info', headers: { Cookie: cookie } })
    const torrents = JSON.parse(res.body)
    for (const t of torrents) {
      console.log(`${t.hash} | ${(t.category || '—').padEnd(12)} | ${(t.progress * 100).toFixed(1).padStart(5)}% | ${t.state.padEnd(12)} | ${t.name}`)
    }
    console.log(`\n${torrents.length} torrent(s)`)
    return
  }

  if (cmd === 'delete') {
    const hashes = rest
    if (hashes.length === 0) {
      console.error('usage: qbit.cjs delete <hash...> [--files]')
      process.exit(1)
    }
    const body = `hashes=${hashes.join('|')}&deleteFiles=${flags.files ? 'true' : 'false'}`
    const res = await req(
      {
        hostname: conn.host,
        port: conn.port,
        path: '/api/v2/torrents/delete',
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), Referer: `http://${conn.host}:${conn.port}` },
      },
      body,
    )
    console.log(`delete -> HTTP ${res.status}${flags.files ? ' (files deleted)' : ' (torrent entry only, files kept)'}`)
    return
  }

  if (cmd === 'add') {
    const url = rest[0]
    if (!url) {
      console.error('usage: qbit.cjs add <magnet-or-url> [--category X]')
      process.exit(1)
    }
    const params = [`urls=${encodeURIComponent(url)}`]
    if (flags.category) params.push(`category=${encodeURIComponent(flags.category)}`)
    const body = params.join('&')
    const res = await req(
      {
        hostname: conn.host,
        port: conn.port,
        path: '/api/v2/torrents/add',
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), Referer: `http://${conn.host}:${conn.port}` },
      },
      body,
    )
    console.log(`add -> HTTP ${res.status} ${res.body}`)
    return
  }

  if (cmd === 'raw') {
    const [method, apiPath, formBody] = rest
    if (!method || !apiPath) {
      console.error('usage: qbit.cjs raw <METHOD> <api-path> [formBody]')
      process.exit(1)
    }
    const headers = { Cookie: cookie, Referer: `http://${conn.host}:${conn.port}` }
    if (formBody) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      headers['Content-Length'] = Buffer.byteLength(formBody)
    }
    const res = await req({ hostname: conn.host, port: conn.port, path: apiPath, method, headers }, formBody)
    console.log(`${method} ${apiPath} -> HTTP ${res.status}`)
    console.log(res.body)
    return
  }

  console.error(`unknown subcommand: ${cmd}`)
  process.exit(1)
}

main().catch((err) => {
  console.error('error:', err.message)
  process.exit(1)
})
