// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { buildBaseReport } from './lib/restock'
import * as restock from './lib/restock'
import type { ReportWorkerResult } from './report.worker'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('Worker', undefined)
})

const salesText = 'Products and Categories,Quantity\nSynthetic,2'
const inventoryText = 'Product,Balance\nGames >>Synthetic,4'
const sampleReport = () => buildBaseReport([{ name: 'sales.csv', text: salesText }], { name: 'inventory.csv', text: inventoryText })
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<ReportWorkerResult>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
}
async function loadReports(container: HTMLElement) {
  const sale = pendingFile('sales.csv'), inventory = pendingFile('inventory.csv')
  upload(container, 'sales', [sale.file]); upload(container, 'inventory', [inventory.file])
  await act(async () => { sale.resolve(salesText); inventory.resolve(inventoryText) })
}

describe('background report lifecycle', () => {
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker) })

  it('starts only one worker for rapid repeated processing clicks', async () => {
    const { container } = render(<App />)
    await loadReports(container)
    const button = screen.getByRole('button', { name: 'Process Reports' })
    act(() => { button.click(); button.click(); button.click() })
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].postMessage).toHaveBeenCalledOnce()
  })

  it('discards queued fallback work after unmount and deduplicates rapid fallback clicks', async () => {
    vi.stubGlobal('Worker', undefined)
    vi.useFakeTimers()
    const parser = vi.spyOn(restock, 'buildBaseReport')
    const { container, unmount } = render(<App />)
    await loadReports(container)
    const button = screen.getByRole('button', { name: 'Process Reports' })
    act(() => { button.click(); button.click(); button.click() })
    unmount()
    await act(async () => { vi.runAllTimers() })
    expect(parser).not.toHaveBeenCalled()
  })

  it('terminates a worker whose postMessage fails before using the local fallback', async () => {
    vi.stubGlobal('Worker', class extends FakeWorker { postMessage = vi.fn(() => { throw new DOMException('Cannot clone', 'DataCloneError') }) })
    const { container } = render(<App />)
    await loadReports(container)
    fireEvent.click(screen.getByRole('button', { name: 'Process Reports' }))
    await screen.findByText('1 items ready to restock')
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce()
  })

  it('terminates work on newer input and reset, and ignores late worker messages', async () => {
    const { container } = render(<App />)
    await loadReports(container)
    fireEvent.click(screen.getByRole('button', { name: 'Process Reports' }))
    const first = FakeWorker.instances[0]
    const next = pendingFile('replacement.csv'); upload(container, 'inventory', [next.file])
    expect(first.terminate).toHaveBeenCalledOnce()
    await act(async () => { first.onmessage?.({ data: { ok: true, report: sampleReport() } } as MessageEvent<ReportWorkerResult>); next.resolve(inventoryText) })
    expect(screen.queryByText(/items ready to restock/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Process Reports' }))
    const second = FakeWorker.instances[1]
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(second.terminate).toHaveBeenCalledOnce()
    await act(async () => { second.onmessage?.({ data: { ok: false, error: 'stale error' } } as MessageEvent<ReportWorkerResult>) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.querySelector('.report-card')).toBeNull()
  })

  it('shows parser errors and falls back to the same parser after worker startup failure', async () => {
    const { container } = render(<App />)
    await loadReports(container)
    fireEvent.click(screen.getByRole('button', { name: 'Process Reports' }))
    await act(async () => { FakeWorker.instances[0].onmessage?.({ data: { ok: false, error: 'Synthetic parser error' } } as MessageEvent<ReportWorkerResult>) })
    expect(screen.getByRole('alert').textContent).toContain('Synthetic parser error')
    fireEvent.click(screen.getByRole('button', { name: 'Process Reports' }))
    const worker = FakeWorker.instances[1]
    await act(async () => { worker.onerror?.({ preventDefault: vi.fn() } as unknown as ErrorEvent) })
    await screen.findByText('1 items ready to restock')
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(container.querySelector('.report-item-name')?.textContent).toBe('Synthetic')
  })

  it('retains local processing when a browser rejects worker construction', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new DOMException('Blocked by policy', 'SecurityError') } })
    const { container } = render(<App />)
    await loadReports(container)
    fireEvent.click(screen.getByRole('button', { name: 'Process Reports' }))
    await screen.findByText('1 items ready to restock')
    expect(container.querySelector('.qty-to-pull')?.textContent).toBe('2')
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

function pendingFile(name: string) {
  let resolve!: (text: string) => void
  let reject!: (reason: Error) => void
  const result = new Promise<string>((yes, no) => { resolve = yes; reject = no })
  const file = new File(['pending'], name, { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: () => result })
  return { file, resolve, reject }
}
function upload(container: HTMLElement, kind: 'sales' | 'inventory', files: File[]) {
  fireEvent.change(container.querySelector(kind === 'sales' ? 'input[multiple]' : 'input[type=file]:not([multiple])')!, { target: { files } })
}

describe('file intake lifecycle', () => {
  it('shows real pending feedback, preserves concurrent sales, and keeps the latest inventory choice', async () => {
    const { container } = render(<App />)
    const saleA = pendingFile('sales-a.csv'), saleB = pendingFile('sales-b.csv')
    const oldInventory = pendingFile('old.csv'), newInventory = pendingFile('new.csv')
    upload(container, 'sales', [saleA.file]); upload(container, 'sales', [saleB.file])
    upload(container, 'inventory', [oldInventory.file]); upload(container, 'inventory', [newInventory.file])
    expect(screen.getByRole('button', { name: 'Process Reports' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Reading 2 files…')).toBeTruthy()
    await act(async () => { newInventory.resolve('Product,Balance'); saleB.resolve('Products and Categories,Quantity') })
    expect(screen.getByText('new.csv')).toBeTruthy()
    await act(async () => { oldInventory.resolve('Product,Balance'); saleA.resolve('Products and Categories,Quantity') })
    expect(screen.queryByText('old.csv')).toBeNull()
    expect(screen.getByText('sales-a.csv')).toBeTruthy()
    expect(screen.getByText('sales-b.csv')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Process Reports' }).hasAttribute('disabled')).toBe(false)
  })

  it('ignores late reads and errors after Clear all, including when new files are already reading', async () => {
    const { container } = render(<App />)
    const staleSale = pendingFile('stale.csv'), staleInventory = pendingFile('stale-inventory.csv'), freshSale = pendingFile('fresh.csv')
    upload(container, 'sales', [staleSale.file]); upload(container, 'inventory', [staleInventory.file])
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    upload(container, 'sales', [freshSale.file])
    await act(async () => { staleSale.resolve('old'); staleInventory.reject(new Error('old failure')) })
    expect(screen.queryByText('stale.csv')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Reading 1 file…')).toBeTruthy()
    await act(async () => { freshSale.resolve('new') })
    expect(screen.getByText('fresh.csv')).toBeTruthy()
    expect(container.querySelector('[aria-busy=true]')).toBeNull()
  })

  it('recovers from a failed read without leaving intake busy', async () => {
    const { container } = render(<App />)
    const file = pendingFile('unreadable.csv')
    upload(container, 'sales', [file.file])
    await act(async () => { file.reject(new Error('unreadable')) })
    expect(screen.getByRole('alert').textContent).toContain('could not be read')
    expect(container.querySelector('[aria-busy=true]')).toBeNull()
  })
})
