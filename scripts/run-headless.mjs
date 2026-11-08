// Minimal CDP driver: open one page in headless Chrome, wait for #out to settle,
// print the result, optionally save a screenshot. No Playwright dependency.
//
// usage: node scripts/run-headless.mjs <url> [--shot out.png] [--timeout 120000]
//
// Why CDP polling instead of `--dump-dom --virtual-time-budget`: the virtual
// clock runs out during OpenCASCADE's wasm compile, so the page looks stuck.
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Override with CHROME_PATH on non-macOS installs or custom Chrome locations.
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const args = process.argv.slice(2)
const url = args[0]
if (!url) {
  console.error('usage: node scripts/run-headless.mjs <url> [--shot out.png] [--timeout ms]')
  process.exit(2)
}
const shotIndex = args.indexOf('--shot')
const shotPath = shotIndex > -1 ? args[shotIndex + 1] : undefined
const timeoutIndex = args.indexOf('--timeout')
const timeoutMs = timeoutIndex > -1 ? Number(args[timeoutIndex + 1]) : 120000
let port = 0

// `--remote-debugging-port=0` lets the OS pick a free port; Chrome reports it
// in <profile>/DevToolsActivePort, which avoids collisions with the old random
// 9333–9532 range.
const profile = await mkdtemp(join(tmpdir(), 'dsh3d-chrome-'))
let spawnError
const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--enable-unsafe-swiftshader',
  '--window-size=960,760',
  `--user-data-dir=${profile}`,
  '--remote-debugging-port=0',
  'about:blank',
], { stdio: 'ignore' })
chrome.once('error', (error) => { spawnError = error })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForDevToolsPort() {
  const file = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 150; i += 1) {
    if (spawnError) throw new Error(`cannot start Chrome at ${CHROME}: ${spawnError.message}`)
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome exited before opening the debugging port (code ${chrome.exitCode}); `
        + `set CHROME_PATH if this is not the right binary: ${CHROME}`)
    }
    try {
      const [first] = (await readFile(file, 'utf8')).split(/\r?\n/)
      const parsed = Number(first)
      if (Number.isInteger(parsed) && parsed > 0) return parsed
    } catch {
      // Chrome has not written the file yet.
    }
    await sleep(100)
  }
  throw new Error(`headless Chrome did not write DevToolsActivePort under ${profile}`)
}

async function endpoint(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`)
  return response.json()
}

async function waitForChrome() {
  for (let i = 0; i < 100; i += 1) {
    try {
      await endpoint('/json/version')
      return
    } catch {
      await sleep(200)
    }
  }
  throw new Error(`headless Chrome did not expose the debugging port ${port}`)
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.console = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
        else pending.resolve(message.result)
        return
      }
      if (message.method === 'Runtime.consoleAPICalled') {
        const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
        this.console.push(`${message.params.type}: ${text}`)
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const detail = message.params.exceptionDetails
        this.console.push(`exception: ${detail.exception?.description || detail.text}`)
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
}

let exitCode = 1
try {
  port = await waitForDevToolsPort()
  await waitForChrome()
  const tabs = await endpoint('/json/list')
  const target = tabs.find((tab) => tab.type === 'page')
  if (!target) throw new Error('no page target')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(socket)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url })

  const deadline = Date.now() + timeoutMs
  let result = ''
  while (Date.now() < deadline) {
    await sleep(500)
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: "document.getElementById('out') ? document.getElementById('out').textContent : ''",
      returnByValue: true,
    })
    const value = evaluated.result?.value || ''
    if (value && value !== 'running') {
      result = value
      break
    }
  }

  if (shotPath) {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(shotPath, Buffer.from(shot.data, 'base64'))
  }
  if (cdp.console.length) console.error(`[console]\n${cdp.console.join('\n')}`)
  if (!result) {
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML.slice(0, 400)',
      returnByValue: true,
    })
    console.error('TIMEOUT; page head:', evaluated.result?.value)
  } else {
    console.log(result)
    exitCode = /^PASS|PASS ·|RENDER PASS/.test(result) ? 0 : 1
  }
  socket.close()
} catch (error) {
  console.error('driver error:', error && error.stack ? error.stack : error)
} finally {
  // Kill first, wait for the process to go away, then delete the throwaway
  // profile: the old version left one dsh3d-chrome-* directory per run in /tmp.
  if (chrome.exitCode === null) {
    chrome.kill('SIGKILL')
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2000)
      chrome.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  try {
    await rm(profile, { recursive: true, force: true })
  } catch (error) {
    console.error(`could not remove Chrome profile ${profile}:`, error && error.message)
  }
}
process.exit(exitCode)
