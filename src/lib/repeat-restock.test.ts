import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import {
  applyReportSettings,
  buildBaseReport,
  DEFAULT_SETTINGS,
  normalizeName,
  type CsvInput,
  type HandledSalesTotal,
} from './restock'

type Row = [string, number]

function sales(rows: Row[], name = 'sales.csv'): CsvInput {
  return { name, text: Papa.unparse([['Products and Categories', 'Quantity'], ...rows]) }
}

function inventory(rows: Row[]): CsvInput {
  return { name: 'inventory.csv', text: Papa.unparse([['Product', 'Balance'], ...rows]) }
}

function handled(item: string, quantity: number, categories?: string[]): HandledSalesTotal {
  return { key: normalizeName(item), item, quantity, ...(categories ? { categories } : {}) }
}

const sleevesInventory = inventory([['Accessories >>Black Sleeves', 100]])

describe('repeat Soft restock', () => {
  it('compares each cumulative run with the handled totals: 10, then 5, then 2', () => {
    let baseline: HandledSalesTotal[] = []
    const pulls: number[] = []
    for (const quantity of [10, 15, 17]) {
      const report = buildBaseReport([sales([['Black Sleeves', quantity]])], sleevesInventory, baseline)
      pulls.push(report.matchedItems[0].qtyToPull)
      expect(report.matchedItems[0].qtySold).toBe(pulls.at(-1))
      expect(report.repeat?.latestTotals[0].quantity).toBe(quantity)
      baseline = report.repeat!.nextHandledTotals
    }
    expect(pulls).toEqual([10, 5, 2])
    expect(baseline[0].quantity).toBe(17)
  })

  it('adds nonoverlapping files within each run before comparing cumulative totals', () => {
    const first = buildBaseReport([
      sales([['Black Sleeves', 6]], 'previous-day.csv'),
      sales([['Black Sleeves', 4]], 'today-morning.csv'),
    ], sleevesInventory, [])
    const second = buildBaseReport([
      sales([['Black Sleeves', 6]], 'previous-day.csv'),
      sales([['Black Sleeves', 9]], 'today-afternoon.csv'),
    ], sleevesInventory, first.repeat!.nextHandledTotals)
    expect(second.matchedItems[0].qtyToPull).toBe(5)
    expect(second.repeat?.comparisons[0]).toEqual({
      key: 'black sleeves', item: 'Black Sleeves', latest: 15, handled: 10, additional: 5,
    })
    expect(second.salesFileNames).toEqual(['previous-day.csv', 'today-afternoon.csv'])
  })

  it('flags decreases and disappeared items, continues valid rows, and prevents a false rebound pull', () => {
    const stock = inventory([
      ['Accessories >>Black Sleeves', 100], ['Games >>Disappeared', 100], ['Games >>Valid', 100],
    ])
    const previous = [handled('Black Sleeves', 10), handled('Disappeared', 7), handled('Valid', 2)]
    const reduced = buildBaseReport([sales([['Black Sleeves', 8], ['Valid', 5]])], stock, previous)
    expect(reduced.matchedItems.map((item) => [item.item, item.qtyToPull])).toEqual([['Valid', 3]])
    expect(reduced.repeat?.comparisons.filter((row) => row.error).map((row) => [row.item, row.latest, row.additional]))
      .toEqual([['Black Sleeves', 8, 0], ['Disappeared', 0, 0]])
    expect(reduced.repeat?.nextHandledTotals.map((row) => [row.item, row.quantity]))
      .toEqual([['Black Sleeves', 10], ['Valid', 5], ['Disappeared', 7]])

    const rebound = buildBaseReport([sales([
      ['Black Sleeves', 10], ['Disappeared', 7], ['Valid', 6],
    ])], stock, reduced.repeat!.nextHandledTotals)
    expect(rebound.repeat?.comparisons.some((row) => row.error)).toBe(false)
    expect(rebound.matchedItems.map((item) => [item.item, item.qtyToPull])).toEqual([['Valid', 1]])
    expect(previous.map((row) => row.quantity)).toEqual([10, 7, 2])
  })

  it('includes new demand, omits unchanged/zero demand, and flags negative latest sales without a negative baseline', () => {
    const stock = inventory([
      ['Games >>New', 10], ['Games >>Unchanged', 10], ['Games >>Zero', 10], ['Games >>Returned', 10],
    ])
    const report = buildBaseReport([sales([
      ['New', 3], ['Unchanged', 5], ['Zero', 0], ['Returned', -2],
    ])], stock, [handled('Unchanged', 5)])
    expect(report.matchedItems.map((item) => [item.item, item.qtyToPull])).toEqual([['New', 3]])
    expect(report.repeat?.comparisons.find((row) => row.item === 'Returned')).toMatchObject({
      latest: -2, handled: 0, additional: 0, error: expect.any(String),
    })
    expect(report.repeat?.nextHandledTotals.find((row) => row.item === 'Returned')?.quantity).toBe(0)
  })

  it('keeps the stock cap and all Verify Stock cases while advancing by sales rather than physical pulls', () => {
    const stock = inventory([
      ['Games >>Limited', 3], ['Games >>Negative', -4], ['Games >>Zero', 0],
    ])
    const report = buildBaseReport([sales([
      ['Limited', 15], ['Negative', 15], ['Zero', 15], ['Missing', 15],
    ])], stock, ['Limited', 'Negative', 'Zero', 'Missing'].map((name) => handled(name, 10)))
    const display = applyReportSettings(report, DEFAULT_SETTINGS)
    expect(display.groups.flatMap((group) => group.items).map((item) => [item.item, item.qtySold, item.qtyToPull]))
      .toEqual([['Limited', 5, 3]])
    expect(display.verifyItems.map((item) => [item.item, item.qtySold, item.qtyToPull, item.currentStock, item.issue]))
      .toEqual([
        ['Negative', 5, 0, -4, 'negative-stock'],
        ['Zero', 5, 0, 0, 'zero-stock'],
        ['Missing', 5, 0, null, 'not-found'],
      ])
    expect(report.repeat?.nextHandledTotals.every((total) => total.quantity === 15)).toBe(true)
  })

  it('tracks all sales despite user ignore and Singles/Misc filters so later preference changes cannot re-pull them', () => {
    const stock = inventory([
      ['Accessories >>Black Sleeves', 100], ['Food >>Pretzels', 100],
      ['Cards >>Singles >>Card', 100], ['Supplies >>Misc. Supply', 100],
    ])
    const inputs = [sales([['Black Sleeves', 10], ['Pretzels', 10], ['Card', 10], ['Misc. Supply', 10]])]
    const first = buildBaseReport(inputs, stock, [])
    expect(applyReportSettings(first, DEFAULT_SETTINGS).restockItemCount).toBe(1)
    expect(first.repeat?.nextHandledTotals).toHaveLength(4)
    const repeat = buildBaseReport(inputs, stock, first.repeat!.nextHandledTotals)
    const unfiltered = applyReportSettings(repeat, { ...DEFAULT_SETTINGS, includeMiscAndSingles: true, ignoreText: '' })
    expect(unfiltered.restockItemCount).toBe(0)
    expect(unfiltered.verifyItems).toEqual([])
  })

  it('keeps permanent exclusions out of comparison rows and errors while preserving ordinary duplicate balances', () => {
    const stock = inventory([
      ['Z Online Sales >>Hidey Hole >>[HH] Hidden', 100],
      ['Z Online Sales >>Other >>[HH] Marked', 100],
      ['Z Online Sales >>Hidey Hole >>[HH] Mixed', 100],
      ['Accessories >>Mixed', 2], ['Accessories >>Mixed', 3],
      ['Events >>Entry Ticket', 10], ['Club Memberships >>Member Benefit', 10],
      ['Games >>Level Up Discount', 10], ['Games >>Teacher/Librarian Discount', 10], ['Games >>Employee', 10],
    ])
    const first = buildBaseReport([sales([
      ['Hidden', 10], ['Marked', 10], ['Mixed', 10], ['Entry Ticket', 10], ['Member Benefit', 10],
      ['Level Up Discount', 10], ['Teacher/Librarian Discount', 10], ['Employee', 10],
    ])], stock, [])
    expect(first.repeat?.latestTotals.map((total) => total.item)).toEqual(['Mixed'])
    expect(first.matchedItems.map((item) => [item.item, item.currentStock, item.qtyToPull])).toEqual([['Mixed', 5, 5]])
    expect(first.duplicateInventoryProductNames).toEqual(['Mixed'])

    const oldTotals = [
      handled('Hidden', 10), handled('Marked', 10), handled('Entry Ticket', 10),
      handled('Member Benefit', 10), handled('Level Up Discount', 10),
      handled('Teacher/Librarian Discount', 10), handled('Employee', 10),
      handled('Old Hidden', 10, ['Hidey Hole']), handled('[HH] Old Marked', 10),
      handled('Old Event', 10, ['Events']), handled('Old Member', 10, ['Club Memberships']),
    ]
    const second = buildBaseReport([sales([['Mixed', 11]])], stock, [...first.repeat!.nextHandledTotals, ...oldTotals])
    expect(second.repeat?.comparisons).toEqual([{ key: 'mixed', item: 'Mixed', latest: 11, handled: 10, additional: 1 }])
    expect(second.repeat?.nextHandledTotals.filter((total) => !total.excluded)).toHaveLength(1)
    expect(second.repeat?.nextHandledTotals.filter((total) => total.excluded)).toHaveLength(oldTotals.length)
    expect(second.unmatchedItems).toEqual([])
  })

  it('retains handled sales internally through an HH-only inventory interval without printing or re-pulling them', () => {
    const ordinary = inventory([['Accessories >>Mixed', 50], ['Hidey Hole >>[HH] Mixed', 100]])
    const hiddenOnly = inventory([['Hidey Hole >>[HH] Mixed', 100]])
    const first = buildBaseReport([sales([['Mixed', 10]])], ordinary, [])
    const excluded = buildBaseReport([sales([['Mixed', 15]])], hiddenOnly, first.repeat!.nextHandledTotals)
    expect(excluded.matchedItems).toEqual([])
    expect(excluded.unmatchedItems).toEqual([])
    expect(excluded.repeat?.latestTotals).toEqual([])
    expect(excluded.repeat?.comparisons).toEqual([])
    expect(excluded.repeat?.nextHandledTotals).toEqual([
      { key: 'mixed', item: 'Mixed', quantity: 15, categories: ['Accessories'], excluded: true },
    ])
    const returned = buildBaseReport([sales([['Mixed', 17]])], ordinary, excluded.repeat!.nextHandledTotals)
    expect(returned.matchedItems[0].qtyToPull).toBe(2)
    expect(returned.repeat?.nextHandledTotals[0].excluded).toBeUndefined()
    expect(returned.repeat?.nextHandledTotals[0].quantity).toBe(17)
  })

  it('uses current ordinary inventory categories instead of stale excluded handled categories', () => {
    const stock = inventory([['Accessories >>Returned', 50]])
    const report = buildBaseReport([sales([['Returned', 12]])], stock, [
      { ...handled('Returned', 10, ['Hidey Hole']), excluded: true },
    ])
    expect(report.matchedItems[0].qtyToPull).toBe(2)
    expect(report.repeat?.comparisons).toHaveLength(1)
    expect(report.repeat?.nextHandledTotals).toEqual([
      { key: 'returned', item: 'Returned', quantity: 12, categories: ['Accessories'] },
    ])
  })

  it('matches normalized product names across runs and survives worker-style serialization', () => {
    const first = buildBaseReport([sales([['  BLACK   SLEEVES ', 10]])], sleevesInventory, [])
    const restored: HandledSalesTotal[] = JSON.parse(JSON.stringify(first.repeat!.nextHandledTotals))
    const second = buildBaseReport([sales([['Black Sleeves', 15]])], sleevesInventory, restored)
    expect(second.matchedItems[0].qtyToPull).toBe(5)
    expect(structuredClone(second)).toEqual(second)
    expect(JSON.parse(JSON.stringify(second.repeat))).toEqual(second.repeat)
  })

  it('does not flag an unchanged decimal total because prior files were summed separately', () => {
    const first = buildBaseReport([
      sales([['Black Sleeves', 0.1]], 'first.csv'), sales([['Black Sleeves', 0.2]], 'second.csv'),
    ], sleevesInventory, [])
    const second = buildBaseReport([sales([['Black Sleeves', 0.3]])], sleevesInventory, first.repeat!.nextHandledTotals)
    expect(second.repeat?.comparisons[0].additional).toBe(0)
    expect(second.repeat?.comparisons[0].error).toBeUndefined()
    expect(second.matchedItems).toEqual([])
  })

  it('preserves the ordinary report shape and results when repeat processing is omitted', () => {
    const inputs = [sales([['Black Sleeves', 10]])]
    const normal = buildBaseReport(inputs, sleevesInventory)
    expect(normal).toEqual({
      matchedItems: [{
        key: 'black sleeves', item: 'Black Sleeves', categories: ['Accessories'], categoryLabel: 'Accessories',
        currentStock: 100, qtySold: 10, qtyToPull: 10, firstSeen: 0, isMiscOrSingle: false, issue: undefined,
      }],
      unmatchedItems: [], ignoredReportRows: 0, duplicateInventoryNames: 0,
      duplicateInventoryProductNames: [], inventoryRows: 1, salesRows: 1, warnings: [],
      salesFileNames: ['sales.csv'], inventoryFileName: 'inventory.csv',
    })
    expect(Object.hasOwn(normal, 'repeat')).toBe(false)
    expect(buildBaseReport(inputs, sleevesInventory, undefined)).toEqual(normal)
    const { repeat, ...firstRepeat } = buildBaseReport(inputs, sleevesInventory, [])
    expect(repeat).toBeDefined()
    expect(firstRepeat).toEqual(normal)
  })
})
