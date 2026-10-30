import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyReportSettings,
  buildBaseReport,
  DEFAULT_SETTINGS,
  normalizeName,
  splitReportGroups,
  splitReportIntoParts,
  type ReportGroup,
  type RestockItem,
} from './restock'

const inventory = `Product,Balance
0_Processing >>Widget A,3.0000
0_Processing >>Misc. Supply,3.0000
Board Games >>F >>Flamecraft Duals - Deluxe Kickstarter Edition,2.0000
CCGs >>Pokemon >>Singles >>Pikachu - 1/100 | NM,4.0000
Food >>Pretzels,10.0000
Ad Hoc Merch >>Ad Hoc Thing,3.0000
D&A >>Dice >>D&A Thing,3.0000
Rental >>Rental Copy,0.0000
Mini >>Games >>Duplicate Item,2.0000
Mini >>Games >>Duplicate Item,3.0000
Mini >>Games >>Collector Singles Bundle,3.0000
Mini >>Misc. >>Mystery Pin,3.0000
Mini >>Games >>Broken Stock,-1.0000
Events >>Friday Night Event,20.0000
Z Online Sales >>1_Hidey Hole >>[HH] Hidey Only Product,9.0000
Z Online Sales >>Other CCG's >>[HH] Marker Only Product,7.0000
Z Online Sales >>1_Hidey Hole >>[HH] Mixed Location Product,20.0000
Mini >>Games >>Mixed Location Product,2.0000
`

const sales = `Products and Categories,Quantity
0_Processing,4.00
Widget A,4.00
Misc. Supply,1.00
Board Games,1.00
F,1.00
Flamecraft Duals - Deluxe Kickstarter Edition,1.00
CCGs,1.00
Pokemon,1.00
Singles,1.00
Pikachu - 1/100 | NM,1.00
Food,1.00
Pretzels,1.00
Ad Hoc Merch,1.00
Ad Hoc Thing,1.00
D&A,1.00
Dice,1.00
D&A Thing,1.00
Events,2.00
Friday Night Event,1.00
Unlisted Event Ticket,1.00
Club Memberships,3.00
Level Up Discount,1.00
Teacher/Librarian Discount,1.00
Employee,1.00
Mini,4.00
Games,4.00
Duplicate Item,2.00
Collector Singles Bundle,1.00
Misc.,1.00
Mystery Pin,1.00
Broken Stock,1.00
Not In Inventory,1.00
Tickets,1.00
Pokemon Mega Monday Mayhem Tournament Play [08/10/2026] Pokemon Mega Monday Mayhem,1.00
Ravenloft Dungeons and Dragons Campaign [08/09/2026] Ravenloft Campaign,1.00
Rental,2.00
Rental Copy,1.00
Unlisted Rental Item,1.00
Hidey Only Product,1.00
Marker Only Product,1.00
Mixed Location Product,5.00
Total Sales $100.00,
`

function makeGroup(label: string, count: number, issue?: RestockItem['issue']): ReportGroup {
  const categoryKey = normalizeName(label)
  return {
    key: categoryKey,
    label,
    items: Array.from({ length: count }, (_, index) => ({
      key: `${categoryKey}-${index}`,
      item: `${label} Item ${index + 1}`,
      categories: [label.split(' › ')[0]],
      categoryLabel: label,
      currentStock: issue === 'not-found' ? null : issue ? 0 : 10,
      qtySold: 1,
      qtyToPull: issue ? 0 : 1,
      firstSeen: index,
      isMiscOrSingle: false,
      issue,
    })),
  }
}

describe('restock processing', () => {
  it('hides card singles by default', () => {
    expect(DEFAULT_SETTINGS.includeMiscAndSingles).toBe(false)
    expect(DEFAULT_SETTINGS.splitReport).toBe(false)
    expect(DEFAULT_SETTINGS.printFontSize).toBe(9)
    expect(DEFAULT_SETTINGS.rowDensity).toBe('compact')
  })

  it('keeps the default ignore list alphabetical with ad hoc last', () => {
    expect(DEFAULT_SETTINGS.ignoreText.split('\n')).toEqual([
      'D&A',
      'Event',
      'Events',
      'Food',
      'Rental',
      'Soda',
      'Tickets',
      'ad hoc*',
    ])
  })

  it('normalizes spacing, punctuation, Excel literals, and hidey-hole prefixes', () => {
    expect(normalizeName('  [HH]  Widget   A ')).toBe('widget a')
    expect(normalizeName('="5"')).toBe('5')
    expect(normalizeName('Dragon’s Lair')).toBe("dragon's lair")
  })

  it('balances split parts by line item without separating categories', () => {
    const groups: ReportGroup[] = [
      { key: 'a', label: 'A', items: Array.from({ length: 4 }) as ReportGroup['items'] },
      { key: 'b', label: 'B', items: Array.from({ length: 3 }) as ReportGroup['items'] },
      { key: 'c', label: 'C', items: Array.from({ length: 3 }) as ReportGroup['items'] },
      { key: 'd', label: 'D', items: Array.from({ length: 2 }) as ReportGroup['items'] },
    ]

    const balancedParts = splitReportGroups(groups, 2)
    expect(balancedParts.map((part) => part.map((group) => group.label))).toEqual([
      ['A', 'D'],
      ['B', 'C'],
    ])
    const assignedGroupLabels = balancedParts.flat().map((group) => group.label)
    expect(new Set(assignedGroupLabels).size).toBe(groups.length)
    expect(assignedGroupLabels.toSorted()).toEqual(groups.map((group) => group.label).toSorted())

    const unevenCategoryCounts: ReportGroup[] = [
      { key: 'large', label: 'Large', items: Array.from({ length: 6 }) as ReportGroup['items'] },
      { key: 'small-1', label: 'Small 1', items: Array.from({ length: 1 }) as ReportGroup['items'] },
      { key: 'small-2', label: 'Small 2', items: Array.from({ length: 1 }) as ReportGroup['items'] },
      { key: 'small-3', label: 'Small 3', items: Array.from({ length: 1 }) as ReportGroup['items'] },
      { key: 'small-4', label: 'Small 4', items: Array.from({ length: 1 }) as ReportGroup['items'] },
    ]
    const lineItemBalancedParts = splitReportGroups(unevenCategoryCounts, 2)
    expect(lineItemBalancedParts.map((part) => part.length)).toEqual([1, 4])
    expect(
      lineItemBalancedParts.map((part) =>
        part.reduce((total, group) => total + group.items.length, 0),
      ),
    ).toEqual([6, 4])

    const oversizedGroups: ReportGroup[] = [
      { key: 'large', label: 'Large', items: Array.from({ length: 60 }) as ReportGroup['items'] },
      ...Array.from({ length: 8 }, (_, index) => ({
        key: `tiny-${index}`,
        label: `Tiny ${index}`,
        items: Array.from({ length: 5 }) as ReportGroup['items'],
      })),
    ]
    const twoBalancedParts = splitReportGroups(oversizedGroups, 2)
    expect(
      twoBalancedParts.map((part) =>
        part.reduce((total, group) => total + group.items.length, 0),
      ),
    ).toEqual([50, 50])
    expect(twoBalancedParts.flat().filter((group) => group.label === 'Large')).toHaveLength(2)

    const maximumParts = splitReportGroups(oversizedGroups, 'max')
    expect(maximumParts).toHaveLength(4)
    expect(
      maximumParts.map((part) =>
        part.reduce((total, group) => total + group.items.length, 0),
      ),
    ).toEqual([25, 25, 25, 25])
    expect(maximumParts.some((part) => part.length > 1)).toBe(true)
  })

  it('balances Verify Stock as triple-weight work and includes it in MAX25', () => {
    const restockGroups = [
      makeGroup('A', 10),
      makeGroup('B', 10),
      makeGroup('C', 10),
      makeGroup('D', 10),
    ]
    const verifyGroups = [makeGroup('Unmatched', 10, 'not-found')]
    const maximumParts = splitReportIntoParts(restockGroups, verifyGroups, 'max')

    expect(maximumParts).toHaveLength(3)
    expect(maximumParts.reduce((sum, part) => sum + part.workload, 0)).toBe(70)
    expect(maximumParts.reduce((sum, part) => sum + part.restockItemCount, 0)).toBe(40)
    expect(maximumParts.reduce((sum, part) => sum + part.verifyItemCount, 0)).toBe(10)
    expect(
      maximumParts.flatMap((part) => part.verifyGroups.flatMap((group) => group.items.map((item) => item.key))).toSorted(),
    ).toEqual(verifyGroups.flatMap((group) => group.items.map((item) => item.key)).toSorted())

    const evenParts = splitReportIntoParts(
      [makeGroup('A', 10), makeGroup('B', 10)],
      [makeGroup('Unmatched', 4, 'not-found')],
      2,
    )
    expect(evenParts.map((part) => part.workload)).toEqual([16, 16])
    expect(evenParts.map((part) => part.verifyItemCount)).toEqual([2, 2])
  })

  it('places a small Verify Stock category with its matching restock category', () => {
    const parts = splitReportIntoParts(
      [makeGroup('Board Games', 10), makeGroup('Miniatures', 10)],
      [makeGroup('Board Games', 1, 'zero-stock')],
      2,
    )
    const boardGamesPart = parts.find((part) =>
      part.groups.some((group) => group.label === 'Board Games'),
    )

    expect(boardGamesPart?.verifyGroups.map((group) => group.label)).toContain('Board Games')
    expect(parts.reduce((sum, part) => sum + part.verifyItemCount, 0)).toBe(1)
  })

  it('matches products, sums duplicate balances, and calculates pull quantity', () => {
    const base = buildBaseReport(
      [{ name: 'EmailProductSales.csv', text: sales }],
      { name: 'InventoryReport.csv', text: inventory },
    )
    const widget = base.matchedItems.find((item) => item.item === 'Widget A')
    const duplicate = base.matchedItems.find((item) => item.item === 'Duplicate Item')
    const mixedLocation = base.matchedItems.find((item) => item.item === 'Mixed Location Product')

    expect(widget?.qtySold).toBe(4)
    expect(widget?.currentStock).toBe(3)
    expect(widget?.qtyToPull).toBe(3)
    expect(duplicate?.currentStock).toBe(5)
    expect(mixedLocation?.currentStock).toBe(2)
    expect(mixedLocation?.qtyToPull).toBe(2)
    expect(base.duplicateInventoryProductNames).toContain('Duplicate Item')
    expect(base.unmatchedItems.map((item) => item.item)).toContain('Not In Inventory')
    expect(base.matchedItems.map((item) => item.item)).not.toContain('Friday Night Event')
    expect(base.unmatchedItems.map((item) => item.item)).not.toContain('Unlisted Event Ticket')
    expect(base.matchedItems.map((item) => item.item)).not.toEqual(
      expect.arrayContaining(['Hidey Only Product', 'Marker Only Product']),
    )
    expect(base.unmatchedItems.map((item) => item.item)).not.toEqual(
      expect.arrayContaining(['Hidey Only Product', 'Marker Only Product']),
    )
    expect(base.ignoredReportRows).toBe(1)
  })

  it('cleans Board Games groups, prioritizes Processing, hides Misc. and Singles, and verifies bad stock', () => {
    const base = buildBaseReport(
      [{ name: 'EmailProductSales.csv', text: sales }],
      { name: 'InventoryReport.csv', text: inventory },
    )
    const report = applyReportSettings(base, DEFAULT_SETTINGS)

    expect(report.groups[0].label).toBe('Processing')
    expect(report.groups.map((group) => group.label)).toContain('Board Games')
    expect(report.groups.map((group) => group.label)).not.toContain('Board Games › F')
    expect(report.hiddenMiscAndSingles).toBe(4)
    expect(report.groups.flatMap((group) => group.items.map((item) => item.item))).not.toEqual(
      expect.arrayContaining([
        'Pikachu - 1/100 | NM',
        'Misc. Supply',
        'Collector Singles Bundle',
        'Mystery Pin',
      ]),
    )
    expect(report.ignoredItems).toBe(10)
    expect(report.groups.flatMap((group) => group.items.map((item) => item.item))).not.toEqual(
      expect.arrayContaining(['Ad Hoc Thing', 'D&A Thing']),
    )
    expect(report.verifyItems.map((item) => item.item)).not.toEqual(
      expect.arrayContaining([
        'Tickets',
        'Pokemon Mega Monday Mayhem Tournament Play [08/10/2026] Pokemon Mega Monday Mayhem',
        'Ravenloft Dungeons and Dragons Campaign [08/09/2026] Ravenloft Campaign',
        'Rental Copy',
        'Unlisted Rental Item',
        'Level Up Discount',
        'Teacher/Librarian Discount',
        'Employee',
      ]),
    )
    expect(report.verifyGroups.map((group) => group.label)).not.toContain('Tickets')
    expect(report.verifyItems.map((item) => item.issue)).toEqual(
      expect.arrayContaining(['negative-stock', 'not-found']),
    )
    expect(report.verifyGroups.map((group) => group.label)).toEqual(
      expect.arrayContaining(['Mini › Games', 'Mini']),
    )
  })

  it('includes Misc. and Singles items when their setting is enabled', () => {
    const base = buildBaseReport(
      [{ name: 'EmailProductSales.csv', text: sales }],
      { name: 'InventoryReport.csv', text: inventory },
    )
    const report = applyReportSettings(base, {
      ...DEFAULT_SETTINGS,
      includeMiscAndSingles: true,
    })

    expect(report.hiddenMiscAndSingles).toBe(0)
    expect(report.groups.flatMap((group) => group.items.map((item) => item.item))).toEqual(
      expect.arrayContaining([
        'Pikachu - 1/100 | NM',
        'Misc. Supply',
        'Collector Singles Bundle',
        'Mystery Pin',
      ]),
    )
  })

  it('combines quantities across multiple sales reports', () => {
    const base = buildBaseReport(
      [
        { name: 'one.csv', text: `Products and Categories,Quantity\nWidget A,1.00\n` },
        { name: 'two.csv', text: `Products and Categories,Quantity\nWidget A,2.00\n` },
      ],
      { name: 'inventory.csv', text: inventory },
    )

    expect(base.matchedItems.find((item) => item.item === 'Widget A')?.qtySold).toBe(3)
  })

  it.skipIf(!existsSync(join(process.cwd(), 'Data Samples')))('processes every real sample pair without breaking report invariants', () => {
    const samplesRoot = join(process.cwd(), 'Data Samples')
    const folders = readdirSync(samplesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)

    expect(folders.length).toBe(10)

    for (const folder of folders) {
      const directory = join(samplesRoot, folder)
      const files = readdirSync(directory)
      const salesName = files.find((name) => name.startsWith('EmailProductSales'))
      const inventoryName = files.find((name) => name.startsWith('InventoryReport'))
      expect(salesName, `sales file in sample ${folder}`).toBeTruthy()
      expect(inventoryName, `inventory file in sample ${folder}`).toBeTruthy()

      const base = buildBaseReport(
        [{ name: salesName!, text: readFileSync(join(directory, salesName!), 'utf8') }],
        { name: inventoryName!, text: readFileSync(join(directory, inventoryName!), 'utf8') },
      )
      const report = applyReportSettings(base, DEFAULT_SETTINGS)

      expect(base.inventoryRows).toBeGreaterThan(20_000)
      expect(base.matchedItems.length).toBeGreaterThan(100)
      expect(report.groups.length).toBeGreaterThan(0)
      expect(report.groups[0].label).toBe('Processing')

      const fiveParts = splitReportGroups(report.groups, 5)
      const originalItemKeys = report.groups
        .flatMap((group) => group.items.map((item) => `${item.key}:${item.firstSeen}`))
        .toSorted()
      const splitItemKeys = fiveParts
        .flatMap((part) =>
          part.flatMap((group) => group.items.map((item) => `${item.key}:${item.firstSeen}`)),
        )
        .toSorted()
      const partItemCounts = fiveParts.map((part) =>
        part.reduce((total, group) => total + group.items.length, 0),
      )
      const targetPartSize = report.restockItemCount / fiveParts.length
      const allowedDifference = Math.max(2, Math.floor(targetPartSize * 0.08))

      expect(fiveParts).toHaveLength(5)
      expect(splitItemKeys).toEqual(originalItemKeys)
      expect(Math.max(...partItemCounts) - Math.min(...partItemCounts)).toBeLessThanOrEqual(
        allowedDifference,
      )

      const weightedParts = splitReportIntoParts(report.groups, report.verifyGroups, 5)
      const weightedVerifyKeys = weightedParts
        .flatMap((part) =>
          part.verifyGroups.flatMap((group) =>
            group.items.map((item) => `${item.key}:${item.firstSeen}`),
          ),
        )
        .toSorted()
      const originalVerifyKeys = report.verifyItems
        .map((item) => `${item.key}:${item.firstSeen}`)
        .toSorted()
      expect(weightedParts).toHaveLength(5)
      expect(weightedVerifyKeys).toEqual(originalVerifyKeys)
      expect(weightedParts.reduce((sum, part) => sum + part.workload, 0)).toBe(
        report.restockItemCount + report.verifyItems.length * 3,
      )

      for (const item of base.matchedItems) {
        expect(item.qtyToPull).toBeGreaterThanOrEqual(0)
        expect(item.qtyToPull).toBeLessThanOrEqual(item.qtySold)
        expect(item.qtyToPull).toBeLessThanOrEqual(Math.max(item.currentStock ?? 0, 0))
      }
      for (const item of report.verifyItems) {
        expect(item.issue).toBeTruthy()
      }
    }
  }, 30_000)
})
