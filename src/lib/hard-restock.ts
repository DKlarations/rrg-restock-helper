import Papa from 'papaparse'
import { normalizeName, splitReportGroups, type CsvInput, type ReportGroup } from './restock'

export type HardSettings = {
  selectedCategories: string[]
  includeZeroStock: boolean
  negativeStockOnly: boolean
  excludePaint: boolean
  excludeDice: boolean
  excludeDeactivate: boolean
  excludeOnlineSales: boolean
  ignoreText: string
  splitReport: boolean
  splitCount: number | 'max'
  printFontSize: number
  rowDensity: 'microcompact' | 'subcompact' | 'compact' | 'standard' | 'roomy'
}

export type HardItem = {
  key: string
  item: string
  categories: string[]
  categoryKey: string
  categoryLabel: string
  currentStock: number
  duplicateName: boolean
}

export type HardCategoryNode = {
  key: string
  label: string
  path: string[]
  children: HardCategoryNode[]
  itemCount: number
}

export type HardInventory = {
  items: HardItem[]
  categories: HardCategoryNode[]
  duplicateProductNames: string[]
  warnings: string[]
  inventoryFileName: string
  ignoredRows: number
}

export type HardGroup = {
  key: string
  label: string
  items: HardItem[]
}

export type HardReport = {
  groups: HardGroup[]
  items: HardItem[]
  excludedItems: number
  zeroStockHidden: number
  negativeFilterHidden: number
}

export const DEFAULT_HARD_SETTINGS: HardSettings = {
  selectedCategories: [],
  includeZeroStock: true,
  negativeStockOnly: false,
  excludePaint: true,
  excludeDice: true,
  excludeDeactivate: true,
  excludeOnlineSales: true,
  ignoreText: ['Food', 'Rental', 'Soda', 'Tickets', 'ad hoc*'].join('\n'),
  splitReport: false,
  splitCount: 2,
  printFontSize: 9,
  rowDensity: 'compact',
}

const rowDensities = new Set<HardSettings['rowDensity']>([
  'microcompact', 'subcompact', 'compact', 'standard', 'roomy',
])
const permanentlyExcludedCategories = new Set(['event', 'events', 'club memberships'])
const permanentlyExcludedItems = new Set([
  'level up discount', 'teacher/librarian discount', 'employee',
])
const nameOrder = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' })

// Keep display punctuation/case while applying the same export repairs used by Soft.
const textRepairs: Array<[string, string]> = [
  ['Ã¢â‚¬â„¢', '’'], ['Ã¢â‚¬Å“', '“'], ['Ã¢â‚¬Â\u009d', '”'],
  ['Ã¢â‚¬â€œ', '–'], ['Ã¢â‚¬â€\u009d', '—'], ['â€™', '’'],
  ['â€œ', '“'], ['â€\u009d', '”'], ['â€“', '–'], ['â€”', '—'], ['Â', ''],
]

function cleanDisplay(value: string): string {
  const trimmed = value.trim()
  const unwrapped = trimmed.match(/^="(.*)"$/)?.[1] ?? trimmed
  return textRepairs.reduce((text, [broken, repaired]) => text.split(broken).join(repaired), unwrapped)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function readCategoryKey(value: string): string[] | null {
  try {
    const path: unknown = JSON.parse(value)
    return Array.isArray(path) && path.every((segment) => typeof segment === 'string' && segment.trim())
      ? path as string[]
      : null
  } catch {
    return null
  }
}

/** Accept older or damaged saved preferences without importing Soft's settings. */
export function sanitizeHardSettings(value: unknown): HardSettings {
  const defaults = { ...DEFAULT_HARD_SETTINGS, selectedCategories: [] as string[] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const saved = value as Record<string, unknown>
  const settings = { ...defaults }
  const booleanKeys = [
    'includeZeroStock', 'negativeStockOnly', 'excludePaint', 'excludeDice',
    'excludeDeactivate', 'excludeOnlineSales', 'splitReport',
  ] as const
  for (const key of booleanKeys) {
    if (typeof saved[key] === 'boolean') settings[key] = saved[key]
  }
  if (Array.isArray(saved.selectedCategories)) {
    settings.selectedCategories = [...new Set(saved.selectedCategories.flatMap((key) => {
      if (typeof key !== 'string') return []
      const path = readCategoryKey(key)
      return path ? [JSON.stringify(path)] : []
    }))]
  }
  if (typeof saved.ignoreText === 'string') settings.ignoreText = saved.ignoreText
  if (saved.splitCount === 'max') settings.splitCount = 'max'
  else if (typeof saved.splitCount === 'number' && Number.isInteger(saved.splitCount)
    && saved.splitCount >= 2 && saved.splitCount <= 5) settings.splitCount = saved.splitCount
  if (typeof saved.printFontSize === 'number' && Number.isInteger(saved.printFontSize)
    && saved.printFontSize >= 6 && saved.printFontSize <= 14) settings.printFontSize = saved.printFontSize
  if (typeof saved.rowDensity === 'string' && rowDensities.has(saved.rowDensity as HardSettings['rowDensity'])) {
    settings.rowDensity = saved.rowDensity as HardSettings['rowDensity']
  }
  return settings
}

function permanentlyExcluded(name: string, categories: string[]): boolean {
  return /^\s*\[HH\]/i.test(name)
    || permanentlyExcludedItems.has(normalizeName(name))
    || categories.some((category) => {
      const key = normalizeName(category)
      return key.includes('hidey hole') || permanentlyExcludedCategories.has(key)
    })
}

function comparePaths(a: string[], b: string[]): number {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = nameOrder.compare(a[index], b[index])
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

function buildCategoryTree(items: HardItem[]): HardCategoryNode[] {
  const roots: HardCategoryNode[] = []
  const nodes = new Map<string, HardCategoryNode>()
  for (const item of items) {
    if (item.categories.length === 0) {
      let uncategorized = nodes.get('[]')
      if (!uncategorized) {
        uncategorized = { key: '[]', label: 'Uncategorized', path: [], children: [], itemCount: 0 }
        nodes.set('[]', uncategorized)
        roots.push(uncategorized)
      }
      uncategorized.itemCount += 1
      continue
    }
    let siblings = roots
    for (let depth = 1; depth <= item.categories.length; depth += 1) {
      const path = item.categories.slice(0, depth)
      const key = JSON.stringify(path)
      let node = nodes.get(key)
      if (!node) {
        node = { key, label: path[depth - 1], path, children: [], itemCount: 0 }
        nodes.set(key, node)
        siblings.push(node)
      }
      node.itemCount += 1
      siblings = node.children
    }
  }
  const sortNodes = (siblings: HardCategoryNode[]) => {
    siblings.sort((a, b) => nameOrder.compare(a.label, b.label))
    siblings.forEach((node) => sortNodes(node.children))
  }
  sortNodes(roots)
  return roots
}

/** Keep every ordinary inventory entry distinct, including identical names/paths. */
export function parseHardInventory(input: CsvInput): HardInventory {
  const parsed = Papa.parse<Record<string, string | undefined>>(input.text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })
  const missing = ['Product', 'Balance'].filter((header) => !parsed.meta.fields?.includes(header))
  if (missing.length > 0) throw new Error(`${input.name} is missing: ${missing.join(', ')}`)
  if (parsed.errors.length > 0) throw new Error(`${input.name}: ${parsed.errors[0].message}`)

  const items: HardItem[] = []
  let ignoredRows = 0
  for (const [rowIndex, row] of parsed.data.entries()) {
    const rawProduct = row.Product?.trim() ?? ''
    const path = cleanDisplay(rawProduct).split(/\s*>>\s*/).map(cleanDisplay)
    const item = path.at(-1) ?? ''
    const categories = path.slice(0, -1).filter(Boolean)
    if (permanentlyExcluded(item, categories)) continue

    const rawBalance = row.Balance?.trim() ?? ''
    const balanceText = rawBalance.match(/^="(.*)"$/)?.[1] ?? rawBalance
    const numericBalance = balanceText.replace(/[$,]/g, '')
    const currentStock = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(numericBalance)
      ? Number(numericBalance)
      : Number.NaN
    if (!rawProduct || !item || !Number.isFinite(currentStock)) {
      ignoredRows += 1
      continue
    }
    const categoryKey = JSON.stringify(categories)
    items.push({
      key: `hard-row-${rowIndex}`,
      item,
      categories,
      categoryKey,
      categoryLabel: categories.join(' › ') || 'Uncategorized',
      currentStock,
      duplicateName: false,
    })
  }

  const byName = new Map<string, HardItem[]>()
  for (const item of items) {
    const key = normalizeName(item.item)
    const existing = byName.get(key)
    if (existing) existing.push(item)
    else byName.set(key, [item])
  }
  const duplicateProductNames: string[] = []
  for (const matches of byName.values()) {
    if (matches.length < 2) continue
    matches.forEach((item) => { item.duplicateName = true })
    duplicateProductNames.push(matches[0].item)
  }
  duplicateProductNames.sort(nameOrder.compare)
  items.sort((a, b) => comparePaths(a.categories, b.categories) || nameOrder.compare(a.item, b.item))

  const warnings: string[] = []
  if (duplicateProductNames.length > 0) {
    warnings.push(`${duplicateProductNames.length} product names appeared more than once in inventory. Every entry is listed separately; balances were not combined.`)
  }
  if (ignoredRows > 0) {
    warnings.push(`${ignoredRows} inventory row${ignoredRows === 1 ? ' was' : 's were'} skipped because the product or balance was missing or invalid.`)
  }
  return {
    items,
    categories: buildCategoryTree(items),
    duplicateProductNames,
    warnings,
    inventoryFileName: input.name,
    ignoredRows,
  }
}

function matchesPath(item: HardItem, selectedPath: string[]): boolean {
  if (selectedPath.length === 0) return item.categories.length === 0
  return selectedPath.length <= item.categories.length
    && selectedPath.every((segment, index) => segment === item.categories[index])
}

function isExcludedByToggle(item: HardItem, settings: HardSettings): boolean {
  const categories = item.categories.map(normalizeName)
  if (settings.excludeDeactivate && categories.includes('deactivate')) return true
  if (settings.excludeOnlineSales && categories[0] === 'z online sales') return true
  if (settings.excludeDice && categories.includes('dice')) return true
  if (settings.excludePaint && !categories.includes('painting accessories')) {
    if (categories.includes('paint')) return true
    if (/(^|[^a-z0-9])(playmarkers?|paint[ -]*markers?)(?=$|[^a-z0-9])/.test(normalizeName(item.item))) return true
  }
  return false
}

export function buildHardReport(inventory: HardInventory, settings: HardSettings): HardReport {
  const selectedPaths = settings.selectedCategories.flatMap((key) => {
    const path = readCategoryKey(key)
    return path ? [path] : []
  })
  const exactRules = new Set<string>()
  const prefixes: string[] = []
  for (const line of settings.ignoreText.split(/\r?\n/)) {
    const rule = line.trim()
    if (!rule) continue
    if (rule.endsWith('*')) {
      const prefix = normalizeName(rule.slice(0, -1))
      if (prefix) prefixes.push(prefix)
    } else {
      const pathRule = rule.replaceAll('›', '>>').split(/\s*>>\s*/).map(normalizeName).join(' >> ')
      exactRules.add(pathRule)
    }
  }

  let excludedItems = 0
  let zeroStockHidden = 0
  let negativeFilterHidden = 0
  const items = inventory.items.filter((item) => {
    if (!selectedPaths.some((path) => matchesPath(item, path))) return false
    const name = normalizeName(item.item)
    const ignored = exactRules.has(name)
      || prefixes.some((prefix) => name.startsWith(prefix))
      || item.categories.some((category) => exactRules.has(normalizeName(category)))
      || item.categories.some((_, index) => exactRules.has(normalizeName(item.categories.slice(0, index + 1).join(' >> '))))
    if (isExcludedByToggle(item, settings) || ignored) {
      excludedItems += 1
      return false
    }
    if (!settings.includeZeroStock && item.currentStock === 0) {
      zeroStockHidden += 1
      return false
    }
    if (settings.negativeStockOnly && item.currentStock >= 0) {
      negativeFilterHidden += 1
      return false
    }
    return true
  })
  const groupMap = new Map<string, HardGroup>()
  for (const item of items) {
    const group = groupMap.get(item.categoryKey)
    if (group) group.items.push(item)
    else groupMap.set(item.categoryKey, { key: item.categoryKey, label: item.categoryLabel, items: [item] })
  }
  return { groups: [...groupMap.values()], items, excludedItems, zeroStockHidden, negativeFilterHidden }
}

/** Reuse Soft's category-aware balancing with one workload unit per Hard row. */
export function splitHardReport(groups: HardGroup[], requestedParts: number | 'max'): HardGroup[][] {
  const byKey = new Map(groups.flatMap((group) => group.items.map((item) => [item.key, item] as const)))
  const adaptedGroups: ReportGroup[] = groups.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.items.map((item, index) => ({
      key: item.key,
      item: item.item,
      categories: item.categories,
      categoryLabel: item.categoryLabel,
      currentStock: item.currentStock,
      qtySold: 0,
      qtyToPull: 0,
      firstSeen: index,
      isMiscOrSingle: false,
    })),
  }))
  const parts = splitReportGroups(adaptedGroups, requestedParts).map((part) => part.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.items.map((item) => byKey.get(item.key)!),
  })))
  // Soft allows a two-row imbalance, which can leave empty parts for tiny lists.
  // An explicitly requested Hard packet must have work in it.
  for (const [partIndex, part] of parts.entries()) {
    if (part.length > 0) continue
    const donor = parts.reduce((largest, candidate) => {
      const count = candidate.reduce((sum, group) => sum + group.items.length, 0)
      const largestCount = largest.reduce((sum, group) => sum + group.items.length, 0)
      return count > largestCount ? candidate : largest
    }, parts[0])
    const source = donor.reduce((largest, group) => group.items.length > largest.items.length ? group : largest)
    const item = source.items.pop()!
    part.push({ key: `${source.key}--hard-extra-${partIndex}`, label: source.label, items: [item] })
    if (source.items.length === 0) donor.splice(donor.indexOf(source), 1)
  }
  return parts
}
