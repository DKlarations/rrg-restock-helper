import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import Papa from 'papaparse'
import { describe, expect, it } from 'vitest'
import {
  buildHardReport,
  DEFAULT_HARD_SETTINGS,
  parseHardInventory,
  sanitizeHardSettings,
  splitHardReport,
  type HardCategoryNode,
  type HardGroup,
  type HardSettings,
} from './hard-restock'

function inventory(rows: Array<[string, string | number]>) {
  return parseHardInventory({ name: 'Inventory.csv', text: Papa.unparse([['Product', 'Balance'], ...rows]) })
}

function settings(paths: string[][], overrides: Partial<HardSettings> = {}): HardSettings {
  return { ...DEFAULT_HARD_SETTINGS, selectedCategories: paths.map((path) => JSON.stringify(path)), ...overrides }
}

function flattenTree(nodes: HardCategoryNode[]): HardCategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)])
}

describe('Hard inventory parsing', () => {
  it('requires inventory columns and reports malformed CSV instead of inventing data', () => {
    expect(() => parseHardInventory({ name: 'Sales.csv', text: 'Products and Categories,Quantity\nProduct,1' }))
      .toThrow('Sales.csv is missing: Product, Balance')
    expect(() => parseHardInventory({ name: 'Bad.csv', text: 'Product,Balance\n"Unclosed,2' }))
      .toThrow('Bad.csv:')
  })

  it('keeps unsold products, exact category depth, filing numbers and letters, and individual balances', () => {
    const parsed = inventory([
      ['Board Games >> A >> Never Sold', 0],
      ['Board Games >> 1 >> 1st Game', -2],
      ['Mini >> Games >> GW >> 40k >> Infantry', 7],
      ['Bandai Hobby >> Model', 3],
    ])
    expect(parsed.items.map((item) => item.currentStock)).toEqual([3, -2, 0, 7])
    expect(parsed.items.find((item) => item.item === 'Never Sold')?.categories).toEqual(['Board Games', 'A'])
    const nodes = flattenTree(parsed.categories)
    expect(nodes.find((node) => node.key === '["Board Games"]')?.itemCount).toBe(2)
    expect(nodes.find((node) => node.key === '["Board Games","A"]')?.itemCount).toBe(1)
    expect(nodes.find((node) => node.key === '["Mini","Games","GW","40k"]')?.path)
      .toEqual(['Mini', 'Games', 'GW', '40k'])
    expect(parsed.inventoryFileName).toBe('Inventory.csv')
  })

  it('keeps duplicate-name rows separate even within the same category, and detects normalized duplicates', () => {
    const parsed = inventory([
      ['Board Games >> A >> Dragon’s Lair', 2],
      ["Board Games >> A >> Dragon's Lair", -1],
      ["Other >> Dragon's Lair", 8],
      ['Other >> Distinct', 4],
    ])
    const duplicates = parsed.items.filter((item) => item.duplicateName)
    expect(duplicates).toHaveLength(3)
    expect(duplicates.map((item) => item.currentStock)).toEqual([2, -1, 8])
    expect(new Set(parsed.items.map((item) => item.key)).size).toBe(4)
    expect(parsed.duplicateProductNames).toEqual(['Dragon’s Lair'])
    expect(parsed.warnings.join(' ')).toContain('balances were not combined')
  })

  it('removes permanent exclusions before constructing names, tree, duplicate diagnostics, or invalid-row warnings', () => {
    const parsed = inventory([
      ['Z Online Sales >> 1_Hidey Hole >> Secret Item', 5],
      ['Ordinary >> [HH] Secret Item', 'invalid'],
      ['Events >> Tournament >> Ticket Name', 6],
      ['Club Memberships >> Level Up Discount', 3],
      ['Other >> Teacher/Librarian Discount', -1],
      ['Other >> Employee', 0],
      ['Other >> Safe', 1],
    ])
    expect(parsed.items.map((item) => item.item)).toEqual(['Safe'])
    expect(flattenTree(parsed.categories).map((node) => node.label)).toEqual(['Other'])
    expect(parsed.duplicateProductNames).toEqual([])
    expect(parsed.warnings).toEqual([])
    expect(parsed.ignoredRows).toBe(0)
  })

  it('never converts missing, nonfinite, or invalid balances to zero, while keeping real zero and decimals', () => {
    const parsed = inventory([
      ['Games >> Missing', ''], ['Games >> Invalid', 'oops'],
      ['Games >> Infinite', 'Infinity'], ['Games >> Hex', '0x10'],
      ['Games >> Only Currency', '$'], ['', 1],
      ['Games >> Zero', '0.0000'], ['Games >> Decimal', '-1.50'],
      ['Games >> Thousands', '1,234.0000'],
    ])
    expect(parsed.items.map((item) => [item.item, item.currentStock])).toEqual([
      ['Decimal', -1.5], ['Thousands', 1234], ['Zero', 0],
    ])
    expect(parsed.ignoredRows).toBe(6)
    expect(parsed.warnings.join(' ')).toContain('6 inventory rows were skipped')
  })

  it('repairs display text and Excel literals without collapsing raw category structure', () => {
    const parsed = inventory([
      ['Board Games >>="5" >> Dragonâ€™s Game', '="2"'],
      ['="Uncategorized Name"', 1],
    ])
    expect(parsed.items.find((item) => item.currentStock === 2)).toMatchObject({
      item: 'Dragon’s Game', categories: ['Board Games', '5'], categoryKey: '["Board Games","5"]',
    })
    expect(parsed.items.find((item) => item.currentStock === 1)?.item).toBe('Uncategorized Name')
    expect(flattenTree(parsed.categories).find((node) => node.key === '[]')?.itemCount).toBe(1)
  })

  it('skips a blank trailing product instead of interpreting its category as the product name', () => {
    const parsed = inventory([
      ['Board Games >> A >>', 3],
      ['Board Games >> B >>   ', 4],
      ['Board Games >> C >> Real Product', 5],
    ])
    expect(parsed.items.map((item) => item.item)).toEqual(['Real Product'])
    expect(parsed.ignoredRows).toBe(2)
    expect(parsed.warnings.join(' ')).toContain('2 inventory rows were skipped')
    expect(flattenTree(parsed.categories).map((node) => node.label)).toEqual(['Board Games', 'C'])
  })
})

describe('Hard checklist filtering', () => {
  it('unions parent and child selections without repeating a row, and keeps unselected siblings out', () => {
    const parsed = inventory([
      ['Board Games >> 1 >> One', 1], ['Board Games >> A >> Alpha', 2],
      ['Board Games >> B >> Beta', 0], ['Bandai Hobby >> Model', 5],
    ])
    expect(buildHardReport(parsed, settings([])).items).toEqual([])
    const selected = buildHardReport(parsed, settings([['Board Games'], ['Board Games', 'A']]))
    expect(selected.items.map((item) => item.item)).toEqual(['One', 'Alpha', 'Beta'])
    expect(new Set(selected.items.map((item) => item.key)).size).toBe(3)
    expect(selected.groups.map((group) => group.label)).toEqual(['Board Games › 1', 'Board Games › A', 'Board Games › B'])
    expect(buildHardReport(parsed, settings([['Board Games', 'A']])).items.map((item) => item.item)).toEqual(['Alpha'])
  })

  it('keeps path IDs unambiguous when a category contains a display separator', () => {
    const parsed = inventory([
      ['A › B >> One', 1], ['A >> B >> Two', 2], ['No Category', 3],
    ])
    expect(buildHardReport(parsed, settings([['A › B']])).items.map((item) => item.item)).toEqual(['One'])
    expect(buildHardReport(parsed, settings([['A', 'B']])).items.map((item) => item.item)).toEqual(['Two'])
    expect(buildHardReport(parsed, settings([[]])).items.map((item) => item.item)).toEqual(['No Category'])
  })

  it('includes zero by default, hides only actual zero on request, and offers a negative-only view', () => {
    const parsed = inventory([['Games >> Positive', 4], ['Games >> Zero', 0], ['Games >> Negative', -3]])
    expect(buildHardReport(parsed, settings([['Games']])).items).toHaveLength(3)
    const noZero = buildHardReport(parsed, settings([['Games']], { includeZeroStock: false }))
    expect(noZero.items.map((item) => item.item)).toEqual(['Negative', 'Positive'])
    expect(noZero.zeroStockHidden).toBe(1)
    const negative = buildHardReport(parsed, settings([['Games']], { negativeStockOnly: true }))
    expect(negative.items.map((item) => item.item)).toEqual(['Negative'])
    expect(negative.negativeFilterHidden).toBe(2)
  })

  it('applies independent defaults and reveals categories when their exclusion is disabled', () => {
    const parsed = inventory([
      ['Paint >> AK Interactive >> AK Marker', 1],
      ['Paint >> Citadel >> Paint Pot', 2],
      ['Paint >> Painting Accessories >> Brush', 3],
      ['D&A >> Dice >> Dice Set', 4],
      ['D&A >> Dice >> RRG >> Store Dice', 5],
      ['D&A >> Accessories >> Dice Bag', 6],
      ['Deactivate >> Old Item', 7],
      ['Z Online Sales >> Board Games >> Online Game', 8],
      ['RPG >> Accessories >> Nolzur Unpainted Minis', 9],
      ['0_Processing >> AK Playmarker Blue', 10],
      ['0_Processing >> Paint-Marker Green', 11],
      ['Board Games >> A >> First Player Marker', 12],
    ])
    const allRoots = parsed.categories.map((node) => node.path)
    const defaults = buildHardReport(parsed, settings(allRoots))
    expect(defaults.items.map((item) => item.item)).toEqual([
      'First Player Marker', 'Dice Bag', 'Brush', 'Nolzur Unpainted Minis',
    ])
    expect(defaults.excludedItems).toBe(8)
    expect(buildHardReport(parsed, settings(allRoots, { excludePaint: false })).items).toHaveLength(8)
    expect(buildHardReport(parsed, settings(allRoots, { excludeDice: false })).items).toHaveLength(6)
    expect(buildHardReport(parsed, settings(allRoots, { excludeDeactivate: false })).items).toHaveLength(5)
    expect(buildHardReport(parsed, settings(allRoots, { excludeOnlineSales: false })).items).toHaveLength(5)
    expect(flattenTree(parsed.categories).some((node) => node.label === 'Dice')).toBe(true)
  })

  it('supports explicit name/category/path/prefix exclusions and keeps Hard preferences independent', () => {
    const parsed = inventory([
      ['Mini >> Games >> GW >> 40k >> Infantry', 1],
      ['Mini >> Games >> Other >> Figure', 1],
      ['Board Games >> A >> Alpha', 1], ['Board Games >> A >> Ad Hoc Promo', 1],
      ['Board Games >> B >> Beta', 1],
    ])
    const result = buildHardReport(parsed, settings(parsed.categories.map((node) => node.path), {
      ignoreText: 'Mini › Games › GW\nalpha\nB\nAd Hoc*',
    }))
    expect(result.items.map((item) => item.item)).toEqual(['Figure'])
    expect(result.excludedItems).toBe(4)
    expect(DEFAULT_HARD_SETTINGS.ignoreText).not.toContain('D&A')
  })

  it('matches path exclusions across separator spacing and display separators', () => {
    const parsed = inventory([
      ['Board Games >> A >> Alpha', 1],
      ['Board Games >> A >> Deeper >> Descendant', 1],
      ['Board Games >> B >> Beta', 1],
    ])
    for (const ignoreText of ['Board Games>>A', 'Board Games >> A', 'Board Games › A', 'Board Games›A']) {
      const result = buildHardReport(parsed, settings([['Board Games']], { ignoreText }))
      expect(result.items.map((item) => item.item)).toEqual(['Beta'])
      expect(result.excludedItems).toBe(2)
    }
  })
})

describe('Hard settings and packet splitting', () => {
  it('migrates partial preferences with safe defaults and sanitizes corrupted persisted values', () => {
    const partial = sanitizeHardSettings({ includeZeroStock: false })
    expect(partial.includeZeroStock).toBe(false)
    expect(partial.excludeDice).toBe(true)
    expect(partial.negativeStockOnly).toBe(false)
    const corrupted = sanitizeHardSettings({
      selectedCategories: [1, '["Games"]', ' ["Games"] ', 'null', 'bad', '[42]', '[""]', '[]'],
      includeZeroStock: 'false', excludePaint: 0, splitCount: Infinity,
      printFontSize: 500, rowDensity: 'giant', ignoreText: null,
    })
    expect(corrupted).toEqual({
      ...DEFAULT_HARD_SETTINGS, selectedCategories: ['["Games"]', '[]'],
    })
    const valid = sanitizeHardSettings({ splitCount: 'max', printFontSize: 14, rowDensity: 'roomy', ignoreText: '' })
    expect(valid).toMatchObject({ splitCount: 'max', printFontSize: 14, rowDensity: 'roomy', ignoreText: '' })
    for (const invalid of [null, undefined, false, 'bad', []]) {
      const restored = sanitizeHardSettings(invalid)
      expect(restored).toEqual(DEFAULT_HARD_SETTINGS)
      expect(restored.selectedCategories).not.toBe(DEFAULT_HARD_SETTINGS.selectedCategories)
    }
  })

  it('balances oversized categories and MAX25 without changing or losing duplicate records', () => {
    const parsed = inventory([
      ...Array.from({ length: 60 }, () => ['Large >> Repeated Name', 2] as [string, number]),
      ...Array.from({ length: 8 }, (_, index) => Array.from({ length: 5 }, (_, row) =>
        [`Small ${index} >> Item ${row}`, row] as [string, number])).flat(),
    ])
    const report = buildHardReport(parsed, settings(parsed.categories.map((node) => node.path)))
    const originals = report.items.map((item) => item.key).toSorted()
    const groupsBefore = report.groups.map((group) => group.items.map((item) => item.key))
    for (const count of [2, 5, 'max'] as const) {
      const parts = splitHardReport(report.groups, count)
      expect(parts).toHaveLength(count === 'max' ? 4 : count)
      const counts = parts.map((part) => part.reduce((sum, group) => sum + group.items.length, 0))
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2)
      expect(parts.flat(2).flatMap((group) => group.items.map((item) => item.key)).toSorted()).toEqual(originals)
      expect(parts.flat().flatMap((group) => group.items).every((item) => report.items.includes(item))).toBe(true)
    }
    expect(report.groups.map((group) => group.items.map((item) => item.key))).toEqual(groupsBefore)
    expect(splitHardReport([], 'max')).toEqual([])
  })

  it('keeps small categories together where possible and never emits empty coworker packets', () => {
    const parsed = inventory([
      ['A >> One', 1], ['A >> Two', 2], ['B >> Three', 3], ['B >> Four', 4],
    ])
    const groups: HardGroup[] = buildHardReport(parsed, settings([['A'], ['B']])).groups
    expect(splitHardReport(groups, 2).map((part) => part.map((group) => group.label))).toEqual([['A'], ['B']])
    expect(splitHardReport(groups, 5)).toHaveLength(4)
    expect(splitHardReport(groups, 5).every((part) => part.some((group) => group.items.length > 0))).toBe(true)
  })
})

describe('saved inventory audit', () => {
  it.skipIf(!existsSync(join(process.cwd(), 'Data Samples')))('retains every valid ordinary inventory entry and the Board Games filing tree in all saved exports', () => {
    const root = join(process.cwd(), 'Data Samples')
    const folders = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    expect(folders).toHaveLength(10)
    for (const folder of folders) {
      const directory = join(root, folder.name)
      const fileName = readdirSync(directory).find((name) => name.startsWith('InventoryReport'))!
      const text = readFileSync(join(directory, fileName), 'utf8')
      const raw = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: 'greedy' }).data
      const expected = raw.filter((row) => {
        const parts = row.Product.split(/\s*>>\s*/)
        const name = parts.at(-1)!.trim()
        const categories = parts.slice(0, -1).map((part) => part.trim().toLowerCase())
        return !/^\[HH\]/i.test(name)
          && !categories.some((part) => part.includes('hidey hole') || ['event', 'events', 'club memberships'].includes(part))
          && !['level up discount', 'teacher/librarian discount', 'employee'].includes(name.toLowerCase())
      })
      const parsed = parseHardInventory({ name: fileName, text })
      expect(parsed.ignoredRows).toBe(0)
      expect(parsed.items).toHaveLength(expected.length)
      expect(parsed.items.reduce((sum, item) => sum + item.currentStock, 0))
        .toBeCloseTo(expected.reduce((sum, row) => sum + Number(row.Balance), 0), 6)
      expect(flattenTree(parsed.categories).some((node) => node.key === '["Board Games","A"]')).toBe(true)
      const all = buildHardReport(parsed, settings(parsed.categories.map((node) => node.path), {
        excludePaint: false, excludeDice: false, excludeDeactivate: false, excludeOnlineSales: false, ignoreText: '',
      }))
      expect(all.items).toHaveLength(expected.length)
      expect(new Set(all.items.map((item) => item.key)).size).toBe(expected.length)
    }
  }, 30_000)
})
