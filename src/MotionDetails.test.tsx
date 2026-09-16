// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MotionDetails from './MotionDetails'

type TestAnimation = { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }
const animations: TestAnimation[] = []
let reduced = false
const mediaListeners = new Set<() => void>()
const mediaQuery = {
  get matches() { return reduced },
  media: '(prefers-reduced-motion: reduce)',
  addEventListener: (_event: string, callback: () => void) => mediaListeners.add(callback),
  removeEventListener: (_event: string, callback: () => void) => mediaListeners.delete(callback),
}

beforeEach(() => {
  reduced = false
  animations.length = 0
  vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery))
  // Hold the browser-owned animation open so the adapter's exit retention is observable.
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      const animation: TestAnimation = { cancel: vi.fn(), onfinish: null }
      animations.push(animation)
      return animation
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})

function disclosure(container: HTMLElement) {
  const details = container.querySelector('details')!
  const summary = container.querySelector('summary')!
  const body = document.getElementById(summary.getAttribute('aria-controls')!)!
  return { details, summary, body }
}

async function clickSummary(summary: HTMLElement) {
  await act(async () => { fireEvent.click(summary) })
}

async function finish(animation = animations.at(-1)) {
  await act(async () => { animation?.onfinish?.() })
}

describe('MotionDetails native disclosure integration', () => {
  it('starts closed with retained inaccessible content and one native summary', () => {
    const { container } = render(<MotionDetails summary="Duplicate inventory names" id="duplicates" className="warning-details">
      <textarea aria-label="Ignore list" defaultValue="Retained draft" />
    </MotionDetails>)
    const { details, summary, body } = disclosure(container)
    expect(details.open).toBe(false)
    expect(summary.parentElement).toBe(details)
    expect(summary.querySelector('button')).toBeNull()
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(body.id).toBe('duplicates')
    expect(body.hidden).toBe(true)
    expect(body.hasAttribute('inert')).toBe(true)
    expect(body.getAttribute('aria-hidden')).toBe('true')
    expect(details.classList.contains('warning-details')).toBe(true)
    expect((screen.getByLabelText('Ignore list') as HTMLTextAreaElement).value).toBe('Retained draft')
    expect(animations).toHaveLength(0)
  })

  it('keeps initially expanded content static, even under StrictMode and child updates', () => {
    const view = render(<StrictMode><MotionDetails summary="Print settings" defaultOpen>
      <input aria-label="Notes" defaultValue="Draft" />
    </MotionDetails></StrictMode>)
    const { summary, body } = disclosure(view.container)
    const input = screen.getByLabelText('Notes')
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(body.hidden).toBe(false)
    expect(animations).toHaveLength(0)
    view.rerender(<StrictMode><MotionDetails summary="Print settings" defaultOpen>
      <input aria-label="Notes" defaultValue="Draft" />
      <p role="alert">A longer validation message now occupies several lines.</p>
    </MotionDetails></StrictMode>)
    expect(screen.getByLabelText('Notes')).toBe(input)
    expect(screen.getByRole('alert').textContent).toContain('longer validation')
    expect(animations).toHaveLength(0)
  })

  it('restores focus immediately and retains drafts while native details awaits the exit', async () => {
    const { container } = render(<MotionDetails summary="Ignore list" defaultOpen>
      <textarea aria-label="Ignored products" defaultValue="Original" />
    </MotionDetails>)
    const { details, summary, body } = disclosure(container)
    const input = screen.getByLabelText('Ignored products') as HTMLTextAreaElement
    fireEvent.change(input, { target: { value: 'Edited draft' } })
    input.focus()
    await clickSummary(summary)
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(body.hasAttribute('inert')).toBe(true)
    expect(body.getAttribute('aria-hidden')).toBe('true')
    expect(document.activeElement).toBe(summary)
    expect(details.open).toBe(true)
    await finish()
    expect(details.open).toBe(false)
    expect(body.hidden).toBe(true)
    await clickSummary(summary)
    expect(details.open).toBe(true)
    expect(body.hidden).toBe(false)
    expect(body.hasAttribute('inert')).toBe(false)
    expect(screen.getByLabelText('Ignored products')).toBe(input)
    expect(input.value).toBe('Edited draft')
    await finish()
  })

  it('settles rapid close and reopen on the newest state without losing child identity', async () => {
    const { container } = render(<MotionDetails summary="Options" defaultOpen>
      <input aria-label="Option" defaultValue="unchanged" />
    </MotionDetails>)
    const { details, summary, body } = disclosure(container)
    const input = screen.getByLabelText('Option')
    await clickSummary(summary)
    const closing = animations.at(-1)!
    await clickSummary(summary)
    await finish(closing)
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(details.open).toBe(true)
    expect(body.hidden).toBe(false)
    expect(body.hasAttribute('inert')).toBe(false)
    expect(screen.getByLabelText('Option')).toBe(input)
    await finish()
    expect(details.open).toBe(true)
  })

  it('honors native open changes without mistaking retained exits for another opening', async () => {
    const { container } = render(<MotionDetails summary="Duplicate names"><p>Complete list</p></MotionDetails>)
    const { details, summary, body } = disclosure(container)
    await act(async () => {
      details.open = true
      fireEvent(details, new Event('toggle'))
    })
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(body.hidden).toBe(false)
    await finish()
    await act(async () => {
      details.open = false
      fireEvent(details, new Event('toggle'))
    })
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(body.hasAttribute('inert')).toBe(true)
    expect(details.open).toBe(true)
    await finish()
    expect(details.open).toBe(false)
    expect(body.hidden).toBe(true)
  })

  it('ignores delayed native toggle notifications after the newest close or reopen', async () => {
    const { container } = render(<MotionDetails summary="Settings" defaultOpen><input aria-label="Retained field" /></MotionDetails>)
    const { details, summary, body } = disclosure(container)
    await clickSummary(summary)
    const closing = animations.at(-1)!
    await clickSummary(summary)
    await act(async () => { fireEvent(details, new Event('toggle')) })
    await finish(closing)
    expect(details.open).toBe(true)
    expect(summary.getAttribute('aria-expanded')).toBe('true')
    expect(body.hidden).toBe(false)
    await finish()
    await clickSummary(summary)
    await finish()
    await act(async () => { fireEvent(details, new Event('toggle')) })
    expect(details.open).toBe(false)
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(body.hidden).toBe(true)
  })

  it('settles live reduced motion immediately, with no hidden wait before reopening', async () => {
    const { container } = render(<MotionDetails summary="Settings" defaultOpen><input aria-label="Setting" /></MotionDetails>)
    const { details, summary, body } = disclosure(container)
    await clickSummary(summary)
    expect(details.open).toBe(true)
    await act(async () => {
      reduced = true
      mediaListeners.forEach((listener) => listener())
    })
    expect(details.open).toBe(false)
    expect(body.hidden).toBe(true)
    const count = animations.length
    await clickSummary(summary)
    expect(details.open).toBe(true)
    expect(body.hidden).toBe(false)
    expect(body.hasAttribute('inert')).toBe(false)
    expect(animations).toHaveLength(count)
  })
})
