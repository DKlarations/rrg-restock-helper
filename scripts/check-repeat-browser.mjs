import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Synthetic files in an isolated context; never uploads store data or opens a print dialog.
// node scripts/check-repeat-browser.mjs <browser-CDP-websocket> <local-Vite-origin>
const [endpoint, origin] = process.argv.slice(2)
assert.match(endpoint || '', /^ws:\/\/127\.0\.0\.1:/)
assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/)
const output = resolve('tmp/motion-repeat-evidence')
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
const button = async (text) => {
  await evaluate((text) => {
    const element = [...document.querySelectorAll('button')].find((node) => !node.closest('[hidden]') && node.textContent.includes(text))
    if (!element || element.disabled) throw new Error(`Unavailable button: ${text}`)
    element.click()
  }, text)
  await frame()
}
const upload = async (selector, files) => {
  await evaluate((selector, files) => {
    const input = document.querySelector(selector)
    if (!input) throw new Error(`Missing input: ${selector}`)
    const transfer = new DataTransfer()
    files.forEach((file) => transfer.items.add(new File([file.text], file.name, { type: 'text/csv', lastModified: 1794355200000 })))
    input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }))
  }, selector, files)
  await waitFor(() => !document.querySelector('#soft-panel [aria-busy=true]'), 'Files still reading')
}
const latestInput = '#soft-panel .upload-grid input[multiple]'
const inventoryInput = '#soft-panel .upload-grid input:not([multiple])'
const handledInput = 'section[aria-label="Already-handled sales"] input[multiple]'
const processReport = async () => { await click('#soft-panel .process-row button'); await waitFor(() => !!document.querySelector('#soft-panel .report-card'), 'Report not ready') }
const toggleRepeat = () => click('input[aria-label="Subtract already-handled sales"]')
const handledState = () => evaluate(() => {
  const history = document.querySelector('.repeat-history')
  const visible = (node) => !!node?.getClientRects().length && !node.closest('[hidden], [inert], [aria-hidden="true"]')
  return {
    text: history?.innerText ?? '',
    visible: visible(history),
    times: [...(history?.querySelectorAll('time') ?? [])].map((time) => ({ value: time.dateTime, text: time.textContent, visible: visible(time) })),
    first: history?.firstElementChild?.innerText ?? '',
  }
})
const mark = async () => {
  const previous = (await handledState()).times.length
  await button('Move to already handled')
  await waitFor((previous) => document.querySelectorAll('.repeat-history time').length === previous + 1, 'Move did not create a handled entry', previous)
  await waitFor(() => !document.querySelector('#soft-panel .upload-grid .upload-column:first-child .file-pill'), 'Moved sales remain in Step 1')
}
const resetCycle = async ({ withInventory = true } = {}) => {
  await button('Clear all')
  await toggleRepeat()
  if (withInventory) await upload(inventoryInput, [inventory])
}
const importHandled = async (files) => {
  const previous = (await handledState()).times.length
  await upload(handledInput, files)
  await waitFor((previous) => document.querySelectorAll('.repeat-history time').length === previous + 1, 'Uploaded handled batch did not save automatically', previous)
}
const csv = (rows) => rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
const sales = (name, sleeves, extras = []) => ({ name, text: csv([['Products and Categories', 'Quantity'], ['Black sleeves', sleeves], ...extras]) })
const inventory = { name: 'Synthetic-Inventory.csv', text: csv([['Product', 'Balance'], ['Accessories >> Black sleeves', 50], ['Accessories >> Low stock', 3], ['Accessories >> Negative stock', -2], ['Accessories >> Zero stock', 0], ['Paint >> Paint pot', 20], ['Hidey Hole >> Secret item', 50], ['Club Memberships >> Employee', 30]]) }
const rows = () => evaluate(() => [...document.querySelectorAll('#soft-panel .report-card .report-row:not(.report-table-header)')].map((row) => ({ name: row.querySelector('.report-item-name')?.textContent, pull: row.querySelector('.qty-to-pull')?.textContent, sold: row.querySelector('.qty-sold')?.textContent, stock: row.querySelector('.current-stock')?.textContent, verify: !!row.closest('.verify-section') })))
const sleeves = async () => (await rows()).find((row) => row.name === 'Black sleeves')
const screenShot = async (name) => {
  await evaluate(() => window.scrollTo(0, 0)); await frame()
  const result = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(resolve(output, `${name}.png`), Buffer.from(result.data, 'base64'))
}
const pdf = async (name) => {
  await page('Emulation.setEmulatedMedia', { media: 'print' }); await frame()
  const printable = await evaluate(() => ({ controls: document.querySelectorAll('.report-card input, .report-card button, .report-card [class*="rrg-motion"]').length,
    repeatControlsHidden: getComputedStyle(document.querySelector('.workspace-panel')).display === 'none',
    hardHidden: getComputedStyle(document.querySelector('#hard-panel')).display === 'none',
    header: document.querySelector('.print-report-header')?.textContent,
    sources: document.querySelector('.repeat-print-sources')?.textContent,
    errors: document.querySelector('.repeat-print-errors')?.textContent,
  }))
  assert.equal(printable.controls, 0); assert.equal(printable.repeatControlsHidden, true); assert.equal(printable.hardHidden, true)
  const result = await page('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
  await writeFile(resolve(output, `${name}.pdf`), Buffer.from(result.data, 'base64'))
  await page('Emulation.setEmulatedMedia', { media: 'screen' })
  record(`${name} print capture`, printable)
}

try {
  ;({ browserContextId } = await call('Target.createBrowserContext', { disposeOnDetach: true }))
  ;({ targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId }))
  ;({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }))
  await page('Page.enable'); await page('Runtime.enable'); await page('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `window.__repeatQa = { prints: 0 }; window.print = () => { window.__repeatQa.prints++; window.dispatchEvent(new Event('beforeprint')); };` })
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page('Page.navigate', { url: origin })
  await waitFor(() => !!document.querySelector('input[aria-label="Subtract already-handled sales"]'), 'App not loaded')
  assert.equal(await evaluate(() => document.querySelector('input[aria-label="Subtract already-handled sales"]').checked), false)
  await upload(latestInput, [sales('day-one.csv', 10), sales('day-two.csv', 7)])
  await upload(inventoryInput, [inventory]); await processReport()
  assert.equal((await sleeves()).pull, '17'); assert.equal((await sleeves()).sold, '17')
  assert.equal(await evaluate(() => !!document.querySelector('.repeat-print-sources')), false)
  const ordinaryReportMarkup = await evaluate(() => document.querySelector('.report-card').innerHTML)
  record('Ordinary Soft remains additive and subtraction is off initially', await sleeves())
  await pdf('ordinary-soft')
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false })
  await frame()
  const ordinaryNarrowWidth = await evaluate(() => document.documentElement.scrollWidth)
  record('Ordinary narrow baseline width', { ordinaryNarrowWidth })
  await screenShot('ordinary-soft-narrow')
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

  await resetCycle()
  assert.equal(await evaluate(() => [...document.querySelectorAll('#soft-panel button')].some((node) => /Start new restock cycle|Use this run as already handled|Use uploaded reports as handled/.test(node.textContent))), false)
  assert.equal(await evaluate(() => document.querySelector('.repeat-move-button')?.closest('.upload-column') === document.querySelector('#soft-panel .upload-grid .upload-column')), true)
  await upload(latestInput, [sales('run-one.csv', 10)]); await processReport()
  assert.equal((await sleeves()).pull, '10'); await mark()
  assert.equal(await evaluate(() => document.querySelectorAll('#soft-panel .upload-grid .file-pill').length), 1)
  const firstHandled = await handledState()
  assert.equal(firstHandled.visible, true)
  assert.match(firstHandled.text, /run-one.csv/)
  assert.match(firstHandled.text, /Handled/)
  assert.equal(firstHandled.times.length, 1)
  assert.ok(firstHandled.times.every((time) => time.visible && Number.isFinite(Date.parse(time.value))))
  record('Moving Step 1 files visibly places filenames and handled dates in Step 3', firstHandled)
  await upload(latestInput, [sales('run-two.csv', 15)]); await processReport()
  assert.equal((await sleeves()).pull, '5'); assert.equal((await sleeves()).sold, '5')
  await button('Print Restock List'); await waitFor(() => window.__repeatQa.prints === 1, 'Print stub not invoked')
  assert.deepEqual(await handledState(), firstHandled)
  assert.equal((await sleeves()).pull, '5'); await mark()
  const secondHandled = await handledState()
  assert.equal(secondHandled.times.length, 2)
  assert.ok(secondHandled.times.every((time) => time.visible))
  assert.match(secondHandled.first, /run-two.csv/)
  assert.match(secondHandled.first, /Current comparison/)
  assert.match(secondHandled.text, /run-one.csv/)
  await upload(latestInput, [sales('run-three.csv', 17)]); await processReport()
  assert.equal((await sleeves()).pull, '2'); assert.equal((await sleeves()).sold, '2')
  assert.match(await evaluate(() => document.querySelector('.repeat-print-sources').textContent), /run-two.csv/)
  record('10 → 15 → 17 yields 10, 5, 2 and printing never advances handling', await sleeves())
  await screenShot('repeat-desktop'); await pdf('additional-restock')

  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false })
  await new Promise((yes) => setTimeout(yes, 400))
  await frame()
  const narrow = await evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
    option: document.querySelector('.repeat-option').getBoundingClientRect().width,
    controls: [...document.querySelectorAll('.repeat-option button, .repeat-move-button')].filter((node) => !node.closest('[hidden]')).map((node) => ({ text: node.textContent.trim(), right: node.getBoundingClientRect().right })) }))
  assert.ok(narrow.document <= ordinaryNarrowWidth + 1, `Repeat mode added narrow overflow: ${JSON.stringify({ ...narrow, ordinaryNarrowWidth })}`)
  assert.ok(narrow.controls.every((control) => control.right <= narrow.width), `Repeat controls exceed viewport: ${JSON.stringify(narrow)}`)
  record('Narrow repeat controls fit without adding to existing masthead overflow', { ...narrow, ordinaryNarrowWidth })
  await screenShot('repeat-narrow')
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await evaluate(() => { document.querySelector('section[aria-label="Already-handled sales"] .drop-zone').focus(); document.querySelector('input[aria-label="Subtract already-handled sales"]').click() })
  await waitFor(() => document.activeElement?.getAttribute('aria-label') === 'Subtract already-handled sales', 'Closing repeat controls failed to restore focus')
  await processReport(); assert.equal((await sleeves()).pull, '17')
  assert.equal(await evaluate(() => document.querySelector('.report-card').innerHTML), ordinaryReportMarkup)
  record('Disabling repeat restores focus and ordinary cumulative output under reduced motion', await sleeves())
  await toggleRepeat(); await processReport(); assert.equal((await sleeves()).pull, '2')
  await click('#hard-tab'); await waitFor(() => !!document.querySelector('#hard-panel .hard-category-tree'), 'Hard category tree did not load')
  assert.equal(await evaluate(() => document.querySelector('#soft-panel').hidden), true)
  await button('Select all categories'); await waitFor(() => !!document.querySelector('.hard-report-card'), 'Hard report missing')
  await click('#soft-tab'); assert.equal((await sleeves()).pull, '2')
  record('Hard uses shared inventory and preserves the pending Soft repeat result')

  await resetCycle()
  await upload(latestInput, [sales('unprocessed-six.csv', 6)])
  assert.equal(await evaluate(() => !!document.querySelector('.report-card')), false)
  await mark()
  await waitFor(() => document.activeElement === document.querySelector('#soft-panel .upload-grid .upload-column:first-child .drop-zone'), 'Move failed to return focus to Step 1 upload')
  assert.match((await handledState()).text, /unprocessed-six.csv/)
  await upload(latestInput, [sales('after-unprocessed-ten.csv', 10)]); await processReport()
  assert.equal((await sleeves()).pull, '4')
  record('Move validates unprocessed files and returns keyboard focus to Step 1 under reduced motion', await handledState())

  await resetCycle()
  await upload(latestInput, [sales('new-day-one.csv', 10), sales('new-day-two.csv', 7)])
  await importHandled([sales('handled-day-one.csv', 10), sales('handled-day-two.csv', 5)])
  await processReport(); assert.equal((await sleeves()).pull, '2')
  const imported = await handledState()
  assert.equal(imported.times.length, 1)
  assert.match(imported.text, /handled-day-one.csv/)
  assert.match(imported.text, /handled-day-two.csv/)
  assert.match(imported.text, /Added/)
  record('Step 3 uploads save automatically as one grouped run while Step 1 files stay put', imported)

  await importHandled([sales('handled-sixteen.csv', 16)])
  await processReport(); assert.equal((await sleeves()).pull, '1')
  record('Later handled uploads become the current comparison without adding overlapping runs', await handledState())

  await upload(handledInput, [{ name: 'broken-handled.csv', text: 'Wrong,Columns\nBad,3' }])
  await waitFor(() => [...document.querySelectorAll('#soft-panel [role=alert]')].some((node) => node.getClientRects().length && /broken-handled.csv|missing|required|column|header/i.test(node.textContent)), 'Malformed handled import did not show an error')
  assert.equal((await handledState()).times.length, 2)
  assert.ok(await evaluate(() => [...document.querySelectorAll('section[aria-label="Already-handled sales"] .file-pill')].some((node) => node.textContent.includes('broken-handled.csv'))))
  await click('section[aria-label="Already-handled sales"] button[aria-label="Remove broken-handled.csv"]')
  await processReport(); assert.equal((await sleeves()).pull, '1')
  record('Malformed handled imports keep their filename and error visible without replacing the baseline')

  await resetCycle({ withInventory: false })
  await upload(handledInput, [sales('waiting-for-inventory.csv', 10)])
  assert.equal((await handledState()).times.length, 0)
  assert.ok(await evaluate(() => document.querySelector('section[aria-label="Already-handled sales"]').innerText.includes('waiting-for-inventory.csv')))
  await upload(inventoryInput, [inventory])
  await waitFor(() => document.querySelectorAll('.repeat-history time').length === 1, 'Pending import did not save when inventory arrived')
  await upload(latestInput, [sales('after-pending-fifteen.csv', 15)]); await processReport()
  assert.equal((await sleeves()).pull, '5')
  record('Handled uploads can wait visibly for inventory and save automatically when it arrives')

  await resetCycle(); await importHandled([sales('handled-ten.csv', 10)])
  await upload(latestInput, [sales('decreased-eight.csv', 8, [['Low stock', 5], ['Negative stock', 5], ['Zero stock', 4], ['Missing item', 2], ['Secret item', 4], ['Employee', 2]])]); await processReport()
  assert.equal(await sleeves(), undefined)
  const issues = await rows()
  assert.deepEqual(issues.find((row) => row.name === 'Low stock'), { name: 'Low stock', pull: '3', sold: '5', stock: '3', verify: false })
  assert.deepEqual(issues.find((row) => row.name === 'Negative stock'), { name: 'Negative stock', pull: '0', sold: '5', stock: '-2', verify: true })
  assert.ok(issues.some((row) => row.name === 'Zero stock' && row.verify && row.pull === '0'))
  assert.ok(issues.some((row) => row.name === 'Missing item' && row.verify && row.pull === '0'))
  assert.equal(issues.some((row) => ['Secret item', 'Employee'].includes(row.name)), false)
  assert.match(await evaluate(() => document.querySelector('.repeat-errors').textContent), /Black sleeves/)
  await pdf('repeat-sales-errors')
  record('Negative sales error stays visible while caps, Verify Stock and exclusions stay intact', issues)
  await evaluate(() => {
    const summary = document.querySelector('#soft-panel .settings-panel summary')
    if (summary.getAttribute('aria-expanded') !== 'true') summary.click()
  })
  await frame()
  const split = async () => {
    await evaluate(() => {
      const input = [...document.querySelectorAll('#soft-panel input[type=checkbox]')].find((node) => [...node.labels].some((label) => label.textContent.includes('Split restock list')))
      input.click()
    })
    await frame()
  }
  await split()
  const packets = await evaluate(() => [...document.querySelectorAll('#soft-panel .split-report-part')].map((part) => ({
    heading: part.querySelector('.split-part-heading')?.textContent,
    sources: part.querySelector('.repeat-print-sources')?.textContent,
  })))
  assert.equal(packets.length, 2)
  assert.ok(packets.every((part) => part.heading.includes('ADDITIONAL RESTOCK PART')))
  assert.match(packets[1].sources, /Generated:/)
  assert.match(packets[1].sources, /decreased-eight.csv/)
  assert.match(packets[1].sources, /handled-ten.csv/)
  assert.deepEqual((await rows()).sort((left, right) => left.name.localeCompare(right.name)), [...issues].sort((left, right) => left.name.localeCompare(right.name)))
  await pdf('additional-restock-split-two')
  record('Split additional-restock packets preserve rows and repeat run, time and source context', packets)
  await split()
  await mark(); await upload(latestInput, [sales('rebound-ten.csv', 10, [['Low stock', 5], ['Negative stock', 5], ['Zero stock', 4], ['Missing item', 2]])]); await processReport()
  assert.equal((await rows()).length, 0)
  assert.match(await evaluate(() => document.querySelector('.empty-report').textContent), /No additional sales/)
  record('Handled quantities never decrease after an error, preventing false rebound pulls')

  await page('Page.reload'); await waitFor(() => !!document.querySelector('input[aria-label="Subtract already-handled sales"]'), 'App failed to reload')
  assert.equal(await evaluate(() => document.querySelector('input[aria-label="Subtract already-handled sales"]').checked), false)
  assert.equal(await evaluate(() => document.querySelectorAll('.file-pill').length), 0)
  assert.equal(await evaluate(() => document.querySelectorAll('.report-card, .repeat-history').length), 0)
  record('Reload clears the cycle, files and history and starts on ordinary Soft')
  assert.deepEqual(blockedRequests, []); assert.deepEqual(errors, [])
  record('No external/API requests or uncaught browser errors')
} catch (error) {
  errors.push(String(error.stack || error))
  if (sessionId) { await screenShot('failure').catch(() => {}); await writeFile(resolve(output, 'failure-body.txt'), await evaluate(() => document.body.innerText).catch(() => '')) }
  throw error
} finally {
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, blockedRequests }, null, 2))
  if (browserContextId) await call('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  socket.close()
}
