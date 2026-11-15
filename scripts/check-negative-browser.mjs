import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Synthetic CSVs in a disposable context; no store data or print dialog.
// node scripts/check-negative-browser.mjs <local-browser-CDP-websocket> <local-preview-origin>
const [endpoint, origin] = process.argv.slice(2)
assert.match(endpoint || '', /^ws:\/\/127\.0\.0\.1:/)
assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/)
const output = resolve('tmp/motion-negative-evidence')
await mkdir(output, { recursive: true })
const checks = [], errors = [], blockedRequests = []
const socket = new WebSocket(endpoint)
await new Promise((yes, no) => { socket.addEventListener('open', yes, { once: true }); socket.addEventListener('error', no, { once: true }) })
let sequence = 0, browserContextId, targetId, sessionId
const pending = new Map()
const call = (method, params = {}, targetSession) => new Promise((yes, no) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); no(new Error(`CDP timed out: ${method}`)) }, 30000)
  pending.set(id, { yes, no, timer })
  socket.send(JSON.stringify({ id, method, params, ...(targetSession ? { sessionId: targetSession } : {}) }))
})
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) {
    const request = pending.get(message.id)
    if (!request) return
    clearTimeout(request.timer); pending.delete(message.id)
    if (message.error) request.no(new Error(JSON.stringify(message.error))); else request.yes(message.result)
  } else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params
    const url = new URL(request.url)
    const allowed = url.origin === origin && request.method === 'GET' && !/^\/api(?:\/|$)/.test(url.pathname)
    if (!allowed) blockedRequests.push({ method: request.method, url: request.url })
    call(allowed ? 'Fetch.continueRequest' : 'Fetch.fulfillRequest', allowed ? { requestId } : { requestId, responseCode: 503, body: '' }, message.sessionId).catch((error) => errors.push(String(error)))
  } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
})
const page = (method, params = {}) => call(method, params, sessionId)
const evaluate = async (fn, ...args) => {
  const result = await page('Runtime.evaluate', { expression: `(${fn.toString()})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const waitFor = async (fn, message, ...args) => {
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await evaluate(fn, ...args)) return
    await new Promise((yes) => setTimeout(yes, 25))
  }
  throw new Error(`${message}: ${JSON.stringify(await evaluate(() => document.body?.innerText))}`)
}
const frame = () => evaluate(async () => { await new Promise((yes) => requestAnimationFrame(() => requestAnimationFrame(yes))) })
const record = (name, details = {}) => { checks.push({ name, details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`) }
const click = async (selector) => {
  await evaluate((selector) => {
    const element = document.querySelector(selector)
    if (!element || element.disabled) throw new Error(`Unavailable: ${selector}`)
    element.click()
  }, selector)
  await frame()
}
const upload = async (selector, files) => {
  await evaluate((selector, files) => {
    const input = document.querySelector(selector)
    if (!input) throw new Error(`Missing input: ${selector}`)
    const transfer = new DataTransfer()
    files.forEach((file) => transfer.items.add(new File([file.text], file.name, { type: 'text/csv', lastModified: 1794690000000 })))
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector, files)
  await waitFor(() => !document.querySelector('#soft-panel [aria-busy=true]'), 'Files still reading')
}
const csv = (rows) => rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
const sales = { name: 'Synthetic-Sales.csv', text: csv([['Products and Categories', 'Quantity'], ['Stocked sleeves', 2]]) }
const baseInventory = [['Product', 'Balance'], ['Accessories >> Stocked sleeves', 6]]
const longName = `A long negative product ${'LongUnbrokenProductName'.repeat(12)}`
const negatives = Array.from({ length: 40 }, (_, index) => [`Accessories >> Negative ${String(index).padStart(2, '0')}`, -(index + 1)])
const inventory = { name: 'Synthetic-Negative-Inventory.csv', text: csv([
  ...baseInventory,
  ['Accessories >> Stocked sleeves', 4],
  ['Accessories >> Combined negative', -5], ['Deactivate >> Combined negative', 2],
  ['Accessories >> Offset zero', -2], ['Accessories >> Offset zero', 2],
  ['Accessories >> Offset positive', -2], ['Accessories >> Offset positive', 3],
  ['Hidey Hole >> Hidden category', -8], ['Accessories >> [HH] Hidden prefix', -9],
  ['Accessories >> Ordinary mixed', 2], ['Hidey Hole >> Ordinary mixed', -30],
  ['Club Memberships >> Employee', -12], ['Events >> Event ticket', -4],
  [`Accessories >> ${longName}`, -0.5], ...negatives,
]) }
const expected = [[longName, '-0.5'], ['Combined negative', '-3'], ...negatives.map(([name, balance]) => [name.split(' >> ')[1], String(balance)])]
const uploadInventory = (file) => upload('#soft-panel .upload-grid input:not([multiple])', [file])
const processReport = async () => {
  await click('#soft-panel .process-row button')
  await waitFor(() => !!document.querySelector('#soft-panel .report-card'), 'Report not ready')
}
const tableRows = () => evaluate(() => [...document.querySelectorAll('.negative-inventory-details tbody tr')].map((row) => [...row.cells].map((cell) => cell.textContent.trim())))
const disclosureState = () => evaluate(() => [...document.querySelectorAll('.processing-notices summary')].map((node) => ({ text: node.textContent.trim(), expanded: node.getAttribute('aria-expanded') })))
const screenshot = async (name) => {
  await evaluate(() => document.querySelector('.processing-notices')?.scrollIntoView({ block: 'start' })); await frame()
  const result = await page('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(output, `${name}.png`), Buffer.from(result.data, 'base64'))
}
const rectangles = () => evaluate(() => [...document.querySelectorAll('.processing-notice')].map((node) => {
  const rect = node.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }
}))

try {
  ;({ browserContextId } = await call('Target.createBrowserContext', { disposeOnDetach: true }))
  ;({ targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId }))
  ;({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }))
  await page('Page.enable'); await page('Runtime.enable'); await page('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page('Page.navigate', { url: origin })
  await waitFor(() => !!document.querySelector('#soft-panel .upload-grid input[multiple]'), 'App not loaded')
  assert.equal(await evaluate(() => document.title), 'The Restockulator')
  assert.equal(await evaluate(() => document.querySelector('h1')?.textContent), 'The Restockulator')
  record('Header and browser title use The Restockulator', await evaluate(() => ({ scripts: [...document.scripts].map((script) => script.src), styles: [...document.querySelectorAll('link[rel=stylesheet]')].map((link) => link.href) })))
  await upload('#soft-panel .upload-grid input[multiple]', [sales])
  await uploadInventory(inventory); await processReport()
  assert.deepEqual(await tableRows(), expected)
  const desktop = await rectangles()
  assert.equal(desktop.length, 2)
  assert.ok(desktop[1].x >= desktop[0].right, `Negative section not on right: ${JSON.stringify(desktop)}`)
  assert.ok(Math.abs(desktop[0].y - desktop[1].y) < 1)
  assert.ok((await disclosureState()).every((state) => state.expanded === 'false'))
  record('Combined negative inventory includes unsold items, excludes offsets and permanent exclusions, and starts collapsed on the right', { items: expected.length, desktop })
  const reportMarkup = await evaluate(() => document.querySelector('.report-card').innerHTML)
  await click('.duplicate-details summary')
  await waitFor(() => document.querySelector('.duplicate-details summary')?.getAttribute('aria-expanded') === 'true', 'Duplicates did not open')
  assert.equal(await evaluate(() => document.querySelector('.negative-inventory-details summary').getAttribute('aria-expanded')), 'false')
  await click('.negative-inventory-details summary')
  await waitFor(() => document.querySelector('.negative-inventory-details .inventory-diagnostic-list')?.getBoundingClientRect().height > 100, 'Negative list did not open')
  const scroller = await evaluate(() => {
    const node = document.querySelector('.negative-inventory-details .inventory-diagnostic-list')
    return { clientHeight: node.clientHeight, scrollHeight: node.scrollHeight, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }
  })
  assert.ok(scroller.scrollHeight > scroller.clientHeight)
  assert.ok(scroller.clientHeight <= 260)
  assert.ok(scroller.scrollWidth <= scroller.clientWidth + 1, `Long name causes horizontal overflow: ${JSON.stringify(scroller)}`)
  assert.ok((await disclosureState()).every((state) => state.expanded === 'true'))
  record('Duplicate and negative disclosures open independently; long lists scroll and long names wrap', scroller)
  await screenshot('negative-desktop')
  assert.equal(await evaluate(() => document.querySelector('.report-card').innerHTML), reportMarkup)
  await page('Emulation.setEmulatedMedia', { media: 'print' }); await frame()
  assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.processing-notices')).display), 'none')
  assert.equal(await evaluate(() => getComputedStyle(document.querySelector('.report-card')).display), 'block')
  const pdf = await page('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
  await writeFile(resolve(output, 'negative-diagnostics-excluded.pdf'), Buffer.from(pdf.data, 'base64'))
  await page('Emulation.setEmulatedMedia', { media: 'screen' }); await frame()
  record('Diagnostics stay out of print and disclosure toggles preserve printable report markup')
  for (const width of [390, 320]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false }); await frame()
    const narrow = await rectangles()
    assert.ok(narrow[1].y >= narrow[0].bottom, `Sections did not stack at ${width}: ${JSON.stringify(narrow)}`)
    assert.ok(narrow.every((rect) => rect.right <= width), `Diagnostic overflow at ${width}: ${JSON.stringify(narrow)}`)
    const overflow = await evaluate(() => {
      const list = document.querySelector('.negative-inventory-details .inventory-diagnostic-list')
      return { clientWidth: list.clientWidth, scrollWidth: list.scrollWidth }
    })
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1)
    record(`Diagnostics stack and fit ${width}px screens`, { narrow, overflow })
    await screenshot(`negative-${width}`)
  }
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await evaluate(() => document.querySelector('.negative-inventory-details summary').focus())
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await waitFor(() => document.querySelector('.negative-inventory-details summary').getAttribute('aria-expanded') === 'false', 'Native Enter failed to close')
  await waitFor(() => !document.querySelector('.negative-inventory-details').open, 'Reduced-motion disclosure did not settle closed')
  assert.equal(await evaluate(() => document.activeElement === document.querySelector('.negative-inventory-details summary')), true)
  assert.equal(await evaluate(() => document.querySelector('.duplicate-details summary').getAttribute('aria-expanded')), 'true')
  await page('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, text: ' ' })
  await page('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })
  await waitFor(() => document.querySelector('.negative-inventory-details summary').getAttribute('aria-expanded') === 'true', 'Native Space failed to open')
  record('Native Enter/Space and reduced-motion behavior retain focus and independent open state')
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await uploadInventory({ name: 'Synthetic-Only-Negative.csv', text: csv([...baseInventory, ['Accessories >> Unsold deficit', -7]]) }); await processReport()
  assert.deepEqual(await tableRows(), [['Unsold deficit', '-7']])
  assert.equal(await evaluate(() => !!document.querySelector('.duplicate-details')), false)
  assert.equal(await evaluate(() => !!document.querySelector('.processing-notices')), true)
  record('A negative-only inventory warning appears with no duplicates or sales warnings')
  await uploadInventory({ name: 'Synthetic-Positive-Inventory.csv', text: csv(baseInventory) }); await processReport()
  assert.equal(await evaluate(() => !!document.querySelector('.negative-inventory-details')), false)
  assert.equal(await evaluate(() => !!document.querySelector('.processing-notices')), false)
  record('Reprocessing positive stock clears the negative list and empty warning panel')
  await uploadInventory(inventory)
  await click('#hard-tab')
  await waitFor(() => !!document.querySelector('#hard-panel .duplicate-details'), 'Hard duplicate warning missing')
  const hardStyles = await evaluate(() => {
    const details = document.querySelector('#hard-panel .duplicate-details')
    const summary = getComputedStyle(details.querySelector('summary'))
    return { marginTop: getComputedStyle(details).marginTop, display: summary.display, fontWeight: summary.fontWeight, cursor: summary.cursor, maxHeight: getComputedStyle(details.querySelector('pre')).maxHeight }
  })
  assert.deepEqual(hardStyles, { marginTop: '9px', display: 'flex', fontWeight: '800', cursor: 'pointer', maxHeight: '260px' })
  await click('#hard-panel .duplicate-details summary')
  await waitFor(() => document.querySelector('#hard-panel .duplicate-details summary').getAttribute('aria-expanded') === 'true', 'Hard duplicates did not open')
  assert.match(await evaluate(() => document.querySelector('#hard-panel .duplicate-details pre').innerText), /Combined negative/)
  record('Hard duplicate disclosure retains its existing styling and opens normally', hardStyles)
  assert.deepEqual(blockedRequests, []); assert.deepEqual(errors, [])
  record('No external/API requests or uncaught browser errors')
} catch (error) {
  errors.push(String(error.stack || error))
  if (sessionId) { await screenshot('failure').catch(() => {}); await writeFile(resolve(output, 'failure-body.txt'), await evaluate(() => document.body.innerText).catch(() => '')) }
  throw error
} finally {
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, blockedRequests }, null, 2))
  if (browserContextId) await call('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  socket.close()
}
