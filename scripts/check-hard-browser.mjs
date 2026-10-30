import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Synthetic inventory only. A disposable browser context keeps user storage intact.
// node scripts/check-hard-browser.mjs <browser-CDP-websocket> <local-Vite-origin>
// Browser printing is stubbed; PDFs use CDP directly and never open a print dialog.
const [endpoint, origin] = process.argv.slice(2)
assert.match(endpoint || '', /^ws:\/\/127\.0\.0\.1:/)
assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/)
const output = resolve('tmp/hard-restock-evidence')
await mkdir(output, { recursive: true })
const checks = [], errors = [], blockedRequests = []
const socket = new WebSocket(endpoint)
await new Promise((yes, no) => {
  socket.addEventListener('open', yes, { once: true })
  socket.addEventListener('error', no, { once: true })
})
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
    clearTimeout(request.timer)
    pending.delete(message.id)
    if (message.error) request.no(new Error(JSON.stringify(message.error)))
    else request.yes(message.result)
  } else if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params
    const url = new URL(request.url)
    const allowed = url.origin === origin && request.method === 'GET' && !/^\/api(?:\/|$)/.test(url.pathname)
    if (!allowed) blockedRequests.push({ method: request.method, url: request.url })
    call(allowed ? 'Fetch.continueRequest' : 'Fetch.fulfillRequest', allowed ? { requestId } : {
      requestId, responseCode: 503, body: '',
    }, message.sessionId).catch((error) => errors.push(String(error)))
  } else if (message.method === 'Runtime.exceptionThrown') {
    errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
  }
})
const page = (method, params = {}) => call(method, params, sessionId)
const evaluate = async (fn, ...args) => {
  const result = await page('Runtime.evaluate', {
    expression: `(${fn.toString()})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
const waitFor = async (fn, message, ...args) => {
  for (let index = 0; index < 600; index++) {
    try { if (await evaluate(fn, ...args)) return } catch (error) {
      if (!/context|navigat|Cannot find/.test(String(error))) throw error
    }
    await new Promise((yes) => setTimeout(yes, 25))
  }
  throw new Error(`${message}: ${JSON.stringify(await evaluate(() => document.body?.innerText))}`)
}
const record = (name, details) => {
  checks.push({ name, details })
  console.log(`PASS ${name}: ${JSON.stringify(details)}`)
}
const frame = () => evaluate(async () => {
  await new Promise((yes) => requestAnimationFrame(() => requestAnimationFrame(yes)))
})
const button = async (name) => {
  await evaluate((name) => {
    const button = [...document.querySelectorAll('button')].find((element) =>
      !element.closest('[hidden]') && element.textContent.trim() === name)
    if (!button || button.disabled) throw new Error(`Button unavailable: ${name}`)
    button.click()
  }, name)
  await frame()
}
const control = async (label, value) => {
  await evaluate((label, value) => window.__hardQa.setControl(label, value), label, value)
  await frame()
}
const tab = async (name) => {
  await evaluate((name) => {
    const element = [...document.querySelectorAll('[role=tab]')].find((element) =>
      (element.querySelector('strong')?.textContent.trim() || element.textContent.trim()).toLocaleLowerCase() === name.toLocaleLowerCase())
    if (!element) throw new Error(`Missing tab: ${name}`)
    element.click()
  }, name)
  await frame()
}
const rows = () => evaluate(() => [...document.querySelectorAll('.hard-report-card .hard-row[data-key]')].map((row) => ({
  key: row.dataset.key,
  name: row.querySelector('.hard-item-name')?.getAttribute('title') || row.querySelector('.hard-item-name')?.textContent.trim(),
  stock: row.querySelector('.hard-current-stock')?.textContent.trim(),
})))
const names = async () => (await rows()).map((row) => row.name).sort()
const assertNames = async (expected, message) => {
  await frame()
  assert.deepEqual(await names(), expected.map((row) => row.name).sort(), message)
}
const csv = (rows) => rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
const longName = 'Synthetic Gundam Heroes - Wukong Impulse and Sanzang Strike Freedom Model Set With Distinctive Final Printing Identifier ABC12'
assert.equal(longName.length, 126)
const fixture = [
  { path: ['Board Games', '1'], name: '101 Synthetic Board Game', stock: 5 },
  { path: ['Board Games', 'A'], name: 'Alpha Synthetic Game', stock: 6 },
  { path: ['Board Games', 'A'], name: 'Alpha Zero Game', stock: 0 },
  { path: ['Board Games', 'A'], name: 'Alpha Negative Game', stock: -2 },
  { path: ['Board Games', 'A'], name: longName, stock: 4 },
  { path: ['Board Games', 'G'], name: 'Gamma Synthetic Game', stock: 7 },
  { path: ['Bandai Hobby', 'Gundam'], name: 'Bandai Synthetic Model', stock: 5 },
  { path: ['Bandai Hobby', 'Gundam', 'High Grade'], name: 'Bandai Nested Synthetic Model', stock: 3 },
  { path: ['Miniatures', 'Warhammer 40K', 'Imperium'], name: '40K Synthetic Unit', stock: 9 },
  { path: ['Board Games', 'A'], name: 'Duplicate Synthetic Product', stock: 2 },
  { path: ['Board Games', 'A'], name: 'Duplicate Synthetic Product', stock: 3 },
  { path: ['Board Games', 'G'], name: 'Duplicate Synthetic Product', stock: 4 },
  { path: ['Paint', 'AK Interactive'], name: 'Synthetic Paint Marker', stock: 8, excluded: 'paint' },
  { path: ['Miniatures', 'Painting Accessories'], name: 'Synthetic Painting Brush', stock: 8 },
  { path: ['Dice', 'Polyhedral'], name: 'Synthetic Dice Set', stock: 8, excluded: 'dice' },
  { path: ['Accessories', 'Dice Accessories'], name: 'Synthetic Dice Tray', stock: 8 },
  { path: ['Miniatures', 'D&D Minis'], name: 'Synthetic Small Character Pack', stock: 5 },
  { path: ['Deactivate'], name: 'Synthetic Retired Game', stock: 6, excluded: 'deactivate' },
  { path: ['Z Online Sales'], name: 'Synthetic Online Game', stock: 7, excluded: 'online' },
  { path: ['Z Online Sales', '1_Hidey Hole'], name: '[HH] Synthetic Hidden Game', stock: 90, permanent: true },
  { path: ['Other'], name: '[HH] Synthetic Hidden Prefix', stock: 91, permanent: true },
  { path: ['Events'], name: 'Synthetic Event Ticket', stock: 8, permanent: true },
  { path: ['Club Memberships'], name: 'Employee', stock: 8, permanent: true },
  ...Array.from({ length: 36 }, (_, index) => ({
    path: ['Board Games', index < 18 ? 'A' : 'G'],
    name: `Synthetic Packet Game ${String(index + 1).padStart(2, '0')}`, stock: index % 6 + 1,
  })),
]
const inventory = {
  name: 'Synthetic-Hard-InventoryReport.csv',
  text: csv([['Product', 'Balance'], ...fixture.map((row) => [[...row.path, row.name].join(' >>'), row.stock])]),
}
const defaultRows = fixture.filter((row) => !row.permanent && !row.excluded)
const inPath = (row, path) => path.every((part, index) => row.path[index] === part)
const selectAll = () => button('Select all categories')
const clearSelection = () => button('Clear category selection')
const search = (value) => control('Search categories', value)
const selectCategory = async (path, checked = true) => {
  await search(path[0])
  await control(path.join(' › '), checked)
}
const settings = async () => {
  await evaluate(() => {
    const summary = [...document.querySelectorAll('#hard-panel summary')].find((element) => element.textContent.includes('Hard Report & Print Settings'))
    if (!summary) throw new Error('Hard settings disclosure missing')
    if (!summary.closest('details').open) summary.click()
  })
  await frame()
}
const screenshot = async (name) => {
  await evaluate(() => window.scrollTo(0, 0))
  await frame()
  const capture = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(resolve(output, `${name}.png`), Buffer.from(capture.data, 'base64'))
}
const media = (value) => page('Emulation.setEmulatedMedia', { media: value })
const capturePdf = async (name, expectedSplitPackets = 0) => {
  const priorPrints = await evaluate(() => window.__hardQa.prints)
  await button('Print Hard Checklist')
  await waitFor((priorPrints) => window.__hardQa.prints > priorPrints, 'Print handler did not invoke its stub', priorPrints)
  await media('print')
  const printable = await evaluate(() => ({
    softHidden: getComputedStyle(document.querySelector('#soft-panel')).display === 'none',
    hardVisible: getComputedStyle(document.querySelector('#hard-panel')).display !== 'none',
    interactiveReportControls: document.querySelectorAll('.hard-report-card input, .hard-report-card button, .hard-report-card textarea, .hard-report-card [class*="rrg-motion"]').length,
    negativeCheckbox: /inventory is negative/i.test(document.querySelector('.hard-report-card').textContent),
    footer: document.querySelector('.hard-print-footer')?.textContent.trim(),
    staffField: /Staff\s*:/i.test(document.querySelector('.hard-report-card').textContent),
    locationExplanation: /Upstairs\s*=|Sales Floor|Downstairs|Backstock\s*=\s*storage/i.test(document.querySelector('.hard-report-card').textContent),
    locationSubtitles: document.querySelectorAll('.hard-report-card .hard-table-header small').length,
    rows: document.querySelectorAll('.hard-report-card .hard-row[data-key]').length,
    paperMarks: document.querySelectorAll('.hard-report-card .hard-paper-checkbox').length,
    amountLines: document.querySelectorAll('.hard-report-card .hard-write-line').length,
    packetCount: document.querySelectorAll('.hard-report-card .hard-packet').length,
    packetHeadings: [...document.querySelectorAll('.hard-report-card .hard-packet-heading')].map((element) => element.textContent.trim()),
    firstHeaderGap: document.querySelector('.hard-report-card .hard-table-header').getBoundingClientRect().top
      - document.querySelector('.hard-report-card .hard-report-summary').getBoundingClientRect().bottom,
  }))
  assert.equal(printable.softHidden, true)
  assert.equal(printable.hardVisible, true)
  assert.equal(printable.interactiveReportControls, 0)
  assert.equal(printable.negativeCheckbox, false)
  assert.equal(printable.footer, `Generated with ${inventory.name}`)
  assert.equal(printable.staffField, false)
  assert.equal(printable.locationExplanation, false)
  assert.equal(printable.locationSubtitles, 0)
  assert.equal(printable.paperMarks, printable.rows * 3)
  assert.equal(printable.amountLines, printable.rows * 2)
  assert.equal(printable.packetCount, expectedSplitPackets || 1)
  if (expectedSplitPackets) {
    assert.deepEqual(printable.packetHeadings, Array.from({ length: expectedSplitPackets }, (_, index) => `PACKET ${index + 1} OF ${expectedSplitPackets}`))
  } else {
    assert.deepEqual(printable.packetHeadings, [])
    assert.ok(Math.abs(printable.firstHeaderGap) <= 1, `An empty heading gap remains before the unsplit table: ${printable.firstHeaderGap}px`)
  }
  const pdf = await page('Page.printToPDF', { printBackground: true, preferCSSPageSize: true })
  const bytes = Buffer.from(pdf.data, 'base64')
  const pageSizes = [...bytes.toString('latin1').matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)]
    .map((match) => match.slice(1).map(Number))
  assert.ok(pageSizes.length > 0, 'PDF page dimensions were not found')
  assert.ok(pageSizes.every(([left, top, right, bottom]) => Math.abs(right - left - 612) < 1 && Math.abs(bottom - top - 792) < 1), `PDF is not US Letter portrait: ${JSON.stringify(pageSizes)}`)
  await writeFile(resolve(output, `${name}.pdf`), bytes)
  await media('screen')
  record(`${name} PDF uses Letter portrait, Hard's paper marks, and hides Soft`, { ...printable, pageSizes })
}

try {
  // Refuse to fall back to the user's existing context if isolation is unavailable.
  ;({ browserContextId } = await call('Target.createBrowserContext', { disposeOnDetach: true }))
  ;({ targetId } = await call('Target.createTarget', { url: 'about:blank', browserContextId }))
  ;({ sessionId } = await call('Target.attachToTarget', { targetId, flatten: true }))
  await page('Page.enable')
  await page('Runtime.enable')
  await page('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await page('Page.addScriptToEvaluateOnNewDocument', { source: `(${function installHardQa(expectedOrigin) {
    if (location.origin !== expectedOrigin) return
    const state = window.__hardQa = { prints: 0, forbidden: [] }
    window.print = () => { state.prints++; window.dispatchEvent(new Event('beforeprint')) }
    window.fetch = (...args) => { state.forbidden.push(`fetch ${String(args[0])}`); return Promise.reject(new Error('Synthetic QA forbids API requests')) }
    window.XMLHttpRequest = class { open() { state.forbidden.push('XHR'); throw new Error('Synthetic QA forbids XHR') } }
    navigator.sendBeacon = () => { state.forbidden.push('beacon'); return false }
    state.setControl = (label, value) => {
      const element = [...document.querySelectorAll('#hard-panel input, #hard-panel select, #hard-panel textarea')].find((element) =>
        element.getAttribute('aria-label') === label || [...(element.labels || [])].some((candidate) => candidate.textContent.replace(/\s+/g, ' ').trim().startsWith(label)))
      if (!element) throw new Error(`Missing control: ${label}`)
      if (element.type === 'checkbox') { if (element.checked !== value) element.click(); return }
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }
    state.upload = (selector, file) => {
      const input = document.querySelector(selector)
      if (!input) throw new Error(`Missing file input: ${selector}`)
      const transfer = new DataTransfer()
      transfer.items.add(new File([file.text], file.name, { type: 'text/csv', lastModified: 1793404800000 }))
      input.files = transfer.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }.toString()})(${JSON.stringify(origin)})` })
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await page('Page.navigate', { url: origin })
  await waitFor(() => Boolean(document.querySelector('[role=tab]') && window.__hardQa), 'App did not load')
  const initial = await evaluate(() => ({
    selected: document.querySelector('[role=tab][aria-selected=true] strong')?.textContent.trim()
      || document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim(),
    softVisible: !document.querySelector('#soft-panel').hidden,
    hardHidden: document.querySelector('#hard-panel').hidden,
  }))
  assert.deepEqual(initial, { selected: 'SOFT', softVisible: true, hardHidden: true })
  record('Soft is the default tab with only its panel active', initial)
  const tabLayout = await evaluate(() => [...document.querySelectorAll('.mode-switcher [role=tab]')].map((element) => {
    const label = element.querySelector('strong') || element
    const range = document.createRange(); range.selectNodeContents(label)
    const text = range.getBoundingClientRect(), box = element.getBoundingClientRect()
    return { text: element.textContent.trim(), centerOffsetX: Math.abs((text.left + text.right - box.left - box.right) / 2),
      centerOffsetY: Math.abs((text.top + text.bottom - box.top - box.bottom) / 2) }
  }))
  assert.deepEqual(tabLayout.map((entry) => entry.text), ['SOFT', 'HARD'])
  assert.ok(tabLayout.every((entry) => entry.centerOffsetX <= 2 && entry.centerOffsetY <= 3), `Tab labels are not centered: ${JSON.stringify(tabLayout)}`)
  record('Tabs contain only centered uppercase SOFT and HARD labels', tabLayout)
  await tab('Hard')
  assert.equal((await rows()).length, 0)
  await tab('Soft')
  await evaluate((inventory) => window.__hardQa.upload('#soft-panel input[type=file]:not([multiple])', inventory), inventory)
  await waitFor(() => Boolean(document.querySelector('#soft-panel .file-pill')), 'Shared inventory input did not load')
  assert.equal(await evaluate(() => document.querySelector('#soft-panel .process-row button').disabled), true)
  await tab('Hard')
  await waitFor(() => Boolean(document.querySelector('.hard-category-tree input[type=checkbox]')), 'Hard inventory-only processing did not populate categories')
  assert.equal((await rows()).length, 0)
  record('Hard reuses Soft inventory without a sales report and waits for category selection', { salesFiles: 0, selectedRows: 0 })
  const cleanup = await evaluate(() => {
    const panel = document.querySelector('#hard-panel')
    const filters = panel.querySelector('.hard-stock-filters')
    const categoryHeights = [...panel.querySelectorAll('.hard-category-line')].map((element) => element.getBoundingClientRect().height).filter((height) => height > 0)
    return {
      uploadTitle: panel.querySelector('.workspace-panel .panel-title-row h2')?.textContent.trim(),
      intakeHelpPresent: Boolean(panel.querySelector('.hard-intake-help')),
      broadPreciseHeadingPresent: /Work as broadly or as precisely as you need/i.test(panel.innerText),
      uncertainUpstreamPresent: /uncertain upstream/i.test(panel.innerText),
      filterSubtitles: filters.querySelectorAll('small').length,
      filterEligibilityParagraphs: filters.querySelectorAll('.hard-help').length,
      categoryHeights,
    }
  })
  assert.match(cleanup.uploadTitle, /^File\s*Upload$/)
  assert.equal(cleanup.intakeHelpPresent, false)
  assert.equal(cleanup.broadPreciseHeadingPresent, false)
  assert.equal(cleanup.uncertainUpstreamPresent, false)
  assert.equal(cleanup.filterSubtitles, 0)
  assert.equal(cleanup.filterEligibilityParagraphs, 0)
  assert.ok(cleanup.categoryHeights.length > 5 && cleanup.categoryHeights.every((height) => height <= 28), `Category rows are not compact: ${JSON.stringify(cleanup.categoryHeights)}`)
  record('Hard copy cleanup and compact category geometry are present', cleanup)

  await selectCategory(['Board Games', 'A'])
  await assertNames(defaultRows.filter((row) => inPath(row, ['Board Games', 'A'])), 'Leaf category selection includes exactly its raw inventory rows')
  const partial = await evaluate(() => {
    const parent = document.querySelector('.hard-category-tree input[aria-label="Board Games"]')
    return { checked: parent.checked, indeterminate: parent.indeterminate }
  })
  assert.deepEqual(partial, { checked: false, indeterminate: true })
  await selectCategory(['Board Games'])
  await assertNames(defaultRows.filter((row) => inPath(row, ['Board Games'])), 'Parent category includes 1, A and G descendants')
  record('Raw Board Games filing categories and parent indeterminate/union behavior work', partial)
  await clearSelection()
  await selectCategory(['Bandai Hobby'])
  await assertNames(defaultRows.filter((row) => inPath(row, ['Bandai Hobby'])), 'Bandai parent includes nested High Grade')
  await clearSelection()
  await search('40K')
  await control('Miniatures › Warhammer 40K', true)
  await assertNames(defaultRows.filter((row) => inPath(row, ['Miniatures', 'Warhammer 40K'])), 'Search exposes matching category and child products')
  record('Nested category selection and category search work', { bandai: 2, warhammer: 1 })

  await search('')
  await selectAll()
  await assertNames(defaultRows, 'Default Hard checklist includes all eligible positive, zero and negative rows')
  const duplicateRows = (await rows()).filter((row) => row.name === 'Duplicate Synthetic Product')
  assert.equal(duplicateRows.length, 3)
  assert.equal(new Set(duplicateRows.map((row) => row.key)).size, 3)
  assert.deepEqual(duplicateRows.map((row) => Number(row.stock)).sort(), [2, 3, 4])
  record('Duplicate product names remain three distinct raw rows and balances', duplicateRows)
  assert.equal((await names()).includes('Synthetic Painting Brush'), true)
  assert.equal((await names()).includes('Synthetic Dice Tray'), true)
  assert.equal((await names()).includes('Synthetic Small Character Pack'), true)
  await settings()
  for (const [label, exclusion] of [
    ['Exclude paint and paint markers', 'paint'], ['Exclude dice', 'dice'],
    ['Exclude Deactivate', 'deactivate'], ['Exclude Z Online Sales', 'online'],
  ]) {
    await control(label, false)
    await assertNames(fixture.filter((row) => !row.permanent && (!row.excluded || row.excluded === exclusion)), `${label} can be disabled`)
    await control(label, true)
  }
  await assertNames(defaultRows)
  record('Default exclusions are reversible while accessories, minis and permanent protections stay correct', { toggleGroups: 4 })
  await control('Include zero-stock items', false)
  await assertNames(defaultRows.filter((row) => row.stock !== 0))
  assert.equal((await names()).includes('Alpha Negative Game'), true)
  await control('Negative stock only', true)
  await assertNames(defaultRows.filter((row) => row.stock < 0))
  await control('Negative stock only', false)
  await control('Include zero-stock items', true)
  record('Zero stock toggle and negative-only filtering are independent', { negativeStock: -2 })

  await settings()
  await control('Hard ignore list', 'Alpha Synthetic Game')
  await assertNames(defaultRows.filter((row) => row.name !== 'Alpha Synthetic Game'))
  await tab('Soft')
  await tab('Hard')
  await assertNames(defaultRows.filter((row) => row.name !== 'Alpha Synthetic Game'))
  await control('Hard ignore list', '')
  await assertNames(defaultRows)
  record('Hard draft/settings and selection survive tab switches', { selectedRows: defaultRows.length })

  for (const size of [9, 14]) {
    await control('Hard print text size', size)
    await evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await media('print')
    await frame()
    const fit = await evaluate(() => [...document.querySelectorAll('.hard-report-card .hard-row[data-key]')].map((row) => {
      const element = row.querySelector('.hard-item-name')
      const range = document.createRange(); range.selectNodeContents(element)
      const rect = element.getBoundingClientRect(), textRect = range.getBoundingClientRect(), style = getComputedStyle(element)
      return { name: element.textContent.trim(), cellWidth: rect.width, textWidth: textRect.width,
        rectCount: range.getClientRects().length, whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow, fontSize: getComputedStyle(element.querySelector('.hard-item-label') || element).fontSize,
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }
    }))
    assert.equal(fit.length, defaultRows.length)
    assert.ok(fit.every((row) => row.textWidth <= row.cellWidth + 1 && row.scrollWidth <= row.clientWidth + 1), `Names overflow at ${size}pt: ${JSON.stringify(fit.filter((row) => row.textWidth > row.cellWidth + 1))}`)
    assert.ok(fit.every((row) => row.whiteSpace === 'nowrap' && row.textOverflow !== 'ellipsis'))
    assert.equal(fit.find((row) => row.name === longName)?.name, longName)
    const width = await evaluate(() => document.querySelector('.hard-report-card').getBoundingClientRect().width)
    assert.ok(Math.abs(width - 7.7 * 96) < 2, `Hard portrait paper width differs: ${width}`)
    await writeFile(resolve(output, `name-fit-${size}pt.json`), JSON.stringify(fit, null, 2))
    await media('screen')
    record(`Portrait full-name single-line fit at ${size}pt`, { items: fit.length, reportWidthPx: width, longest: fit.find((row) => row.name === longName) })
  }
  await control('Hard print text size', 9)
  await capturePdf('hard-portrait')
  const beforeSplitKeys = (await rows()).map((row) => row.key).sort()
  await control('Split hard checklist', true)
  await control('Divide hard checklist into', '3')
  const afterSplit = await rows()
  assert.deepEqual(afterSplit.map((row) => row.key).sort(), beforeSplitKeys)
  assert.equal(new Set(afterSplit.map((row) => row.key)).size, beforeSplitKeys.length)
  assert.equal(await evaluate(() => document.querySelectorAll('.hard-report-card .hard-packet-split').length), 3)
  await capturePdf('hard-portrait-split-three', 3)
  record('Split packets retain each raw row exactly once', { rows: afterSplit.length, requestedParts: 3 })

  await control('Split hard checklist', false)
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await screenshot('hard-desktop')
  await page('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: false })
  await screenshot('hard-narrow')
  const narrow = await evaluate(() => ({ viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
    reportWidth: document.querySelector('.hard-report-card').getBoundingClientRect().width }))
  record('Desktop and narrow screenshots captured; narrow report remains scrollable', narrow)
  await page('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await control('Include zero-stock items', false)
  await control('Exclude dice', false)
  await settings()
  await control('Hard ignore list', 'Saved synthetic draft')
  await page('Page.reload')
  await waitFor(() => Boolean(window.__hardQa && document.querySelector('[role=tab][aria-selected=true]')), 'App did not reload')
  assert.equal(await evaluate(() => {
    const selected = document.querySelector('[role=tab][aria-selected=true]')
    return selected.querySelector('strong')?.textContent.trim() || selected.textContent.trim()
  }), 'SOFT')
  await tab('Hard')
  await waitFor(() => Boolean(document.querySelector('#hard-panel input[type=file]')), 'Hard upload missing after reload')
  assert.equal((await rows()).length, 0)
  await evaluate((inventory) => window.__hardQa.upload('#hard-panel input[type=file]:not([multiple])', inventory), inventory)
  await waitFor(() => Boolean(document.querySelector('.hard-category-tree input[type=checkbox]')), 'Hard inventory did not reload')
  await settings()
  const persisted = await evaluate(() => {
    const get = (label) => [...document.querySelectorAll('#hard-panel input, #hard-panel textarea')].find((element) =>
      element.getAttribute('aria-label') === label || [...(element.labels || [])].some((candidate) => candidate.textContent.replace(/\s+/g, ' ').trim().startsWith(label)))
    return { includeZero: get('Include zero-stock items').checked, excludeDice: get('Exclude dice').checked,
      ignoreText: get('Hard ignore list').value, selectedCategories: [...document.querySelectorAll('.hard-category-tree input[type=checkbox]')].filter((element) => element.checked).length }
  })
  assert.equal(persisted.includeZero, false)
  assert.equal(persisted.excludeDice, false)
  assert.equal(persisted.ignoreText, 'Saved synthetic draft')
  assert.ok(persisted.selectedCategories > 0)
  record('Reload defaults to Soft, requires a fresh file, and retains Hard preferences and category selection', persisted)
  await tab('Soft')
  await evaluate((sales) => window.__hardQa.upload('#soft-panel input[type=file][multiple]', sales), {
    name: 'Synthetic-Soft-Footer-Sales.csv', text: csv([['Products and Categories', 'Quantity'], ['Alpha Synthetic Game', 2]]),
  })
  await waitFor(() => !document.querySelector('#soft-panel .process-row button').disabled, 'Soft sales input did not become ready')
  await evaluate(() => document.querySelector('#soft-panel .process-row button').click())
  await waitFor(() => Boolean(document.querySelector('#soft-panel .print-footer')), 'Soft report did not process')
  await media('print')
  const softFooter = await evaluate(() => ({
    footer: document.querySelector('#soft-panel .print-footer').textContent.trim(),
    hardHidden: getComputedStyle(document.querySelector('#hard-panel')).display === 'none',
    softVisible: getComputedStyle(document.querySelector('#soft-panel')).display !== 'none',
  }))
  assert.deepEqual(softFooter, { footer: `Generated with ${inventory.name}`, hardHidden: true, softVisible: true })
  await media('screen')
  record('Soft printed footer uses only the inventory filename and hides Hard', softFooter)
  assert.deepEqual(await evaluate(() => window.__hardQa.forbidden), [])
  assert.deepEqual(blockedRequests, [])
  assert.deepEqual(errors, [])
  record('No external/API requests or uncaught browser errors', { blockedRequests, errors })
} catch (error) {
  errors.push(String(error.stack || error))
  if (sessionId) {
    try { await screenshot('failure') } catch { /* preserve the original failure */ }
  }
  throw error
} finally {
  await writeFile(resolve(output, 'checks.json'), JSON.stringify({ checks, errors, blockedRequests }, null, 2))
  if (browserContextId) await call('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
  else if (targetId) await call('Target.closeTarget', { targetId }).catch(() => {})
  socket.close()
}
