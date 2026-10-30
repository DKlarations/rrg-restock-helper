// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HardRestockPanel from './HardRestockPanel'
import { parseHardInventory } from './lib/hard-restock'
import type { HardWorkerResult } from './hard-report.worker'
import type { CsvInput } from './lib/restock'

const source: CsvInput = { name: 'Synthetic-inventory.csv', text: `Product,Balance
Board Games >> A >> Alpha,3
Board Games >> A >> Empty Game,0
Board Games >> A >> Negative Game,-2
Board Games >> A >> Repeated Game,2
Board Games >> A >> Repeated Game,7
Board Games >> B >> Beta,4
Paint >> Painting Accessories >> Brush,3
Paint >> AK Interactive >> Paint Marker,3
D&A >> Dice >> Standard Dice,2
Deactivate >> Old Game,1
Z Online Sales >> Board Games >> Online Game,2
Z Online Sales >> 1_Hidey Hole >> Secret Stock,9
` }
const rows = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.hard-row[data-key]')]
const props = { inventory: source, inventoryControl: <div>Shared inventory upload</div>, busy: false, active: true }

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('Worker', undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Hard category checklist', () => {
  it('needs no sales report, retains raw duplicate entries, and filters zero/negative stock independently', async () => {
    const { container } = render(<HardRestockPanel {...props} />)
    await screen.findByText('Inventory ready.')
    expect(rows(container)).toHaveLength(0)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Board Games › A' }))
    expect(rows(container)).toHaveLength(5)
    const repeats = rows(container).filter((row) => row.textContent?.includes('Repeated Game'))
    expect(repeats.map((row) => row.querySelector('.hard-current-stock')?.textContent)).toEqual(['2', '7'])
    expect(new Set(repeats.map((row) => row.dataset.key)).size).toBe(2)
    expect(container.querySelectorAll('.hard-paper-checkbox')).toHaveLength(15)
    expect(container.querySelector('.hard-report-card')?.querySelector('input')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /inventory negative/i })).toBeNull()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include zero-stock items' }))
    expect(rows(container)).toHaveLength(4)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Negative stock only' }))
    expect(rows(container)).toHaveLength(1)
    expect(rows(container)[0].querySelector('.hard-current-stock')?.textContent).toBe('-2')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Negative stock only' }))
    expect(rows(container)).toHaveLength(4)
    expect(screen.queryByRole('checkbox', { name: /Hidey Hole/ })).toBeNull()
  })

  it('searches detailed category paths, marks partial parents, and includes a selected whole branch once', async () => {
    const { container } = render(<HardRestockPanel {...props} />)
    await screen.findByText('Inventory ready.')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search categories' }), { target: { value: 'Board Games' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Board Games › A' }))
    expect((screen.getByRole('checkbox', { name: 'Board Games' }) as HTMLInputElement).indeterminate).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Board Games' }))
    expect(rows(container)).toHaveLength(6)
    expect((screen.getByRole('checkbox', { name: 'Board Games › A' }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Clear category selection' }))
    expect(rows(container)).toHaveLength(0)
  })

  it('keeps exclusions configurable and painting accessories available, then persists independent preferences', async () => {
    const { container } = render(<HardRestockPanel {...props} />)
    await screen.findByText('Inventory ready.')
    fireEvent.click(screen.getByRole('button', { name: 'Select all categories' }))
    expect(rows(container).some((row) => row.textContent?.includes('Brush'))).toBe(true)
    expect(rows(container).some((row) => row.textContent?.includes('Paint Marker'))).toBe(false)
    fireEvent.click(screen.getByText('Hard Report & Print Settings'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exclude paint and paint markers' }))
    expect(rows(container).some((row) => row.textContent?.includes('Paint Marker'))).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exclude dice' }))
    expect(rows(container).some((row) => row.textContent?.includes('Standard Dice'))).toBe(true)
    const saved = JSON.parse(localStorage.getItem('rrg-restock-helper-hard-settings-v1')!)
    expect(saved.excludePaint).toBe(false)
    expect(saved.excludeDice).toBe(false)
    expect(saved.selectedCategories.length).toBeGreaterThan(0)
    expect(localStorage.getItem('rrg-restock-helper-settings-v8')).toBeNull()
  })

  it('restores saved categories but invalidates stale results immediately when inventory changes or is removed', async () => {
    localStorage.setItem('rrg-restock-helper-hard-settings-v1', JSON.stringify({ selectedCategories: ['["Board Games"]'] }))
    const { container, rerender } = render(<HardRestockPanel {...props} />)
    await screen.findByText('Inventory ready.')
    expect(rows(container)).toHaveLength(6)
    rerender(<HardRestockPanel {...props} busy />)
    expect(rows(container)).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Print Hard Checklist' })).toBeNull()
    rerender(<HardRestockPanel {...props} inventory={null} />)
    expect(rows(container)).toHaveLength(0)
    rerender(<HardRestockPanel {...props} inventory={{ name: 'replacement.csv', text: 'Product,Balance\nBoard Games >> C >> Replacement,8' }} />)
    await screen.findByText('Inventory ready.')
    expect(rows(container)).toHaveLength(1)
    expect(rows(container)[0].textContent).toContain('Replacement')
  })

  it('does not parse while inactive and survives malformed or unavailable preference storage', async () => {
    localStorage.setItem('rrg-restock-helper-hard-settings-v1', '{broken')
    const { rerender } = render(<HardRestockPanel {...props} active={false} />)
    expect(screen.queryByText('Inventory ready.')).toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    rerender(<HardRestockPanel {...props} />)
    await screen.findByText('Inventory ready.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include zero-stock items' }))
    expect(screen.getByText(/Preferences cannot be saved/)).toBeTruthy()
  })

  it('keeps Uncategorized separate from ordinary category selection', async () => {
    const { container } = render(<HardRestockPanel {...props} inventory={{ name: 'uncategorized.csv', text: 'Product,Balance\nLoose Item,3\nBoard Games >> A >> Categorized Item,2' }} />)
    await screen.findByText('Inventory ready.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Uncategorized' }))
    expect(rows(container)).toHaveLength(1)
    expect((screen.getByRole('checkbox', { name: 'Board Games' }) as HTMLInputElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Board Games' }))
    expect(rows(container)).toHaveLength(2)
  })
})

describe('Hard inventory worker lifecycle', () => {
  class FakeWorker {
    static instances: FakeWorker[] = []
    onmessage: ((event: MessageEvent<HardWorkerResult>) => void) | null = null
    onerror: ((event: ErrorEvent) => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
    constructor() { FakeWorker.instances.push(this) }
  }
  beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker) })

  it('ignores late worker results after a newer inventory is uploaded', async () => {
    const { rerender } = render(<HardRestockPanel {...props} />)
    const old = FakeWorker.instances[0]
    const next = { name: 'new.csv', text: 'Product,Balance\nBoard Games >> C >> New Game,1' }
    rerender(<HardRestockPanel {...props} inventory={next} />)
    expect(old.terminate).toHaveBeenCalled()
    await act(async () => { old.onmessage?.({ data: { ok: true, inventory: parseHardInventory(source) } } as MessageEvent<HardWorkerResult>) })
    expect(screen.queryByText('Inventory ready.')).toBeNull()
    const current = FakeWorker.instances[1]
    await act(async () => { current.onmessage?.({ data: { ok: true, inventory: parseHardInventory(next) } } as MessageEvent<HardWorkerResult>) })
    await screen.findByText('Inventory ready.')
    expect(screen.getByRole('checkbox', { name: 'Board Games › C' })).toBeTruthy()
    expect(screen.queryByRole('checkbox', { name: 'Board Games › A' })).toBeNull()
  })

  it('falls back locally after worker failure and shows meaningful invalid CSV errors', async () => {
    const { rerender } = render(<HardRestockPanel {...props} />)
    await act(async () => { FakeWorker.instances[0].onerror?.({ preventDefault() {} } as ErrorEvent) })
    await screen.findByText('Inventory ready.')
    rerender(<HardRestockPanel {...props} inventory={{ name: 'wrong.csv', text: 'Wrong,Headers\nA,B' }} />)
    await act(async () => { FakeWorker.instances[1].onerror?.({ preventDefault() {} } as ErrorEvent) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Product|Balance/))
  })
})
