// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const hardStorage = 'rrg-restock-helper-hard-settings-v1'
const inventoryText = 'Product,Balance\nBoard Games >>A >>Alpha,4\nBoard Games >>A >>Zero,0\nBoard Games >>A >>Negative,-2'

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(hardStorage, JSON.stringify({ selectedCategories: [JSON.stringify(['Board Games'])] }))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })))
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.stubGlobal('Worker', undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function upload(input: HTMLInputElement, name: string, text: string) {
  const file = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(text) })
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
}

describe('Soft and Hard share inventory without sharing report choices', () => {
  it('starts on Soft and builds Hard using the existing inventory with no sales file', async () => {
    const { container } = render(<App />)
    expect(screen.getByRole('tab', { name: /Soft/i }).getAttribute('aria-selected')).toBe('true')
    await upload(container.querySelector('input[type=file]:not([multiple])')!, 'inventory.csv', inventoryText)
    fireEvent.click(screen.getByRole('tab', { name: /Hard/i }))
    await waitFor(() => expect(container.querySelectorAll('#hard-panel .hard-row[data-key]')).toHaveLength(3))
    expect(within(document.getElementById('hard-panel')!).getByText('inventory.csv')).toBeTruthy()
    expect(document.getElementById('soft-panel')!.hidden).toBe(true)
    expect(container.querySelector('#hard-panel .hard-row[data-key]')?.textContent).toContain('Alpha')
  })

  it('retains the Soft report and Hard filters across keyboard tab switches', async () => {
    const { container } = render(<App />)
    await upload(container.querySelector('input[multiple]')!, 'sales.csv', 'Products and Categories,Quantity\nBoard Games,1\nA,1\nAlpha,1')
    await upload(container.querySelector('input[type=file]:not([multiple])')!, 'inventory.csv', inventoryText)
    fireEvent.click(screen.getByRole('button', { name: 'Process Reports' }))
    await screen.findByText('1 items ready to restock')
    const original = container.querySelector('#soft-panel .report-card')
    fireEvent.keyDown(screen.getByRole('tab', { name: /Soft/i }), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Hard/i }))
    await waitFor(() => expect(container.querySelectorAll('#hard-panel .hard-row[data-key]')).toHaveLength(3))
    fireEvent.click(screen.getByRole('checkbox', { name: /Negative stock only/i }))
    await waitFor(() => expect(container.querySelectorAll('#hard-panel .hard-row[data-key]')).toHaveLength(1))
    fireEvent.keyDown(screen.getByRole('tab', { name: /Hard/i }), { key: 'Home' })
    expect(container.querySelector('#soft-panel .report-card')).toBe(original)
    expect(document.getElementById('hard-panel')!.hidden).toBe(true)
    fireEvent.click(screen.getByRole('tab', { name: /Hard/i }))
    expect((screen.getByRole('checkbox', { name: /Negative stock only/i }) as HTMLInputElement).checked).toBe(true)
  })

  it('invalidates the Hard report immediately when shared inventory is removed', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /Hard/i }))
    await upload(container.querySelector('#hard-panel input[type=file]')!, 'inventory.csv', inventoryText)
    await waitFor(() => expect(container.querySelectorAll('#hard-panel .hard-row[data-key]')).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: 'Remove inventory.csv' }))
    expect(container.querySelector('#hard-panel .hard-report-card')).toBeNull()
    expect(JSON.parse(localStorage.getItem(hardStorage)!).selectedCategories).toEqual([JSON.stringify(['Board Games'])])
  })
})
