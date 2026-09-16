const csv = (rows) => rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')

export function syntheticReports() {
  const sales = [['Products and Categories', 'Quantity']]
  const extra = [['Products and Categories', 'Quantity']]
  const inventory = [['Product', 'Balance']]
  for (let i = 0; i < 60; i++) {
    const name = `Synthetic Product ${String(i + 1).padStart(3, '0')}${i === 12 ? ' — exceptionally long shelf description for wrapping in print and on small screens' : ''}`
    const category = i < 12 ? '0_Processing' : i < 35 ? 'Board Games >>F' : 'Miniatures >>Paint'
    sales.push([name, i % 3 + 1])
    inventory.push([`${category} >>${name}`, i < 40 ? 2 : 8])
    if (i < 40) inventory.push([`${category} >>${name}`, 3])
    if (i < 4) extra.push([name, 1])
  }
  for (const [name, balance] of [['Zero A', 0], ['Zero B', 0], ['Negative A', -2], ['Negative B', -1]]) {
    sales.push([name, 2]); inventory.push([`Accessories >>${name}`, balance])
  }
  sales.push(['Missing A', 1], ['Missing B', 2], ['Synthetic Single', 2], ['Mixed Location', 8], ['HH Only', 3], ['Marker Only', 1], ['Club Memberships', 3], ['Level Up Discount', 1], ['Teacher/Librarian Discount', 1], ['Employee', 1], ['Events', 1], ['Synthetic Event', 1])
  inventory.push(['CCGs >>Singles >>Synthetic Single', 8], ['Miniatures >>Mixed Location', 2], ['Z Online Sales >>1_Hidey Hole >>[HH] Mixed Location', 90], ['Z Online Sales >>1_Hidey Hole >>[HH] HH Only', 12], ['Other >>[HH] Marker Only', 9], ['Events >>Synthetic Event', 7])
  return { sales: [{ name: 'Synthetic-EmailProductSales-A.csv', text: csv(sales) }, { name: 'Synthetic-EmailProductSales-B.csv', text: csv(extra) }], inventory: { name: 'Synthetic-InventoryReport.csv', text: csv(inventory) } }
}

export function installMotionFixture(expectedOrigin) {
  if (location.origin !== expectedOrigin) return
  const NativeDate = Date
  const fixed = NativeDate.parse('2026-09-15T15:30:00.000Z')
  window.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixed])) }
    static now() { return fixed }
  }
  const state = window.__motion = { forbidden: [], prints: 0 }
  if (new URL(location.href).searchParams.has('reset')) {
    localStorage.removeItem('rrg-restock-helper-settings-v8')
    localStorage.removeItem('rrg-restock-helper-settings-v7')
  }
  window.fetch = (...args) => { state.forbidden.push(`fetch ${String(args[0])}`); return Promise.reject(new Error('Synthetic QA forbids network requests')) }
  window.XMLHttpRequest = class { open() { state.forbidden.push('XHR'); throw new Error('Synthetic QA forbids XHR') } }
  navigator.sendBeacon = () => { state.forbidden.push('beacon'); return false }
  window.print = () => { state.prints++; window.dispatchEvent(new Event('beforeprint')) }
  window.__setValue = (selector, value) => {
    const element = document.querySelector(selector)
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  window.__upload = (selector, files) => {
    const input = document.querySelector(selector)
    const transfer = new DataTransfer()
    files.forEach((file) => transfer.items.add(new File([file.text], file.name, { type: 'text/csv', lastModified: fixed })))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
}
