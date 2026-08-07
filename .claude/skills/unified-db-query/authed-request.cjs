#!/usr/bin/env node
// authed-request.cjs — log in as the app's own admin and make one authenticated request
// against the LIVE unified-frontend app on localhost:3001, run from INSIDE the container
// (docker exec unified-frontend node /app/authed-request.cjs ...).
//
// Credentials are never hardcoded or passed as arguments: ADMIN_USERNAME/ADMIN_PASSWORD are
// already present in this container's process environment (compose's env_file loads
// app/.env.local into it at container start), so `docker exec` inherits them automatically —
// verified live 2026-07-21. This means the helper keeps working across credential rotations
// with zero edits.
//
// Usage:
//   node authed-request.cjs <METHOD> <path> [jsonBody] [--wait-job]
//
// Examples:
//   node authed-request.cjs GET /api/auth/me
//   node authed-request.cjs POST /api/media/scan --wait-job
//   node authed-request.cjs POST /api/subtitle/download --wait-job
//   node authed-request.cjs PATCH /api/auth/profile/display-name '{"displayName":"Joseph"}'
//
// --wait-job polls a returned {jobId} against GET /api/jobs/:id every second (up to 5 min)
// and prints the final result/error — covers the enqueue-a-background-job routes (media scan,
// subtitle download, etc.) that return 202 immediately and finish asynchronously.

const http = require('http')

const [, , method, path, ...rest] = process.argv
if (!method || !path) {
  console.error('usage: node authed-request.cjs <METHOD> <path> [jsonBody] [--wait-job]')
  process.exit(1)
}
const waitJob = rest.includes('--wait-job')
const bodyArg = rest.find((a) => a !== '--wait-job')

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

;(async () => {
  const username = process.env.ADMIN_USERNAME
  const password = process.env.ADMIN_PASSWORD
  if (!username || !password) {
    console.error(
      'ADMIN_USERNAME/ADMIN_PASSWORD not in env — this must run via `docker exec unified-frontend node /app/<script>`, not on the host.',
    )
    process.exit(1)
  }

  const loginBody = JSON.stringify({ username, password })
  const loginRes = await req(
    {
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) },
    },
    loginBody,
  )
  if (loginRes.status !== 200 || !loginRes.headers['set-cookie']) {
    console.error('login failed:', loginRes.status, loginRes.body)
    process.exit(1)
  }
  const cookie = loginRes.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ')

  const body = bodyArg && bodyArg.trim().startsWith('{') ? bodyArg : undefined
  const headers = { Cookie: cookie }
  if (body) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(body)
  } else {
    headers['Content-Length'] = 0
  }

  const res = await req({ hostname: 'localhost', port: 3001, path, method, headers }, body)
  console.log(`${method} ${path} -> ${res.status}`)
  console.log(res.body)

  if (waitJob) {
    let jobId
    try {
      jobId = JSON.parse(res.body).jobId
    } catch {
      /* no job id in the response — nothing to poll */
    }
    if (!jobId) {
      console.error('--wait-job set but the response had no jobId')
      return
    }
    for (let i = 0; i < 300; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const jobRes = await req({
        hostname: 'localhost',
        port: 3001,
        path: `/api/jobs/${jobId}`,
        headers: { Cookie: cookie },
      })
      const job = JSON.parse(jobRes.body)
      if (job.status === 'done') {
        console.log('JOB DONE:', JSON.stringify(job.result))
        return
      }
      if (job.status === 'failed') {
        console.log('JOB FAILED:', job.error)
        return
      }
    }
    console.log('JOB TIMED OUT after 300s')
  }
})()
