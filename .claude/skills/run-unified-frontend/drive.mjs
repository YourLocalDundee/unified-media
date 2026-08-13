#!/usr/bin/env node
// Flow runner for unified-frontend. Runs an ENTIRE flow in one process and prints one
// compact line per step. Replaces the old tmux/REPL driver, which cost three tool calls
// (send-keys + sleep + capture-pane) per single step.
//
// Two deliberate choices, both about token cost:
//
//   1. Assertions are on the ACCESSIBILITY TREE, not on pixels. `snapshot` prints a compact
//      text tree of what actually rendered — roles, names, structure — which is what "did it
//      render correctly" really means. A screenshot costs ~1500 tokens to look at; a snapshot
//      costs ~100 and diffs cleanly between runs.
//   2. Screenshots are NOT taken per step. They are taken automatically when a step FAILS,
//      and otherwise only when you explicitly ask. Pixels are for when something is already
//      known to be wrong, or for genuine visual regression (see `shot` + compare below).
//
// Usage:  node drive.mjs <flow-file>     ('-' reads the flow from stdin)
// Exit:   0 = every step passed, 1 = a step failed (details + screenshot path on stderr)
//
// Flow syntax: one step per line, '#' comments and blank lines ignored.
//
//   nav <url>                  navigate, wait for domcontentloaded
//   login                      read creds from the env file INSIDE this process and submit.
//                              Never pass a password as an argument — see SKILL.md.
//   click <selector>           playwright selector, e.g. `text=Requests` or `#submit`
//   fill <selector> <text...>  non-credential fields only
//   press <key>                e.g. Enter
//   wait-for <selector>        or `wait-for text=<substring>`
//   snapshot [selector]        ARIA tree of the page (or a subtree). THE default check.
//   text [selector]            textContent, collapsed, first 400 chars
//   expect <substring>         fail the flow unless the substring is visible
//   expect-no-errors           fail the flow if any console/page errors were captured
//   eval <js>                  page.evaluate, prints JSON
//   shot [name]                explicit screenshot -> screenshots/<name>.png
//   quit                       optional; the process exits at end of flow anyway

import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SHOT_DIR = process.env.DRIVE_SHOT_DIR || path.join(HERE, 'screenshots')
// Paths are printed for a human sitting on the HOST, but this process runs inside a container
// where the skill dir is mounted at /w. Printing /w/... sends them looking for a path that does
// not exist out there, so translate back to the host path before printing.
const HOST_DIR = process.env.DRIVE_HOST_DIR
const forHost = (p) => (HOST_DIR ? p.replace(/^\/w\b/, HOST_DIR) : p)
const ENV_FILE = process.env.DRIVE_ENV_FILE || '/env/app.env'
const BASE = process.env.DRIVE_BASE_URL || 'http://localhost:3001'

// Console noise that is expected and is not a failure. Anything matching is dropped before
// `expect-no-errors` sees it, so that check stays meaningful instead of always red.
const IGNORED_CONSOLE = [
  /Failed to load resource.*\b401\b/i, // download client unreachable from here — expected
  /hydration/i, // client-only theme toggle reading localStorage after SSR
  /Download the React DevTools/i,
]

function readCreds() {
  if (!fs.existsSync(ENV_FILE)) throw new Error(`env file not found: ${ENV_FILE}`)
  const raw = fs.readFileSync(ENV_FILE, 'utf8')
  const get = (k) => raw.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim()
  const username = get('ADMIN_USERNAME') || 'admin'
  const password = get('ADMIN_PASSWORD')
  if (!password) throw new Error(`ADMIN_PASSWORD not present in ${ENV_FILE}`)
  return { username, password }
}

function sel(arg) {
  return arg.startsWith('text=') ? arg : arg
}

const flowArg = process.argv[2]
if (!flowArg) {
  console.error('usage: node drive.mjs <flow-file>   ("-" for stdin)')
  process.exit(2)
}
const flowSrc =
  flowArg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(flowArg, 'utf8')
const steps = flowSrc
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))

fs.mkdirSync(SHOT_DIR, { recursive: true })

const errors = []
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const context = await browser.newContext({ ignoreHTTPSErrors: true })
const page = await context.newPage()
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(m.text()))) {
    errors.push(m.text())
  }
})
page.on('pageerror', (e) => {
  if (!IGNORED_CONSOLE.some((re) => re.test(String(e)))) errors.push(String(e))
})

let failed = null

for (const [i, step] of steps.entries()) {
  const n = String(i + 1).padStart(2, '0')
  const [cmd, ...rest] = step.split(' ')
  const arg = rest.join(' ')
  try {
    switch (cmd) {
      case 'nav': {
        const url = arg.startsWith('http') ? arg : BASE + (arg.startsWith('/') ? arg : `/${arg}`)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
        console.log(`${n} ok   nav ${url}`)
        break
      }
      case 'login': {
        const { username, password } = readCreds()
        await page.fill('#username', username, { timeout: 10000 })
        await page.fill('#password', password, { timeout: 10000 })
        await page.click('button[type="submit"]', { timeout: 10000 })
        await page.waitForLoadState('domcontentloaded')
        console.log(`${n} ok   login (as ${username})`) // password never printed
        break
      }
      case 'click':
        await page.click(sel(arg), { timeout: 10000 })
        console.log(`${n} ok   click ${arg}`)
        break
      case 'fill': {
        const [s, ...v] = rest
        await page.fill(s, v.join(' '), { timeout: 10000 })
        console.log(`${n} ok   fill ${s}`)
        break
      }
      case 'press':
        await page.keyboard.press(arg)
        console.log(`${n} ok   press ${arg}`)
        break
      case 'wait-for':
        if (arg.startsWith('text=')) {
          await page.getByText(arg.slice(5), { exact: false }).first().waitFor({ timeout: 15000 })
        } else {
          await page.waitForSelector(arg, { timeout: 15000 })
        }
        console.log(`${n} ok   wait-for ${arg}`)
        break
      case 'snapshot': {
        // `nav` only waits for domcontentloaded, so a snapshot taken straight after it can come
        // back empty — the markup is there but React hasn't hydrated, so nothing has a role yet.
        // An empty tree reads like "the page rendered nothing", which is a lie, so wait for load
        // and then briefly for the tree to become non-empty before reporting it.
        await page.waitForLoadState('load').catch(() => {})
        const loc = arg ? page.locator(arg) : page.locator('body')
        let tree = ''
        for (let t = 0; t < 10; t++) {
          tree = await loc.ariaSnapshot()
          if (tree.trim()) break
          await page.waitForTimeout(300)
        }
        console.log(
          `${n} ok   snapshot ${arg || 'body'}\n${tree.trim() ? tree : '(empty — nothing with an accessible role rendered)'}`
        )
        break
      }
      case 'text': {
        const t = await page.textContent(arg || 'body')
        console.log(`${n} ok   text ${(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)}`)
        break
      }
      case 'expect': {
        await page.getByText(arg, { exact: false }).first().waitFor({ timeout: 15000 })
        console.log(`${n} ok   expect ${arg}`)
        break
      }
      case 'expect-no-errors':
        if (errors.length) throw new Error(`${errors.length} console error(s): ${errors[0]}`)
        console.log(`${n} ok   expect-no-errors`)
        break
      case 'eval':
        console.log(`${n} ok   eval ${JSON.stringify(await page.evaluate(arg))}`)
        break
      case 'shot': {
        const f = path.join(SHOT_DIR, `${arg || `shot-${Date.now()}`}.png`)
        await page.screenshot({ path: f, fullPage: true })
        console.log(`${n} ok   shot ${forHost(f)}`)
        break
      }
      case 'quit':
        break
      default:
        throw new Error(`unknown command: ${cmd}`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err)
    // Only now is a picture worth its tokens: something is already known to be wrong.
    const f = path.join(SHOT_DIR, `FAIL-step${n}.png`)
    try {
      await page.screenshot({ path: f, fullPage: true })
    } catch {}
    console.log(`${n} FAIL ${cmd} ${arg}`)
    console.error(`\nstep ${n} failed: ${msg}`)
    console.error(`url at failure: ${page.url()}`)
    console.error(`screenshot: ${forHost(f)}`)
    try {
      console.error(`\naria tree at failure:\n${await page.locator('body').ariaSnapshot()}`)
    } catch {}
    failed = n
    break
  }
}

if (errors.length) {
  console.error(`\nconsole errors captured (${errors.length}):`)
  for (const e of errors.slice(0, 10)) console.error(`  - ${e}`)
}

await browser.close()
console.log(failed ? `\nFLOW FAILED at step ${failed}` : `\nFLOW OK (${steps.length} steps)`)
process.exit(failed ? 1 : 0)
