import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { syntheticReports } from '../tools/motion/fixture.mjs'

// Synthetic isolated profile only. No external requests, real drafts, or printing.
const [endpoint, origin] = process.argv.slice(2)
assert.match(endpoint || '', /^ws:\/\/127\.0\.0\.1:/)
assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/)
const output = resolve('tmp/motion-polish-evidence')
await mkdir(output, { recursive: true })
const socket = new WebSocket(endpoint)
await new Promise((yes, no) => { socket.addEventListener('open', yes, { once: true }); socket.addEventListener('error', no, { once: true }) })
let sequence = 0
const pending = new Map(), records = [], errors = []
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) { const request = pending.get(message.id); pending.delete(message.id); if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result) }
  else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params
    const url = new URL(request.url)
    const allowed = url.origin === origin && request.method === 'GET' && !url.pathname.startsWith('/api/')
    call(allowed ? 'Fetch.continueRequest' : 'Fetch.fulfillRequest', allowed ? { requestId } : { requestId, responseCode: 503, body: '' }, message.sessionId).catch((error) => errors.push(String(error)))
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text)
})
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) })
const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
const page = (method, params) => call(method, params, sessionId)
const evaluate = async (fn, ...args) => { const result = await page('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value }
const record = (name, details) => { records.push({ name, details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`) }
const wait = async (fn) => { for (let i = 0; i < 200; i++) { try { if (await evaluate(fn)) return } catch { /* navigation */ } await new Promise((yes) => setTimeout(yes, 25)) } throw new Error(`Timed out: ${fn}; ${JSON.stringify(await evaluate(() => ({ url: location.href, body: document.body?.innerText })))}`) }
await page('Page.enable'); await page('Runtime.enable'); await page('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
await page('Page.navigate', { url: origin })
await wait(() => Boolean(document.querySelector('.drop-zone')))
await evaluate(() => {
  localStorage.clear()
  window.print = () => { throw new Error('Focused QA must not print') }
  window.__reads = new Map()
  window.__uploadPending = (kind, name) => {
    const file = new File(['synthetic'], name, { type: 'text/csv', lastModified: 123 })
    Object.defineProperty(file, 'text', { value: () => new Promise((resolve, reject) => window.__reads.set(name, { resolve, reject })) })
    const transfer = new DataTransfer(); transfer.items.add(file)
    const input = document.querySelector(kind === 'sales' ? 'input[multiple]' : 'input[type=file]:not([multiple])')
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  }
})
for (const width of [1440, 390, 320]) {
  await page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
  const result = await evaluate(async (width) => {
    const frame = () => new Promise((yes) => requestAnimationFrame(() => requestAnimationFrame(yes)))
    const reset = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Clear all')); reset?.click(); await frame()
    const button = document.querySelector('.drop-zone')
    const before = button.getBoundingClientRect().height
    window.__uploadPending('sales', 'Synthetic-sales.csv'); await frame()
    const reading = document.querySelector('.file-status').textContent
    const frames = []
    for (let index = 0; index < 12; index++) { await new Promise(requestAnimationFrame); frames.push(button.getBoundingClientRect().height) }
    window.__reads.get('Synthetic-sales.csv').resolve('Products and Categories,Quantity\nSynthetic,2'); await frame()
    const after = button.getBoundingClientRect().height
    const remove = document.querySelector('[aria-label="Remove Synthetic-sales.csv"]'); remove.focus(); remove.click(); await frame()
    return { width, before, after, reading, frames, focusReturned: document.activeElement === button, transform: getComputedStyle(button).transform, documentWidth: document.documentElement.scrollWidth }
  }, width)
  assert.match(result.reading, /Reading 1 file/); assert.equal(result.before, result.after); assert.ok(result.frames.every((height) => height === result.before)); assert.equal(result.focusReturned, true); assert.equal(result.transform, 'none')
  record(`stable intake footprint, real pending state and removal focus at ${width}px`, result)
  const shot = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(resolve(output, `intake-${width}.png`), Buffer.from(shot.data, 'base64'))
}
const race = await evaluate(async () => {
  const frame = () => new Promise((yes) => requestAnimationFrame(() => requestAnimationFrame(yes)))
  window.__uploadPending('inventory', 'Synthetic-older.csv'); window.__uploadPending('inventory', 'Synthetic-newer.csv'); await frame()
  window.__reads.get('Synthetic-newer.csv').resolve('Product,Balance\nGames >>Synthetic,4'); await frame()
  window.__reads.get('Synthetic-older.csv').resolve('Product,Balance\nGames >>Stale,7'); await frame()
  const latestWins = Boolean(document.querySelector('[aria-label="Remove Synthetic-newer.csv"]')) && !document.querySelector('[aria-label="Remove Synthetic-older.csv"]')
  window.__uploadPending('sales', 'Synthetic-stale.csv'); await frame()
  ;[...document.querySelectorAll('button')].find((button) => button.textContent.includes('Clear all')).click(); await frame()
  window.__reads.get('Synthetic-stale.csv').resolve('Products and Categories,Quantity\nStale,2'); await frame()
  return { latestWins, staleDiscarded: !document.querySelector('.file-pill'), busyCleared: !document.querySelector('[aria-busy=true]') }
})
assert.deepEqual(race, { latestWins: true, staleDiscarded: true, busyCleared: true }); record('late completion cannot replace a newer inventory file or revive reset intake', race)
const performance = await evaluate(async () => {
  const { buildBaseReport } = await import('/src/lib/restock.ts')
  const results = []
  for (const count of [1000, 5000, 10000]) {
    const sales = 'Products and Categories,Quantity\n' + Array.from({ length: count }, (_, index) => `Synthetic ${index},2`).join('\n')
    const inventory = 'Product,Balance\n' + Array.from({ length: count }, (_, index) => `Games >>Synthetic ${index},8`).join('\n')
    const durations = []
    for (let run = 0; run < 3; run++) { const start = globalThis.performance.now(); buildBaseReport([{ name: 'Synthetic-sales.csv', text: sales }], { name: 'Synthetic-inventory.csv', text: inventory }); durations.push(globalThis.performance.now() - start) }
    results.push({ rowsPerFile: count, milliseconds: durations.map((value) => Number(value.toFixed(2))) })
  }
  return results
})
record('measured synchronous processing on synthetic local reports; parser unchanged', performance)
const parity = await evaluate(async (fixture) => {
  const { buildBaseReport } = await import('/src/lib/restock.ts')
  const inputs = [
    { sales: fixture.sales, inventory: fixture.inventory },
    { sales: [{ name: 'invalid.csv', text: 'Wrong,Headers\n1,2' }], inventory: fixture.inventory },
  ]
  return Promise.all(inputs.map(async (input) => {
    let direct
    try { direct = { ok: true, report: buildBaseReport(input.sales, input.inventory) } } catch (error) { direct = { ok: false, error: error.message } }
    const background = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('/src/report.worker.ts', location.origin), { type: 'module' })
      worker.onmessage = (event) => { worker.terminate(); resolve(event.data) }; worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)) }
      worker.postMessage(input)
    })
    return { direct, background }
  }))
}, syntheticReports())
for (const result of parity) assert.deepEqual(result.background, result.direct)
record('real worker exactly matches direct duplicate-inventory, multi-sales, exclusions and parser-error results', { fixtures: parity.length })
const responsiveness = await evaluate(async () => {
  const count = 10000
  const sales = 'Products and Categories,Quantity\n' + Array.from({ length: count }, (_, index) => `Synthetic ${index},2`).join('\n')
  const inventory = 'Product,Balance\n' + Array.from({ length: count }, (_, index) => `Games >>Synthetic ${index},8`).join('\n')
  let running = true, frameCount = 0, last = performance.now(), maxGap = 0
  const tick = () => { if (!running) return; const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; frameCount++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const start = performance.now()
  const result = await new Promise((resolve, reject) => {
    const worker = new Worker(new URL('/src/report.worker.ts', location.origin), { type: 'module' })
    worker.onmessage = (event) => { worker.terminate(); resolve(event.data) }; worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message)) }
    worker.postMessage({ sales: [{ name: 'Synthetic-sales.csv', text: sales }], inventory: { name: 'Synthetic-inventory.csv', text: inventory } })
  })
  running = false
  return { ok: result.ok, rowsPerFile: count, frameCount, maxFrameGapMs: Number(maxGap.toFixed(2)), elapsedMs: Number((performance.now() - start).toFixed(2)) }
})
assert.equal(responsiveness.ok, true); assert.ok(responsiveness.frameCount > 2)
record('browser continues painting during 10000-row background processing', responsiveness)

// A real CSP denial exercises the app's startup-error fallback without changing data or parser rules.
await evaluate(async () => {
  const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = "worker-src 'none'"; document.head.append(meta)
  window.__uploadPending('sales', 'Synthetic-csp-sales.csv'); window.__uploadPending('inventory', 'Synthetic-csp-inventory.csv')
  window.__reads.get('Synthetic-csp-sales.csv').resolve('Products and Categories,Quantity\nSynthetic fallback,2')
  window.__reads.get('Synthetic-csp-inventory.csv').resolve('Product,Balance\nGames >>Synthetic fallback,4')
})
await wait(() => !document.querySelector('[aria-busy=true]'))
await evaluate(() => document.querySelector('.process-row .primary-button').click())
await wait(() => Boolean(document.querySelector('.report-card')))
const csp = await evaluate(() => ({ item: document.querySelector('.report-item-name').textContent, quantity: document.querySelector('.qty-to-pull').textContent }))
assert.deepEqual(csp, { item: 'Synthetic fallback', quantity: '2' }); record('CSP-blocked worker falls back to local processing', csp)
await page('Network.enable')
await page('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await evaluate(() => document.querySelector('.toolbar-actions .secondary-button').click())
await wait(() => document.querySelector('.process-row .primary-button')?.textContent.includes('Process Reports'))
const offline = await evaluate(() => ({ item: document.querySelector('.report-item-name').textContent, quantity: document.querySelector('.qty-to-pull').textContent, error: document.querySelector('[role=alert]')?.textContent || '' }))
assert.deepEqual(offline, { ...csp, error: '' }); record('already loaded app still processes locally while offline and workers are blocked', offline)
await page('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
const reduced = await evaluate(async () => { await new Promise((yes) => requestAnimationFrame(() => requestAnimationFrame(yes))); const button = document.querySelector('.drop-zone'); button.focus(); return { transition: getComputedStyle(button).transitionDuration, focus: button.matches(':focus-visible'), transform: getComputedStyle(button).transform } })
assert.equal(reduced.transition, '0s'); assert.equal(reduced.focus, true); assert.equal(reduced.transform, 'none'); record('reduced motion preserves stationary buttons and keyboard focus', reduced)
assert.deepEqual(errors, [])
await writeFile(resolve(output, 'checks.json'), JSON.stringify({ records, errors }, null, 2))
socket.close()
