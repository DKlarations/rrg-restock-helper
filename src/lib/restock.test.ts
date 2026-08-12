import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyReportSettings,
  buildBaseReport,
  DEFAULT_SETTINGS,
  normalizeName,
} from './restock'

const inventory = `Product,Balance
0_Processing >>Widget A,3.0000
Board Games >>F >>Flamecraft Duals - Deluxe Kickstarter Edition,2.0000
CCGs >>Pokemon >>Singles >>Pikachu - 1/100 | NM,4.0000
Food >>Pretzels,10.0000
Rental >>Rental Copy,0.0000
Mini >>Games >>Duplicate Item,2.0000
Mini >>Games >>Duplicate Item,3.0000
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
Board Games,1.00
F,1.00
Flamecraft Duals - Deluxe Kickstarter Edition,1.00
CCGs,1.00
Pokemon,1.00
Singles,1.00
Pikachu - 1/100 | NM,1.00
Food,1.00
Pretzels,1.00
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

describe('restock processing', () => {
  it('normalizes spacing, punctuation, Excel literals, and hidey-hole prefixes', () => {
    expect(normalizeName('  [HH]  Widget   A ')).toBe('widget a')
    expect(normalizeName('="5"')).toBe('5')
    expect(normalizeName('Dragon’s Lair')).toBe("dragon's lair")
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

  it('cleans Board Games groups, prioritizes Processing, hides singles, and verifies bad stock', () => {
    const base = buildBaseReport(
      [{ name: 'EmailProductSales.csv', text: sales }],
      { name: 'InventoryReport.csv', text: inventory },
    )
    const report = applyReportSettings(base, DEFAULT_SETTINGS)

    expect(report.groups[0].label).toBe('Processing')
    expect(report.groups.map((group) => group.label)).toContain('Board Games')
    expect(report.groups.map((group) => group.label)).not.toContain('Board Games › F')
    expect(report.hiddenSingles).toBe(1)
    expect(report.ignoredItems).toBe(8)
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

  it('processes every real sample pair without breaking report invariants', () => {
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
