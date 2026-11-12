// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { buildBaseReport, type CsvInput, type HandledSalesTotal } from './lib/restock'
import type { ReportWorkerResult } from './report.worker'

const inventoryText = [
  'Product,Balance',
  'Board Games >>Black sleeves,100',
  'Board Games >>Low stock,3',
  'Board Games >>Negative stock,-2',
  'Board Games >>Zero stock,0',
  'Board Games >>Other,20',
  'Paint >>Paint bottle,20',
].join('\n')

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('Worker', undefined)
  CapturedWorker.instances = []
  vi.spyOn(window, 'print').mockImplementation(() => {})
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

function csv(items: Record<string, number>) {
  return ['Products and Categories,Quantity', ...Object.entries(items).map(([name, quantity]) => `${name},${quantity}`)].join('\n')
}

function file(name: string, text: string) {
  const input = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(input, 'text', { value: () => Promise.resolve(text) })
  return input
}

function salesInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('#soft-panel input[type=file][multiple]')!
}

function inventoryInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('#soft-panel input[type=file]:not([multiple])')!
}

function handledInput() {
  return screen.getByRole('region', { name: 'Already-handled sales' }).querySelector<HTMLInputElement>('input[type=file]')!
}

function handledRegion() {
  return screen.getByRole('region', { name: 'Already-handled sales' })
}

function historyTimes() {
  return [...handledRegion().querySelectorAll<HTMLTimeElement>('.repeat-history time')]
}

function moveButton() {
  return screen.getByRole('button', { name: 'Move to already handled' }) as HTMLButtonElement
}

async function upload(input: HTMLInputElement, ...files: File[]) {
  await act(async () => { fireEvent.change(input, { target: { files } }) })
}

async function latest(container: HTMLElement, name: string, items: Record<string, number>) {
  await upload(salesInput(container), file(name, csv(items)))
}

function repeatToggle() {
  return screen.getByRole('checkbox', { name: /^Subtract already-handled sales/ }) as HTMLInputElement
}

function enableRepeat() {
  if (!repeatToggle().checked) fireEvent.click(repeatToggle())
}

function processButton() {
  return screen.getByRole('button', { name: /^(Process Reports|Processing…)$/ }) as HTMLButtonElement
}

async function process(container: HTMLElement) {
  fireEvent.click(processButton())
  await waitFor(() => {
    expect(processButton().disabled).toBe(false)
    expect(container.querySelector('#soft-panel .report-card')).not.toBeNull()
  })
}

function printedRow(container: HTMLElement, name: string) {
  const label = [...container.querySelectorAll('#soft-panel .report-card .report-item-name')]
    .find((node) => node.textContent === name)
  return label?.closest('.report-row') ?? null
}

function quantities(container: HTMLElement, name: string) {
  const row = printedRow(container, name)
  expect(row, `Expected a printed row for ${name}`).not.toBeNull()
  return {
    pull: row?.querySelector('.qty-to-pull')?.textContent,
    sold: row?.querySelector('.qty-sold')?.textContent,
    stock: row?.querySelector('.current-stock')?.textContent,
  }
}

async function markHandled(container: HTMLElement) {
  const previousRuns = historyTimes().length
  fireEvent.click(moveButton())
  await waitFor(() => {
    expect(container.querySelectorAll('#soft-panel .upload-grid .upload-column:first-child .file-pill')).toHaveLength(0)
    expect(historyTimes()).toHaveLength(previousRuns + 1)
  })
  expect(container.querySelector('#soft-panel .report-card')).toBeNull()
  expect(processButton().disabled).toBe(true)
}

async function importHandled(runCount = 1) {
  await waitFor(() => {
    expect(historyTimes()).toHaveLength(runCount)
    expect(handledRegion().querySelectorAll('.upload-column .file-pill')).toHaveLength(0)
  })
}

class CapturedWorker {
  static instances: CapturedWorker[] = []
  onmessage: ((event: MessageEvent<ReportWorkerResult>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  request!: { sales: CsvInput[]; inventory: CsvInput; handledTotals?: HandledSalesTotal[] }
  postMessage = vi.fn((request: CapturedWorker['request']) => { this.request = request })
  terminate = vi.fn()
  constructor() { CapturedWorker.instances.push(this) }
  finish() {
    const { sales, inventory, handledTotals } = this.request
    this.onmessage?.({ data: { ok: true, report: buildBaseReport(sales, inventory, handledTotals) } } as MessageEvent<ReportWorkerResult>)
  }
}

describe('optional additional Soft restocks', () => {
  it('keeps the original multi-file Soft calculation and print presentation when disabled', async () => {
    const { container } = render(<App />)
    expect(repeatToggle().checked).toBe(false)
    await upload(salesInput(container), file('yesterday.csv', csv({ 'Black sleeves': 10 })), file('today.csv', csv({ 'Black sleeves': 5 })))
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await process(container)
    expect(quantities(container, 'Black sleeves')).toEqual({ pull: '15', sold: '15', stock: '100' })
    expect(within(container.querySelector('.report-card')!).getByRole('heading', { name: 'Inventory Restock List' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Move to already handled' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start new restock cycle' })).toBeNull()
  })

  it('moves a whole unprocessed Step 1 group into visible Step 3 history with a handled timestamp', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(salesInput(container), file('morning-a.csv', csv({ 'Black sleeves': 6 })), file('morning-b.csv', csv({ 'Black sleeves': 4 })))
    expect(moveButton().disabled).toBe(true)
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    expect(container.querySelector('.report-card')).toBeNull()
    expect(moveButton().disabled).toBe(false)
    expect(moveButton().closest('.upload-column')).toBe(salesInput(container).closest('.upload-column'))
    await markHandled(container)
    expect(within(handledRegion()).getByText('morning-a.csv')).toBeTruthy()
    expect(within(handledRegion()).getByText('morning-b.csv')).toBeTruthy()
    expect(historyTimes()[0].closest('[hidden]')).toBeNull()
    expect(Number.isNaN(Date.parse(historyTimes()[0].dateTime))).toBe(false)
    expect(handledRegion().textContent).toContain('Handled')
    expect(handledRegion().textContent).toContain('Current comparison')
    expect(screen.getByText('inventory.csv')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use this run as already handled' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use uploaded reports as handled' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start new restock cycle' })).toBeNull()
    await latest(container, 'afternoon.csv', { 'Black sleeves': 15 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('5')
  })

  it('produces 10, 5, then 2; printing and reprocessing never advance the handled total', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'morning.csv', { 'Black sleeves': 10 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('10')
    await markHandled(container)
    expect(screen.getByText('inventory.csv')).toBeTruthy()
    const timestamps = historyTimes().map((time) => ({ value: time.dateTime, text: time.textContent }))

    await latest(container, 'afternoon.csv', { 'Black sleeves': 15 })
    await process(container)
    expect(quantities(container, 'Black sleeves')).toEqual({ pull: '5', sold: '5', stock: '100' })
    expect(within(container.querySelector('.report-card')!).getByRole('heading', { name: /Additional restock/i })).toBeTruthy()
    expect(container.querySelector('.report-card')?.textContent).toContain('morning.csv')
    expect(container.querySelector('.report-card')?.textContent).toContain('afternoon.csv')

    fireEvent.click(screen.getByRole('button', { name: /Print.*Restock/i }))
    await waitFor(() => expect(window.print).toHaveBeenCalledOnce())
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('5')
    expect(historyTimes().map((time) => ({ value: time.dateTime, text: time.textContent }))).toEqual(timestamps)

    await markHandled(container)
    expect(handledRegion().querySelector('.repeat-history')?.firstElementChild?.textContent).toContain('afternoon.csv')
    await latest(container, 'evening.csv', { 'Black sleeves': 17 })
    await process(container)
    expect(quantities(container, 'Black sleeves')).toEqual({ pull: '2', sold: '2', stock: '100' })
    expect(within(handledRegion()).getByText('morning.csv').closest('[hidden]')).toBeNull()
    expect(within(handledRegion()).getByText('afternoon.csv').closest('[hidden]')).toBeNull()
  })

  it('starts midway through a day by importing a handled run made from multiple separate sales files', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await upload(salesInput(container), file('latest-a.csv', csv({ 'Black sleeves': 10 })), file('latest-b.csv', csv({ 'Black sleeves': 7 })))
    await upload(handledInput(), file('handled-a.csv', csv({ 'Black sleeves': 10 })), file('handled-b.csv', csv({ 'Black sleeves': 5 })))
    await importHandled()
    expect(handledRegion().textContent).toContain('Added')
    await process(container)
    expect(quantities(container, 'Black sleeves')).toEqual({ pull: '2', sold: '2', stock: '100' })
    expect(container.querySelector('.report-card')?.textContent).toContain('handled-a.csv')
    expect(container.querySelector('.report-card')?.textContent).toContain('handled-b.csv')
  })

  it('can establish an already-handled baseline before uploading or processing the latest sales', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(handledInput(), file('previously-handled.csv', csv({ 'Black sleeves': 10 })))
    expect(historyTimes()).toHaveLength(0)
    expect(within(handledRegion()).getByText('previously-handled.csv')).toBeTruthy()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await importHandled()
    expect(container.querySelector('.report-card')).toBeNull()
    await latest(container, 'current.csv', { 'Black sleeves': 15 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('5')
  })

  it('immediately lists errors from an imported handled report and does not restock a later rebound twice', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await upload(handledInput(), file('handled-ten.csv', csv({ 'Black sleeves': 10 })))
    await importHandled()
    expect(container.querySelector('.report-card')).toBeNull()

    await upload(handledInput(), file('handled-eight.csv', csv({ 'Black sleeves': 8 })))
    await importHandled(2)
    const alert = await screen.findByRole('alert', { name: 'Sales comparison errors' })
    expect(alert.textContent).toContain('Black sleeves')
    expect(alert.textContent).toContain('latest 8, already handled 10')
    expect(container.querySelector('.report-card')).toBeNull()

    await latest(container, 'rebound.csv', { 'Black sleeves': 10, Other: 2 })
    await process(container)
    expect(printedRow(container, 'Black sleeves')).toBeNull()
    expect(quantities(container, 'Other').pull).toBe('2')
  })

  it('blocks current processing while an automatic handled import is running', async () => {
    vi.stubGlobal('Worker', CapturedWorker)
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'latest.csv', { 'Black sleeves': 15 })
    await upload(handledInput(), file('handled.csv', csv({ 'Black sleeves': 10 })))
    await waitFor(() => expect(CapturedWorker.instances).toHaveLength(1))
    expect(processButton().disabled).toBe(true)
    fireEvent.click(processButton())
    expect(container.querySelector('.report-card')).toBeNull()
    expect(CapturedWorker.instances).toHaveLength(1)
    act(() => CapturedWorker.instances[0].finish())
    await importHandled()
    fireEvent.click(processButton())
    act(() => CapturedWorker.instances[1].finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('5')
  })

  it('adds follow-up source and generation details only while enabled and restores identical ordinary printable markup', async () => {
    const { container } = render(<App />)
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'latest.csv', { 'Black sleeves': 15 })
    await process(container)
    const ordinaryMarkup = container.querySelector('.report-card')!.innerHTML
    expect(container.querySelector('.report-meta')?.textContent).toMatch(/^Date: /)
    expect(container.querySelector('.repeat-print-sources')).toBeNull()

    enableRepeat()
    await upload(handledInput(), file('handled.csv', csv({ 'Black sleeves': 10 })))
    await importHandled()
    await process(container)
    expect(container.querySelector('.print-report-header h2')?.textContent).toBe('Additional restock')
    expect(container.querySelector('.report-meta')?.textContent).toMatch(/^Generated: .*\d+:\d+/)
    const sources = container.querySelector('.repeat-print-sources')!
    expect(sources.textContent).toContain('Latest sales: latest.csv')
    expect(sources.textContent).toContain('Already handled: handled.csv')
    expect(sources.textContent).toContain('Qty Sold shows additional sales.')

    fireEvent.click(repeatToggle())
    await process(container)
    expect(container.querySelector('.report-card')!.innerHTML).toBe(ordinaryMarkup)
  })

  it('shows sales decreases as errors, prints other items, and retains the earlier handled quantity after advancing', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'ten.csv', { 'Black sleeves': 10 })
    await process(container)
    await markHandled(container)

    await latest(container, 'decreased.csv', { 'Black sleeves': 8, Other: 2 })
    await process(container)
    expect(printedRow(container, 'Black sleeves')).toBeNull()
    expect(quantities(container, 'Other').pull).toBe('2')
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent?.includes('Black sleeves'))).toBe(true)
    expect((screen.getByRole('button', { name: /Print.*Restock/i }) as HTMLButtonElement).disabled).toBe(false)
    await markHandled(container)

    await latest(container, 'recovered.csv', { 'Black sleeves': 10, Other: 3 })
    await process(container)
    expect(printedRow(container, 'Black sleeves')).toBeNull()
    expect(quantities(container, 'Other').pull).toBe('1')
    expect([...container.querySelectorAll('.report-card .qty-to-pull')].every((node) => Number(node.textContent) >= 0)).toBe(true)
  })

  it('retains inventory caps and zero, negative, and missing-item Verify Stock treatment for additional quantities', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    const items = { 'Low stock': 10, 'Negative stock': 10, 'Zero stock': 10, 'Missing item': 10 }
    await latest(container, 'first.csv', items)
    await process(container)
    await markHandled(container)
    await latest(container, 'next.csv', Object.fromEntries(Object.keys(items).map((key) => [key, 15])))
    await process(container)
    expect(quantities(container, 'Low stock')).toEqual({ pull: '3', sold: '5', stock: '3' })
    expect(quantities(container, 'Negative stock')).toEqual({ pull: '0', sold: '5', stock: '-2' })
    expect(quantities(container, 'Zero stock')).toEqual({ pull: '0', sold: '5', stock: '0' })
    expect(quantities(container, 'Missing item')).toEqual({ pull: '0', sold: '5', stock: 'Not found' })
    expect(printedRow(container, 'Negative stock')?.closest('.verify-section')).not.toBeNull()

    fireEvent.click(screen.getByText('Report & Print Settings'))
    fireEvent.click(await screen.findByRole('checkbox', { name: /Print Verify Stock/ }))
    expect(printedRow(container, 'Negative stock')).toBeNull()
    expect(printedRow(container, 'Low stock')).not.toBeNull()
  })

  it('covers sales hidden by filters and retains preferences when moving files or clearing all', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'first.csv', { 'Black sleeves': 10, 'Paint bottle': 4 })
    await process(container)
    fireEvent.click(screen.getByText('Report & Print Settings'))
    const ignore = await screen.findByRole('textbox')
    fireEvent.change(ignore, { target: { value: 'Paint' } })
    expect(printedRow(container, 'Paint bottle')).toBeNull()
    await markHandled(container)
    await latest(container, 'second.csv', { 'Black sleeves': 15, 'Paint bottle': 4 })
    await process(container)
    fireEvent.click(screen.getByText('Report & Print Settings'))
    const savedIgnore = await screen.findByRole('textbox') as HTMLTextAreaElement
    expect(savedIgnore.value).toBe('Paint')
    fireEvent.change(savedIgnore, { target: { value: '' } })
    expect(printedRow(container, 'Paint bottle')).toBeNull()
    expect(quantities(container, 'Black sleeves').pull).toBe('5')

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(container.querySelector('.report-card')).toBeNull()
    expect(screen.queryByText('inventory.csv')).toBeNull()
    expect(repeatToggle().checked).toBe(false)
    expect(processButton().disabled).toBe(true)
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'fresh-cycle.csv', { 'Black sleeves': 15, 'Paint bottle': 4 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
    expect(quantities(container, 'Paint bottle').pull).toBe('4')
  })

  it('returns to the unchanged ordinary calculation when disabled and keeps the handled history when reenabled', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'handled.csv', { 'Black sleeves': 10 })
    await process(container)
    await markHandled(container)
    await latest(container, 'latest.csv', { 'Black sleeves': 15 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('5')

    fireEvent.click(repeatToggle())
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
    expect(within(container.querySelector('.report-card')!).getByRole('heading', { name: 'Inventory Restock List' })).toBeTruthy()
    enableRepeat()
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('5')
  })

  it('ignores a late handled-file read after Clear all', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    let resolve!: (text: string) => void
    const delayed = new Promise<string>((done) => { resolve = done })
    const stale = new File(['pending'], 'stale-handled.csv', { type: 'text/csv' })
    Object.defineProperty(stale, 'text', { value: () => delayed })
    fireEvent.change(handledInput(), { target: { files: [stale] } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await act(async () => { resolve(csv({ 'Black sleeves': 10 })) })
    expect(screen.queryByText('stale-handled.csv')).toBeNull()
    enableRepeat()
    await upload(inventoryInput(container), file('fresh-inventory.csv', inventoryText))
    await latest(container, 'fresh-sales.csv', { 'Black sleeves': 15 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
  })

  it('does not surface a late handled-file read failure after returning to ordinary Soft', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    let reject!: (reason: Error) => void
    const delayed = new Promise<string>((_resolve, fail) => { reject = fail })
    const stale = new File(['pending'], 'stale-handled.csv', { type: 'text/csv' })
    Object.defineProperty(stale, 'text', { value: () => delayed })
    fireEvent.change(handledInput(), { target: { files: [stale] } })
    fireEvent.click(repeatToggle())
    await act(async () => { reject(new Error('The old handled upload failed')) })
    expect(screen.queryByRole('alert')).toBeNull()
    await latest(container, 'ordinary.csv', { 'Black sleeves': 15 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
    enableRepeat()
    expect(historyTimes()).toHaveLength(0)
    expect(within(handledRegion()).queryByText('stale-handled.csv')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('retains repeat work across Hard tab switches without affecting Hard and forgets files/history on reload', async () => {
    localStorage.setItem('rrg-restock-helper-hard-settings-v1', JSON.stringify({ selectedCategories: [JSON.stringify(['Board Games'])] }))
    const { container, unmount } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'handled.csv', { 'Black sleeves': 10 })
    await process(container)
    await markHandled(container)
    await latest(container, 'latest.csv', { 'Black sleeves': 15 })
    await process(container)
    fireEvent.click(screen.getByRole('tab', { name: /Hard/i }))
    await waitFor(() => expect(container.querySelectorAll('#hard-panel .hard-row[data-key]')).toHaveLength(5))
    expect(container.querySelector('#hard-panel .hard-report-card')?.textContent).toContain('100')
    fireEvent.click(screen.getByRole('tab', { name: /Soft/i }))
    expect(quantities(container, 'Black sleeves').pull).toBe('5')

    unmount()
    const fresh = render(<App />)
    expect(repeatToggle().checked).toBe(false)
    expect(fresh.container.querySelectorAll('.file-pill')).toHaveLength(0)
    expect(fresh.container.querySelector('.report-card')).toBeNull()
    enableRepeat()
    expect(screen.queryByText('handled.csv')).toBeNull()
    await upload(inventoryInput(fresh.container), file('inventory-again.csv', inventoryText))
    await latest(fresh.container, 'latest-again.csv', { 'Black sleeves': 15 })
    await process(fresh.container)
    expect(quantities(fresh.container, 'Black sleeves').pull).toBe('15')
  })

  it('forwards handled totals to the worker and discards a stale repeat response after switching the option off', async () => {
    vi.stubGlobal('Worker', CapturedWorker)
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'first.csv', { 'Black sleeves': 10 })
    fireEvent.click(processButton())
    const first = CapturedWorker.instances[0]
    expect(first.request.handledTotals).toEqual([])
    act(() => first.finish())
    fireEvent.click(moveButton())
    const move = CapturedWorker.instances.at(-1)!
    act(() => move.finish())
    await waitFor(() => expect(historyTimes()).toHaveLength(1))
    await latest(container, 'next.csv', { 'Black sleeves': 15 })
    fireEvent.click(processButton())
    const next = CapturedWorker.instances.at(-1)!
    expect(next.request.handledTotals?.find((row) => row.key === 'black sleeves')?.quantity).toBe(10)
    act(() => next.finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('5')

    fireEvent.click(processButton())
    const stale = CapturedWorker.instances.at(-1)!
    fireEvent.click(repeatToggle())
    expect(stale.terminate).toHaveBeenCalledOnce()
    act(() => stale.finish())
    expect(container.querySelector('.report-card')).toBeNull()
    fireEvent.click(processButton())
    const ordinary = CapturedWorker.instances.at(-1)!
    expect(ordinary.request).not.toHaveProperty('handledTotals')
    act(() => ordinary.finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
  })

  it('discards a queued automatic handled-import result after Clear all', async () => {
    vi.stubGlobal('Worker', CapturedWorker)
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await upload(handledInput(), file('stale-handled.csv', csv({ 'Black sleeves': 10 })))
    await waitFor(() => expect(CapturedWorker.instances).toHaveLength(1))
    const stale = CapturedWorker.instances[0]
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(stale.terminate).toHaveBeenCalledOnce()
    act(() => stale.finish())
    expect(screen.queryByText(/Run saved as already handled/)).toBeNull()
    enableRepeat()
    expect(historyTimes()).toHaveLength(0)
    await upload(inventoryInput(container), file('new-inventory.csv', inventoryText))
    await latest(container, 'fresh.csv', { 'Black sleeves': 15 })
    fireEvent.click(processButton())
    const fresh = CapturedWorker.instances[1]
    expect(fresh.request.handledTotals).toEqual([])
    act(() => fresh.finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
  })

  it('cancels a handled import when disabled and resumes it once when reenabled', async () => {
    vi.stubGlobal('Worker', CapturedWorker)
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'current.csv', { 'Black sleeves': 15 })
    await upload(handledInput(), file('previous.csv', csv({ 'Black sleeves': 10 })))
    await waitFor(() => expect(CapturedWorker.instances).toHaveLength(1))
    const stale = CapturedWorker.instances[0]
    fireEvent.click(repeatToggle())
    expect(stale.terminate).toHaveBeenCalledOnce()
    act(() => stale.finish())
    expect(container.querySelector('.repeat-history')).toBeNull()
    fireEvent.click(processButton())
    act(() => CapturedWorker.instances[1].finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
    enableRepeat()
    await waitFor(() => expect(CapturedWorker.instances).toHaveLength(3))
    act(() => CapturedWorker.instances[2].finish())
    await importHandled()
    expect(historyTimes()).toHaveLength(1)
    expect(within(handledRegion()).getByText('previous.csv')).toBeTruthy()
    fireEvent.click(processButton())
    act(() => CapturedWorker.instances[3].finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('5')
  })

  it('keeps Step 1 filenames and the earlier comparison when moving a malformed report fails', async () => {
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'handled.csv', { 'Black sleeves': 10 })
    await markHandled(container)
    await upload(salesInput(container), file('malformed.csv', 'wrong,columns\nSomething,8'))
    fireEvent.click(moveButton())
    await screen.findByRole('alert')
    await waitFor(() => expect(moveButton().disabled).toBe(false))
    expect(historyTimes()).toHaveLength(1)
    expect(within(handledRegion()).getByText('handled.csv')).toBeTruthy()
    const currentUploads = salesInput(container).closest('.upload-column')!
    expect(within(currentUploads as HTMLElement).getByText('malformed.csv')).toBeTruthy()
    fireEvent.click(within(currentUploads as HTMLElement).getByRole('button', { name: 'Remove malformed.csv' }))
    await latest(container, 'current.csv', { 'Black sleeves': 15 })
    await process(container)
    expect(quantities(container, 'Black sleeves').pull).toBe('5')
  })

  it('retains a failed auto-import draft without retrying in a loop or consuming current sales', async () => {
    vi.stubGlobal('Worker', CapturedWorker)
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'current.csv', { 'Black sleeves': 15 })
    await upload(handledInput(), file('malformed.csv', 'wrong,columns\nSomething,10'))
    await waitFor(() => expect(CapturedWorker.instances).toHaveLength(1))
    const failed = CapturedWorker.instances[0]
    act(() => failed.onmessage?.({ data: { ok: false, error: 'Missing sales headers' } } as MessageEvent<ReportWorkerResult>))
    expect(screen.getByRole('alert').textContent).toContain('Missing sales headers')
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 60)) })
    expect(CapturedWorker.instances).toHaveLength(1)
    expect(historyTimes()).toHaveLength(0)
    expect(within(handledRegion()).getByText('malformed.csv')).toBeTruthy()
    expect(screen.getByText('current.csv')).toBeTruthy()
    expect(processButton().disabled).toBe(true)
    fireEvent.click(within(handledRegion()).getByRole('button', { name: 'Remove malformed.csv' }))
    expect(processButton().disabled).toBe(false)
    fireEvent.click(processButton())
    act(() => CapturedWorker.instances[1].finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('15')
  })

  it.each(['disable', 'clear'])('deduplicates rapid moves and rejects their late result after %s', async (action) => {
    vi.stubGlobal('Worker', CapturedWorker)
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    await latest(container, 'morning.csv', { 'Black sleeves': 10 })
    const move = moveButton()
    act(() => { move.click(); move.click(); move.click() })
    expect(CapturedWorker.instances).toHaveLength(1)
    expect(historyTimes()).toHaveLength(0)
    const stale = CapturedWorker.instances[0]
    if (action === 'disable') fireEvent.click(repeatToggle())
    else fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(stale.terminate).toHaveBeenCalledOnce()
    act(() => stale.finish())
    enableRepeat()
    expect(historyTimes()).toHaveLength(0)
    if (action === 'clear') {
      expect(screen.queryByText('morning.csv')).toBeNull()
      await upload(inventoryInput(container), file('new-inventory.csv', inventoryText))
      await latest(container, 'fresh.csv', { 'Black sleeves': 15 })
    } else {
      expect(screen.getByText('morning.csv')).toBeTruthy()
    }
    fireEvent.click(moveButton())
    expect(CapturedWorker.instances).toHaveLength(2)
    act(() => CapturedWorker.instances[1].finish())
    expect(historyTimes()).toHaveLength(1)
    expect(historyTimes()[0].closest('[hidden]')).toBeNull()
  })

  it('waits for every file in a handled upload batch before automatically saving one complete group', async () => {
    vi.stubGlobal('Worker', CapturedWorker)
    const { container } = render(<App />)
    enableRepeat()
    await upload(inventoryInput(container), file('inventory.csv', inventoryText))
    const pending = (name: string) => {
      let resolve!: (value: string) => void
      const text = new Promise<string>((done) => { resolve = done })
      const value = new File(['pending'], name, { type: 'text/csv' })
      Object.defineProperty(value, 'text', { value: () => text })
      return { value, resolve }
    }
    const first = pending('day-one.csv'), second = pending('day-two.csv')
    fireEvent.change(handledInput(), { target: { files: [first.value, second.value] } })
    await act(async () => { first.resolve(csv({ 'Black sleeves': 10 })) })
    expect(CapturedWorker.instances).toHaveLength(0)
    await act(async () => { second.resolve(csv({ 'Black sleeves': 5 })) })
    await waitFor(() => expect(CapturedWorker.instances).toHaveLength(1))
    expect(CapturedWorker.instances[0].request.sales.map((input) => input.name).sort()).toEqual(['day-one.csv', 'day-two.csv'])
    act(() => CapturedWorker.instances[0].finish())
    await importHandled()
    expect(historyTimes()).toHaveLength(1)
    expect(within(handledRegion()).getByText('day-one.csv')).toBeTruthy()
    expect(within(handledRegion()).getByText('day-two.csv')).toBeTruthy()
    await latest(container, 'latest.csv', { 'Black sleeves': 17 })
    fireEvent.click(processButton())
    act(() => CapturedWorker.instances[1].finish())
    expect(quantities(container, 'Black sleeves').pull).toBe('2')
  })
})
