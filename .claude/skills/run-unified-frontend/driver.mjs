#!/usr/bin/env node
// REPL driver for unified-frontend (Playwright-backed; chromium-cli is not available in this
// environment, so this fills the same role). Reads one command per line from stdin, prints
// "OK ..." or "ERR ..." per line. Run it under tmux for an interactive session — see SKILL.md.
//
// Commands:
//   nav <url>                 navigate (waits for domcontentloaded)
//   wait-for text=<substr>    wait for visible text (also: wait-for <css-selector>)
//   click <css-selector>
//   fill <css-selector> <text...>
//   press <key>                e.g. Enter
//   screenshot [name]          saves to ./driver-screenshots/<name-or-timestamp>.png
//   text [css-selector]        prints up to 500 chars of textContent (default: body)
//   eval <js-expression>       page.evaluate(expression), prints JSON result
//   console                    dumps captured browser console errors + pageerrors so far
//   login                      reads ADMIN_USERNAME/ADMIN_PASSWORD from app/.env.local itself
//                              (never pass credentials as a command argument — anything typed
//                              via `tmux send-keys` is echoed into the pane and is capturable via
//                              `tmux capture-pane`, i.e. plaintext-in-logs) and submits the login
//                              form at #username/#password. Assumes you've already `nav`-ed to
//                              /login.
//   quit

import { chromium } from 'playwright'
import readline from 'node:readline'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const SCREENSHOT_DIR = process.env.DRIVER_SCREENSHOT_DIR || path.join(process.cwd(), 'driver-screenshots')
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

// Resolves relative to THIS file, not cwd, so `login` works no matter where the driver is launched from.
const ENV_LOCAL_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'app', '.env.local')

function readEnvLocalCreds() {
  const raw = fs.readFileSync(ENV_LOCAL_PATH, 'utf8')
  const get = (key) => raw.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim()
  const username = get('ADMIN_USERNAME') || 'admin'
  const password = get('ADMIN_PASSWORD')
  if (!password) throw new Error('ADMIN_PASSWORD not found in app/.env.local')
  return { username, password }
}

let browser, page
const consoleErrors = []

async function ensurePage() {
  if (!browser) {
    browser = await chromium.launch({ args: ['--no-sandbox'] })
    const context = await browser.newContext({ ignoreHTTPSErrors: true })
    page = await context.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))
  }
  return page
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return
  const [cmd, ...rest] = trimmed.split(' ')
  const arg = rest.join(' ')
  try {
    await ensurePage()
    switch (cmd) {
      case 'nav':
        await page.goto(arg, { waitUntil: 'domcontentloaded', timeout: 20000 })
        console.log(`OK nav ${arg}`)
        break
      case 'wait-for':
        if (arg.startsWith('text=')) {
          await page.getByText(arg.slice(5), { exact: false }).first().waitFor({ timeout: 15000 })
        } else {
          await page.waitForSelector(arg, { timeout: 15000 })
        }
        console.log(`OK wait-for ${arg}`)
        break
      case 'click':
        await page.click(arg, { timeout: 10000 })
        console.log(`OK click ${arg}`)
        break
      case 'fill': {
        const [sel, ...vals] = rest
        await page.fill(sel, vals.join(' '), { timeout: 10000 })
        console.log(`OK fill ${sel}`)
        break
      }
      case 'press':
        await page.keyboard.press(arg)
        console.log(`OK press ${arg}`)
        break
      case 'screenshot': {
        const name = arg || `shot-${Date.now()}`
        const file = path.join(SCREENSHOT_DIR, `${name}.png`)
        await page.screenshot({ path: file, fullPage: true })
        console.log(`OK screenshot ${file}`)
        break
      }
      case 'text': {
        const body = await page.textContent(arg || 'body')
        console.log('OK text', (body ?? '').replace(/\s+/g, ' ').trim().slice(0, 500))
        break
      }
      case 'eval': {
        const result = await page.evaluate(arg)
        console.log('OK eval', JSON.stringify(result))
        break
      }
      case 'console':
        console.log('OK console', JSON.stringify(consoleErrors))
        break
      case 'login': {
        const { username, password } = readEnvLocalCreds()
        await page.fill('#username', username, { timeout: 10000 })
        await page.fill('#password', password, { timeout: 10000 })
        await page.click('button:has-text("Sign In")', { timeout: 10000 })
        await page.waitForLoadState('domcontentloaded')
        console.log('OK login') // never echo the password
        break
      }
      case 'quit':
        await browser.close()
        console.log('OK quit')
        process.exit(0)
        break
      default:
        console.log(`ERR unknown command: ${cmd}`)
    }
  } catch (err) {
    console.log(`ERR ${cmd}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
  }
})

process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0) })
