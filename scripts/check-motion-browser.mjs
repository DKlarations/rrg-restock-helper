import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { installMotionFixture, syntheticReports } from '../tools/motion/fixture.mjs'
import { checkMotionGeometry } from './check-motion-geometry.mjs'

// Start an isolated agent-browser session on about:blank, never an unguarded app.
// node scripts/check-motion-browser.mjs <local-CDP-URL> <local-origin> baseline|compare [--behavior-only]
// PDF verification uses existing pdfinfo/pdftoppm tools; no print dialogs open.
const [endpoint, origin, stage, selection] = process.argv.slice(2)
assert.ok(endpoint?.startsWith('ws://127.0.0.1:'))
assert.match(origin || '', /^http:\/\/127\.0\.0\.1:\d+$/)
assert.ok(['baseline', 'compare'].includes(stage))
const output = resolve('tmp/motion-browser-evidence', stage)
await mkdir(output, { recursive: true })
const hash = (value) => createHash('sha256').update(value).digest('hex')
const socket = new WebSocket(endpoint)
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
let sequence = 0
const pending = new Map()
const guards = new Map()
const network = { forbidden: [], blockedExternalAssets: [], errors: [], pageErrors: [] }
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data)
  if (!message.id) {
    if (message.method === 'Runtime.exceptionThrown') network.pageErrors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text)
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request, resourceType } = message.params
      const allowedOrigin = guards.get(message.sessionId)
      const url = new URL(request.url)
      const isApi = /^\/(?:api\/|tcgplayer-|__motion\/)/.test(url.pathname) || ['XHR', 'Fetch', 'Ping'].includes(resourceType)
      const allowed = url.origin === allowedOrigin && request.method === 'GET' && !isApi
      if (!allowed) (isApi ? network.forbidden : network.blockedExternalAssets).push({ method: request.method, url: request.url, resourceType })
      const operation = allowed
        ? call('Fetch.continueRequest', { requestId }, message.sessionId)
        : call('Fetch.fulfillRequest', { requestId, responseCode: isApi ? 503 : 200, responseHeaders: [{ name: 'content-type', value: 'text/plain' }], body: '' }, message.sessionId)
      operation.catch((error) => network.errors.push(String(error)))
    }
    return
  }
  const task = pending.get(message.id)
  pending.delete(message.id)
  if (message.error) task?.reject(new Error(JSON.stringify(message.error)))
  else task?.resolve(message.result)
})
const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
})
const newSafePage = async () => {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true })
  guards.set(sessionId, origin)
  await call('Page.enable', {}, sessionId)
  await call('Runtime.enable', {}, sessionId)
  await call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, sessionId)
  return { targetId, sessionId }
}
const app = await newSafePage()
const pageCall = (method, params = {}) => call(method, params, app.sessionId)
const evaluateIn = async (sessionId, fn, ...args) => {
  const result = await call('Runtime.evaluate', { expression: `(${fn.toString()})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true }, sessionId)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const evaluate = (fn, ...args) => evaluateIn(app.sessionId, fn, ...args)
const media = (medium, reduced = 'no-preference') => pageCall('Emulation.setEmulatedMedia', { media: medium, features: [{ name: 'prefers-reduced-motion', value: reduced }] })
const waitFor = async (fn, message) => {
  for (let i = 0; i < 1200; i++) {
    try { if (await evaluate(fn)) return } catch (error) { if (!/context|navigated/.test(String(error))) throw error }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(message)
}
const key = async (key, code, number, text, modifiers = 0) => {
  await pageCall('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: number, nativeVirtualKeyCode: number, modifiers, ...(text ? { text } : {}) })
  await pageCall('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: number, nativeVirtualKeyCode: number, modifiers })
}
const records = []
const fixtureRuns = []
const record = (name, details) => { records.push({ name, details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`) }
const screenshot = async (name) => {
  await evaluate(async () => { window.scrollTo(0, 0); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  const capture = await pageCall('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(join(output, `${name}.png`), Buffer.from(capture.data, 'base64'))
}
await pageCall('Page.addScriptToEvaluateOnNewDocument', { source: `(${installMotionFixture.toString()})(${JSON.stringify(origin)})` })
const files = syntheticReports()
const fresh = async ({ reset = true, load = true } = {}) => {
  const previous = await evaluate(() => window.__motion?.forbidden)
  if (previous) { fixtureRuns.push(previous); assert.deepEqual(previous, []) }
  await media('screen')
  await pageCall('Page.navigate', { url: `${origin}/?fixture=${++sequence}${reset ? '&reset=1' : ''}` })
  await waitFor(() => Boolean(window.__motion && document.querySelector('input[type=file]')), 'Fixture boundary/app did not load')
  if (load) {
    await evaluate((files) => {
      window.__upload('input[multiple]', files.sales)
      window.__upload('input[type=file]:not([multiple])', [files.inventory])
    }, files)
    await waitFor(() => document.querySelectorAll('.file-pill').length === 3, 'CSV File input did not load')
    await evaluate(() => document.querySelector('.process-row button').click())
    await waitFor(() => Boolean(document.querySelector('.report-card')), 'Local CSV processing failed')
  }
  await evaluate(async () => { await document.fonts.ready; await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
}
const settings = async () => {
  await evaluate(() => { const details = document.querySelector('.settings-panel'); if (!details.open) details.querySelector('summary').click() })
  await waitFor(() => Boolean(document.querySelector('.settings-panel')?.open), 'Settings failed to open')
  if (stage === 'compare') await waitFor(() => document.querySelector('.settings-panel .rrg-motion-accordion')?.dataset.motionPhase === 'open', 'Settings opening did not settle')
}
const setPrintMode = async (mode) => {
  await settings()
  if (mode !== 'ordinary') {
    await evaluate((mode) => {
      document.querySelector('.split-toggle-control').click()
      window.__setValue('[aria-label="Divide restock list into"]', mode === 'max25' ? 'max' : '3')
    }, mode)
    await waitFor(() => Boolean(document.querySelector('.split-report-part')), 'Split settings did not update immediately')
  }
}
const printCapture = async (mode, reduced = false) => {
  await fresh()
  await setPrintMode(mode)
  if (reduced) await media('screen', 'reduce')
  if (stage === 'compare') await evaluate(async () => {
    const details = document.querySelector('.duplicate-details')
    details.querySelector('summary').click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const body = details.querySelector('.rrg-motion-accordion')
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation = body.getAnimations()[0]
      if (!animation) throw new Error('Print scenario lacks its intended active Accordion animation')
      animation.pause()
    }
  })
  await evaluate(() => {
    const print = [...document.querySelectorAll('button')].find((button) => button.textContent.includes('Print Restock List'))
    if (!print || print.disabled || print.closest('[inert], [hidden]')) throw new Error('Print control unavailable')
    print.click()
  })
  await waitFor(() => window.__motion.prints === 1, 'Actual print handler did not complete')
  await media('print', reduced ? 'reduce' : 'no-preference')
  // Screen focus can scroll the retained fixture; normalize before exact SVG boxes.
  await evaluate(async () => { window.scrollTo(0, 0); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
  const proof = await evaluate(() => {
    const report = document.querySelector('.report-card')
    if (report.querySelector('input, [class*="rrg-motion"]')) throw new Error('Printed paper marks/report were converted to interactive motion')
    if ([...report.querySelectorAll('.pull-checkbox')].some((mark) => mark.tagName !== 'SPAN')) throw new Error('Static paper checkbox semantics changed')
    const origin = report.getBoundingClientRect()
    const geometry = [...report.querySelectorAll('*')].map((element) => {
      const box = element.getBoundingClientRect(); const style = getComputedStyle(element)
      // Print layout is relative to its report, independent of screen scroll/focus.
      return { tag: element.tagName, class: element.getAttribute('class'), x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height, font: style.font, transform: style.transform, breakBefore: style.breakBefore, breakInside: style.breakInside }
    })
    return { markup: report.outerHTML, text: report.innerText, geometry, marks: report.querySelectorAll('.pull-checkbox').length, categories: [...report.querySelectorAll('.report-group h3, .verify-group h4')].map((element) => element.textContent), rows: [...report.querySelectorAll('.report-row:not(.report-table-header)')].map((row) => ({ name: row.querySelector('.report-item-name').textContent, pull: row.querySelector('.qty-to-pull').textContent, sold: row.querySelector('.qty-sold').textContent, stock: row.querySelector('.current-stock').textContent })) }
  })
  const name = `${mode}${reduced ? '-reduced' : ''}`
  await writeFile(join(output, `${name}.html`), proof.markup)
  proof.markup = hash(proof.markup)
  const pdfPath = join(output, `${name}.pdf`)
  const pdf = await pageCall('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, displayHeaderFooter: false })
  await writeFile(pdfPath, Buffer.from(pdf.data, 'base64'))
  execFileSync('pdftoppm', ['-r', '120', '-png', pdfPath, join(output, name)], { windowsHide: true })
  const info = execFileSync('pdfinfo', ['-box', pdfPath], { encoding: 'utf8', windowsHide: true })
  proof.pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1])
  proof.size = info.match(/^Page size:\s+(.+)$/m)?.[1]
  proof.rasters = await Promise.all((await readdir(output)).filter((file) => new RegExp(`^${name}-\\d+\\.png$`).test(file)).sort().map(async (file) => hash(await readFile(join(output, file)))))
  await writeFile(join(output, `${name}.json`), JSON.stringify(proof, null, 2))
  if (stage === 'compare') assert.deepEqual(proof, JSON.parse(await readFile(resolve('tmp/motion-browser-evidence/baseline', `${mode}.json`), 'utf8')), `${name} report or PDF changed`)
  record(`${name} print ${stage === 'compare' ? 'identical to baseline' : 'baseline'}`, { pages: proof.pages, paperMarks: proof.marks, size: proof.size })
}
const behaviors = async () => {
  await fresh()
  record('real reprocessing exposes Processing immediately and ends enabled and ready', await evaluate(async () => {
    const button = document.querySelector('.process-row button')
    const eyebrow = document.querySelector('.results-toolbar .eyebrow')
    const observed = []
    const sample = () => observed.push({ button: button.textContent, disabled: button.disabled, eyebrow: eyebrow.textContent })
    const observer = new MutationObserver(sample)
    observer.observe(button, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] })
    document.querySelector('.results-toolbar .secondary-button').click()
    const deadline = performance.now() + 2000
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5))
      if (observed.some((state) => state.disabled) && !button.disabled) break
    }
    observer.disconnect()
    if (!observed.some((state) => state.disabled && state.button === 'Processing…' && state.eyebrow === 'PROCESSING…')) throw new Error(`Real processing feedback missed: ${JSON.stringify(observed)}`)
    if (button.disabled || button.textContent !== 'Process Reports' || eyebrow.textContent !== 'REPORT READY') throw new Error('Completed processing feedback stayed stale')
    return { observed, finalEnabled: true }
  }))
  record('local CSV quantities, duplicates and permanent exclusions', await evaluate(() => {
    const report = document.querySelector('.report-card')
    const text = report.textContent
    if (/HH Only|Marker Only|Level Up Discount|Teacher\/Librarian Discount|Employee|Synthetic Event|Synthetic Single/.test(text)) throw new Error('Excluded stock entered printable output')
    const row = (name) => [...report.querySelectorAll('.report-row')].find((element) => element.querySelector('.report-item-name')?.textContent === name)
    if (row('Synthetic Product 001').querySelector('.current-stock').textContent !== '5' || row('Synthetic Product 001').querySelector('.qty-sold').textContent !== '2') throw new Error('Duplicate balance or summed sales changed')
    if (row('Mixed Location').querySelector('.qty-to-pull').textContent !== '2') throw new Error('HH balance contributed to mixed stock')
    const duplicateNames = document.querySelector('.duplicate-details pre').textContent.split('\n')
    if (duplicateNames.length !== 40) throw new Error('Full duplicate list missing')
    if (document.querySelector('.rrg-motion-tabs')) throw new Error('Inapplicable tabs manufactured')
    return { duplicateNames: duplicateNames.length, restockRows: 61, verifyRows: document.querySelectorAll('.verify-section .pull-checkbox').length, firstStock: '5', mixedPull: '2' }
  }))
  await settings()
  record('native settings labels immediately update the report', await evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const labels = [...document.querySelectorAll('.settings-content .toggle-setting')]
    const checks = labels.map((label) => label.querySelector('input'))
    if (checks.length !== 4 || checks.some((input) => input.type !== 'checkbox')) throw new Error('Four native settings controls changed')
    labels[0].click(); await frame()
    if (document.querySelector('.report-group h3')) throw new Error('Category heading setting waited or failed')
    labels[1].click(); await frame()
    if (document.querySelector('.verify-section')) throw new Error('Verify setting waited or failed')
    labels[2].click(); await frame()
    if (![...document.querySelectorAll('.report-item-name')].some((element) => element.textContent === 'Synthetic Single')) throw new Error('Singles setting did not apply')
    labels[3].click(); await frame()
    if (document.querySelector('[aria-label="Divide restock list into"]').disabled || !document.querySelector('.split-report-part')) throw new Error('Split setting waited or failed')
    checks[0].focus()
    return { nativeControls: checks.length, changesImmediate: true }
  }))
  await key(' ', 'Space', 32, ' ')
  record('native checkbox Space and visible focus preserve semantics', await evaluate(() => {
    const input = document.querySelector('.settings-content input[type=checkbox]')
    if (!input.checked || !document.querySelector('.report-group h3') || document.activeElement !== input) throw new Error('Space/label behavior changed')
    if (!input.matches(':focus-visible')) throw new Error('Native keyboard focus lost')
    return { checked: input.checked, focusVisible: true, inputWidth: input.getBoundingClientRect().width }
  }))
  record('settings and ignore detail preserve draft and focus through reversal', await evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const settings = document.querySelector('.settings-panel')
    const nested = document.querySelector('.ignore-details')
    if (nested && !nested.open) { nested.querySelector('summary').click(); await frame() }
    const textarea = document.querySelector('.ignore-setting textarea')
    textarea.focus()
    window.__setValue('.ignore-setting textarea', 'Synthetic Product 059\nKeep this exact unused draft*')
    await frame()
    settings.querySelector('summary').click(); await frame()
    if (document.activeElement !== settings.querySelector('summary')) throw new Error('Settings close did not restore summary focus')
    const body = settings.querySelector('.rrg-motion-accordion')
    if (!body.inert || body.getAttribute('aria-hidden') !== 'true') throw new Error('Closing settings remains interactive')
    settings.querySelector('summary').click(); await frame(); settings.querySelector('summary').click(); await frame(); settings.querySelector('summary').click(); await frame()
    if (textarea.value !== 'Synthetic Product 059\nKeep this exact unused draft*') throw new Error('Settings draft lost')
    if (JSON.parse(localStorage.getItem('rrg-restock-helper-settings-v8')).ignoreText !== textarea.value) throw new Error('Original persistence changed')
    return { draft: textarea.value, persisted: true }
  }))
  await waitFor(() => document.querySelector('.settings-panel .rrg-motion-accordion')?.dataset.motionPhase === 'open', 'Settings rapid reversal failed')
  record('dynamic textarea growth retargets opening height without clipping', await evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
    const details = document.querySelector('.settings-panel')
    const summary = details.querySelector('summary')
    const body = details.querySelector('.rrg-motion-accordion')
    const textarea = details.querySelector('textarea')
    const originalHeight = textarea.style.height
    summary.click(); await frame(); summary.click(); await frame()
    textarea.style.height = '320px'
    await frame()
    const animation = body.getAnimations()[0]
    if (!animation || animation.effect.getKeyframes().some((keyframe) => keyframe.transform || keyframe.opacity)) throw new Error('Settings lacks a height-only Accordion animation')
    const deadline = performance.now() + 2000
    while (body.dataset.motionPhase !== 'open' && performance.now() < deadline) await frame()
    if (body.dataset.motionPhase !== 'open' || body.scrollHeight > body.clientHeight + 1) throw new Error('Resized textarea clipped at final height')
    const expandedHeight = body.clientHeight
    textarea.style.height = originalHeight
    await frame(); await frame()
    if (body.scrollHeight > body.clientHeight + 1) throw new Error('Restored textarea height clipped')
    return { expandedHeight, restoredHeight: body.clientHeight, heightOnly: true }
  }))
  record('complete duplicate list and native summary keyboard state', await evaluate(async () => {
    const details = document.querySelector('.duplicate-details')
    if (details.open) throw new Error('Duplicate list initial visibility changed')
    details.querySelector('summary').focus()
    return { initialClosed: true, warningVisible: document.querySelector('.info-message').getBoundingClientRect().height > 0 }
  }))
  await key('Enter', 'Enter', 13, '\r')
  await waitFor(() => document.querySelector('.duplicate-details .rrg-motion-accordion')?.dataset.motionPhase === 'open', 'Native Enter did not open duplicate list')
  record('long duplicate body fits and preserves its existing scrolling region', await evaluate(() => {
    const details = document.querySelector('.duplicate-details')
    const body = details.querySelector('.rrg-motion-accordion')
    const pre = details.querySelector('pre')
    if (body.scrollHeight > body.clientHeight + 1) throw new Error('Duplicate body clipped after settle')
    pre.scrollTop = pre.scrollHeight
    if (!pre.textContent.includes('Synthetic Product 040') || pre.scrollTop <= 0) throw new Error('Complete long list inaccessible')
    return { names: pre.textContent.split('\n').length, scrollHeight: pre.scrollHeight, visibleHeight: pre.clientHeight }
  }))
  await evaluate(async () => {
    document.querySelector('.duplicate-details summary').click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (!document.querySelector('.duplicate-details .rrg-motion-accordion').getAnimations().length) throw new Error('Reduced-motion change lacks a running transition to cancel')
  })
  await media('screen', 'reduce')
  record('live reduced motion settles native disclosure immediately', await evaluate(async () => {
    const details = document.querySelector('.duplicate-details')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const body = details.querySelector('.rrg-motion-accordion')
    if (details.open || !body.hidden || body.getAnimations().length) throw new Error('Reduced closing retained hidden waits')
    details.querySelector('summary').click(); await new Promise((resolve) => requestAnimationFrame(resolve))
    if (!details.open || body.hidden || body.getAnimations().length) throw new Error('Reduced opening animated')
    return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches }
  }))
  await media('screen')
  await screenshot('workspace-desktop')
  const settingsBounds = await evaluate(() => { const box = document.querySelector('.settings-panel').getBoundingClientRect(); return { x: box.x, y: box.y + scrollY, width: box.width, height: box.height, scale: 1 } })
  const settingsCapture = await pageCall('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: settingsBounds })
  await writeFile(join(output, 'settings-desktop.png'), Buffer.from(settingsCapture.data, 'base64'))
  const firstScreen = await pageCall('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(output, 'first-screen-desktop.png'), Buffer.from(firstScreen.data, 'base64'))
  for (const width of [390, 320]) {
    await pageCall('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false })
    await waitFor(() => document.querySelector('.settings-panel .rrg-motion-accordion')?.dataset.motionPhase === 'open', 'Responsive settings did not settle')
    const baseline = JSON.parse(await readFile(resolve('tmp/motion-browser-evidence/baseline', `layout-${width}.json`), 'utf8'))
    record(`narrow ${width}px disclosures and existing report scroll layout`, await evaluate((baselineWidth) => {
      const settingsBody = document.querySelector('.settings-panel .rrg-motion-accordion')
      if (settingsBody.scrollHeight > settingsBody.clientHeight + 1) throw new Error('Narrow settings clip')
      if (document.documentElement.scrollWidth > Math.max(innerWidth, baselineWidth) + 1) throw new Error('Narrow motion added document overflow')
      const report = document.querySelector('.report-card')
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, baselineWidth, reportScrollWidth: report.scrollWidth, reportWidth: report.clientWidth }
    }, baseline.documentWidth))
    await screenshot(`workspace-${width}`)
  }
  await fresh({ reset: false })
  await settings()
  record('reload preserves ignore/settings and resets split using existing rule', await evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('rrg-restock-helper-settings-v8'))
    if (saved.ignoreText !== 'Synthetic Product 059\nKeep this exact unused draft*' || saved.splitReport !== false || !saved.includeMiscAndSingles) throw new Error('Settings persistence contract changed')
    return { ignoreRetained: true, splitReset: true }
  }))
  await fresh({ load: false })
  await evaluate(() => {
    window.__upload('input[multiple]', [{ name: 'Synthetic-bad-sales.csv', text: 'Wrong,Columns\n1,2' }])
    window.__upload('input[type=file]:not([multiple])', [{ name: 'Synthetic-bad-inventory.csv', text: 'Product,Balance\nBad,2' }])
  })
  await waitFor(() => !document.querySelector('.process-row button').disabled, 'Invalid CSV files did not load')
  await evaluate(() => document.querySelector('.process-row button').click())
  await waitFor(() => Boolean(document.querySelector('[role=alert]')), 'Real parsing error did not render')
  record('real parsing error remains visible and report is not fabricated', await evaluate(() => {
    if (document.querySelector('.report-card')) throw new Error('Error fabricated successful report')
    if (document.querySelector('.process-row button').disabled) throw new Error('Completed failed processing stayed disabled')
    return { alert: document.querySelector('[role=alert]').textContent, label: document.querySelector('.process-row button').textContent }
  }))
}

try {
  await pageCall('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false })
  if (selection !== '--behavior-only' && selection !== '--geometry-only') {
    for (const mode of ['ordinary', 'split3', 'max25']) await printCapture(mode)
    if (stage === 'compare') await printCapture('ordinary', true)
  }
  if (stage === 'compare' && selection !== '--geometry-only') await behaviors()
  else if (stage === 'baseline' && selection !== '--geometry-only') {
    await fresh(); await settings()
    await screenshot('workspace-desktop')
    for (const width of [390, 320]) {
      await pageCall('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: false })
      await screenshot(`workspace-${width}`)
      await writeFile(join(output, `layout-${width}.json`), JSON.stringify(await evaluate(() => ({ width: innerWidth, documentWidth: document.documentElement.scrollWidth })), null, 2))
    }
  }
  if (stage === 'compare' || selection === '--geometry-only') await checkMotionGeometry({ evaluate, pageCall, fresh, record, app: 'restock', baseline: stage === 'baseline', save: (name, data) => writeFile(join(output, name), JSON.stringify(data, null, 2)), capture: (name, data) => writeFile(join(output, name), Buffer.from(data, 'base64')) })
  fixtureRuns.push(await evaluate(() => window.__motion.forbidden))
  fixtureRuns.forEach((requests) => assert.deepEqual(requests, []))
  assert.deepEqual(network.forbidden, [])
  assert.deepEqual(network.errors, [])
  assert.deepEqual(network.pageErrors, [])
  await writeFile(join(output, 'network.json'), JSON.stringify({ ...network, fixtureRuns }, null, 2))
  await writeFile(join(output, 'checks.json'), JSON.stringify(records, null, 2))
  for (const file of ['failure.json', 'failure.png']) await unlink(join(output, file)).catch((error) => { if (error.code !== 'ENOENT') throw error })
  console.log(`Completed ${records.length} checks. Evidence: ${output}`)
} catch (error) {
  await screenshot('failure').catch(() => {})
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: String(error), network, body: await evaluate(() => document.body.innerText.slice(-4000)).catch(() => null) }, null, 2))
  throw error
} finally {
  await call('Target.closeTarget', { targetId: app.targetId }).catch(() => {})
  socket.close()
}
