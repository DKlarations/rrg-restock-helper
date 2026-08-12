import Papa from 'papaparse'

export type CsvInput = {
  name: string
  text: string
}

export type ReportSettings = {
  includeCardSingles: boolean
  showCategoryHeadings: boolean
  printFontSize: number
  rowDensity: 'microcompact' | 'subcompact' | 'compact' | 'standard' | 'roomy'
  ignoreText: string
}

export type RestockItem = {
  key: string
  item: string
  categories: string[]
  categoryLabel: string
  currentStock: number | null
  qtySold: number
  qtyToPull: number
  firstSeen: number
  isCardSingle: boolean
  issue?: 'zero-stock' | 'negative-stock' | 'not-found'
}

export type BaseReport = {
  matchedItems: RestockItem[]
  unmatchedItems: RestockItem[]
  ignoredReportRows: number
  duplicateInventoryNames: number
  duplicateInventoryProductNames: string[]
  inventoryRows: number
  salesRows: number
  warnings: string[]
  salesFileNames: string[]
  inventoryFileName: string
}

export type ReportGroup = {
  key: string
  label: string
  items: RestockItem[]
}

export type DisplayReport = BaseReport & {
  groups: ReportGroup[]
  verifyItems: RestockItem[]
  verifyGroups: ReportGroup[]
  ignoredItems: number
  hiddenSingles: number
  restockItemCount: number
  totalUnitsToPull: number
}

type SalesCsvRow = Record<string, string | undefined>
type InventoryCsvRow = Record<string, string | undefined>

type InventoryProduct = {
  displayName: string
  categories: string[]
  balance: number
}

const REQUIRED_SALES_HEADERS = ['Products and Categories', 'Quantity']
const REQUIRED_INVENTORY_HEADERS = ['Product', 'Balance']

const MOJIBAKE_REPLACEMENTS: Array<[string, string]> = [
  ['Ã¢â‚¬â„¢', '’'],
  ['Ã¢â‚¬Å“', '“'],
  ['Ã¢â‚¬Â', '”'],
  ['Ã¢â‚¬â€œ', '–'],
  ['Ã¢â‚¬â€', '—'],
  ['â€™', '’'],
  ['â€œ', '“'],
  ['â€', '”'],
  ['â€“', '–'],
  ['â€”', '—'],
  ['Â', ''],
]

const SALES_ONLY_CATEGORY_LABELS = new Map([
  ['tickets', 'Tickets'],
  ['club memberships', 'Club Memberships'],
])
const SYSTEM_IGNORED_CATEGORY_KEYS = new Set(['event', 'events', 'club memberships'])
const SYSTEM_IGNORED_ITEM_KEYS = new Set([
  'level up discount',
  'teacher/librarian discount',
  'employee',
])

export const DEFAULT_SETTINGS: ReportSettings = {
  includeCardSingles: false,
  showCategoryHeadings: true,
  printFontSize: 10,
  rowDensity: 'standard',
  ignoreText: [
    'Soda',
    'Food',
    'Event',
    'Events',
    'Rental',
    'Tickets',
  ].join('\n'),
}

function repairText(value: string): string {
  return MOJIBAKE_REPLACEMENTS.reduce(
    (current, [broken, repaired]) => current.split(broken).join(repaired),
    value,
  )
}

function unwrapExcelLiteral(value: string): string {
  const match = value.trim().match(/^="(.*)"$/)
  return match ? match[1] : value
}

export function normalizeName(value: string): string {
  return repairText(unwrapExcelLiteral(value))
    .normalize('NFKC')
    .replace(/^\s*\[HH\]\s*/i, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
}

function cleanDisplayName(value: string): string {
  return repairText(value)
    .replace(/^\s*\[HH\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNumber(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const parsed = Number(value.replace(/[$,]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function parseCsv<T extends Record<string, string | undefined>>(
  input: CsvInput,
  requiredHeaders: string[],
): T[] {
  const result = Papa.parse<T>(input.text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })

  if (result.errors.length > 0) {
    const seriousError = result.errors.find((error) => error.type !== 'FieldMismatch')
    if (seriousError) {
      throw new Error(`${input.name}: ${seriousError.message}`)
    }
  }

  const headers = result.meta.fields ?? []
  const missing = requiredHeaders.filter((header) => !headers.includes(header))
  if (missing.length > 0) {
    throw new Error(`${input.name} is missing: ${missing.join(', ')}`)
  }

  return result.data
}

function cleanCategories(categories: string[]): string[] {
  const cleaned = categories
    .map((category) => cleanDisplayName(unwrapExcelLiteral(category)))
    .filter(Boolean)

  if (normalizeName(cleaned[0] ?? '') === 'board games' && /^[a-z0-9]$/i.test(cleaned[1] ?? '')) {
    cleaned.splice(1, 1)
  }

  if (normalizeName(cleaned[0] ?? '') === '0_processing') {
    cleaned[0] = 'Processing'
  }

  return cleaned
}

function categoryLabel(categories: string[]): string {
  return categories.join(' › ') || 'Uncategorized'
}

function isCardSingle(categories: string[]): boolean {
  return categories.some((category) => normalizeName(category) === 'singles')
}

function categoryPriority(categories: string[]): number {
  return normalizeName(categories[0] ?? '') === 'processing' ? 0 : 1
}

function isHideyHoleInventoryRecord(rawName: string, rawCategories: string[]): boolean {
  return (
    /^\s*\[HH\]/i.test(rawName) ||
    rawCategories.some((category) => normalizeName(category).includes('hidey hole'))
  )
}

export function buildBaseReport(
  salesInputs: CsvInput[],
  inventoryInput: CsvInput,
): BaseReport {
  const inventoryRows = parseCsv<InventoryCsvRow>(inventoryInput, REQUIRED_INVENTORY_HEADERS)
  const inventoryMap = new Map<string, InventoryProduct[]>()
  const hideyHoleProductKeys = new Set<string>()
  const categoryNames = new Set<string>()
  const topLevelCategoryNames = new Set<string>()
  const topLevelCategoryLabels = new Map<string, string>()

  for (const row of inventoryRows) {
    const rawPath = row.Product?.trim()
    const balance = parseNumber(row.Balance)
    if (!rawPath || balance == null) continue

    const parts = rawPath.split(/\s*>>\s*/).filter(Boolean)
    if (parts.length === 0) continue
    const rawName = parts.at(-1) ?? ''
    const key = normalizeName(rawName)
    if (!key) continue

    const rawCategories = parts.slice(0, -1)
    if (isHideyHoleInventoryRecord(rawName, rawCategories)) {
      hideyHoleProductKeys.add(key)
      continue
    }

    const cleanedCategoryPath = cleanCategories(rawCategories)
    for (const category of rawCategories) {
      categoryNames.add(normalizeName(category))
    }
    if (parts.length > 1) {
      const topLevelKey = normalizeName(parts[0])
      topLevelCategoryNames.add(topLevelKey)
      topLevelCategoryLabels.set(topLevelKey, cleanedCategoryPath[0] ?? cleanDisplayName(parts[0]))
    }

    const product: InventoryProduct = {
      displayName: cleanDisplayName(rawName),
      categories: cleanedCategoryPath,
      balance,
    }
    const existing = inventoryMap.get(key) ?? []
    existing.push(product)
    inventoryMap.set(key, existing)
  }

  const duplicateInventoryGroups = [...inventoryMap.values()].filter(
    (products) => products.length > 1,
  )
  const duplicateInventoryNames = duplicateInventoryGroups.length
  const duplicateInventoryProductNames = duplicateInventoryGroups
    .map((products) => products[0]?.displayName ?? '')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'en-US', { sensitivity: 'base' }))

  const salesTotals = new Map<
    string,
    { displayName: string; quantity: number; firstSeen: number; salesCategories: string[] }
  >()
  let ignoredReportRows = 0
  let salesRows = 0
  let order = 0

  for (const input of salesInputs) {
    const rows = parseCsv<SalesCsvRow>(input, REQUIRED_SALES_HEADERS)
    salesRows += rows.length
    let currentTopLevelCategory = ''
    for (const row of rows) {
      const rawName = row['Products and Categories']?.trim() ?? ''
      const quantity = parseNumber(row.Quantity)
      const currentOrder = order++

      if (!rawName || quantity == null) {
        ignoredReportRows += 1
        continue
      }

      const key = normalizeName(rawName)
      if (!key) continue
      const salesOnlyCategoryLabel = SALES_ONLY_CATEGORY_LABELS.get(key)
      if (salesOnlyCategoryLabel) {
        currentTopLevelCategory = key
        topLevelCategoryLabels.set(key, salesOnlyCategoryLabel)
        continue
      }
      if (topLevelCategoryNames.has(key)) {
        currentTopLevelCategory = key
        continue
      }
      if (categoryNames.has(key)) continue
      if (currentTopLevelCategory === 'events') continue

      const current = salesTotals.get(key)
      if (current) {
        current.quantity += quantity
      } else {
        salesTotals.set(key, {
          displayName: cleanDisplayName(rawName),
          quantity,
          firstSeen: currentOrder,
          salesCategories: currentTopLevelCategory
            ? [topLevelCategoryLabels.get(currentTopLevelCategory) ?? currentTopLevelCategory]
            : [],
        })
      }
    }
  }

  const matchedItems: RestockItem[] = []
  const unmatchedItems: RestockItem[] = []

  for (const [key, sale] of salesTotals) {
    if (sale.quantity <= 0) continue
    const inventoryMatches = inventoryMap.get(key)

    if (!inventoryMatches) {
      if (hideyHoleProductKeys.has(key)) continue
      const categories = sale.salesCategories
      unmatchedItems.push({
        key,
        item: sale.displayName,
        categories,
        categoryLabel: categories.length > 0 ? categoryLabel(categories) : 'Needs Review',
        currentStock: null,
        qtySold: sale.quantity,
        qtyToPull: 0,
        firstSeen: sale.firstSeen,
        isCardSingle: isCardSingle(categories),
        issue: 'not-found',
      })
      continue
    }

    const balance = inventoryMatches.reduce((sum, product) => sum + product.balance, 0)
    const categorySource =
      inventoryMatches.find(
        (product) => product.balance !== 0 && normalizeName(product.categories[0] ?? '') !== 'deactivate',
      ) ?? inventoryMatches.find((product) => normalizeName(product.categories[0] ?? '') !== 'deactivate') ?? inventoryMatches[0]
    const categories = categorySource.categories
    const issue = balance < 0 ? 'negative-stock' : balance === 0 ? 'zero-stock' : undefined

    matchedItems.push({
      key,
      item: categorySource.displayName || sale.displayName,
      categories,
      categoryLabel: categoryLabel(categories),
      currentStock: balance,
      qtySold: sale.quantity,
      qtyToPull: Math.max(0, Math.min(sale.quantity, balance)),
      firstSeen: sale.firstSeen,
      isCardSingle: isCardSingle(categories),
      issue,
    })
  }

  const warnings: string[] = []
  if (duplicateInventoryNames > 0) {
    warnings.push(
      `${duplicateInventoryNames} product names appeared more than once in inventory; their balances were combined.`,
    )
  }
  if (unmatchedItems.length > 0) {
    warnings.push(
      `${unmatchedItems.length} sold item${unmatchedItems.length === 1 ? '' : 's'} could not be matched to inventory and will print under Verify Stock.`,
    )
  }

  return {
    matchedItems,
    unmatchedItems,
    ignoredReportRows,
    duplicateInventoryNames,
    duplicateInventoryProductNames,
    inventoryRows: inventoryRows.length,
    salesRows,
    warnings,
    salesFileNames: salesInputs.map((input) => input.name),
    inventoryFileName: inventoryInput.name,
  }
}

function parseIgnoreRules(ignoreText: string): { exact: Set<string>; prefixes: string[] } {
  const exact = new Set<string>()
  const prefixes: string[] = []

  for (const line of ignoreText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.endsWith('*')) {
      const prefix = normalizeName(trimmed.slice(0, -1))
      if (prefix) prefixes.push(prefix)
    } else {
      exact.add(normalizeName(trimmed))
    }
  }

  return { exact, prefixes }
}

function matchesIgnoreRule(
  item: RestockItem,
  rules: { exact: Set<string>; prefixes: string[] },
): boolean {
  if (
    SYSTEM_IGNORED_ITEM_KEYS.has(item.key) ||
    rules.exact.has(item.key) ||
    rules.prefixes.some((prefix) => item.key.startsWith(prefix))
  ) {
    return true
  }
  const fullPath = normalizeName(item.categoryLabel.replaceAll('›', '>>'))
  if (rules.exact.has(fullPath)) return true
  return item.categories.some((category) => {
    const categoryKey = normalizeName(category)
    return SYSTEM_IGNORED_CATEGORY_KEYS.has(categoryKey) || rules.exact.has(categoryKey)
  })
}

export function applyReportSettings(
  base: BaseReport,
  settings: ReportSettings,
): DisplayReport {
  const ignoreRules = parseIgnoreRules(settings.ignoreText)
  let ignoredItems = 0
  let hiddenSingles = 0

  const includedMatched = base.matchedItems.filter((item) => {
    if (matchesIgnoreRule(item, ignoreRules)) {
      ignoredItems += 1
      return false
    }
    if (!settings.includeCardSingles && item.isCardSingle) {
      hiddenSingles += 1
      return false
    }
    return true
  })

  const includedUnmatched = base.unmatchedItems.filter((item) => {
    if (matchesIgnoreRule(item, ignoreRules)) {
      ignoredItems += 1
      return false
    }
    return true
  })

  const restockItems = includedMatched.filter((item) => !item.issue)
  const verifyItems = [...includedMatched.filter((item) => item.issue), ...includedUnmatched].sort(
    (a, b) => a.firstSeen - b.firstSeen,
  )

  const verifyGroupMap = new Map<string, ReportGroup>()
  for (const item of verifyItems) {
    const key = normalizeName(item.categoryLabel)
    const group = verifyGroupMap.get(key)
    if (group) {
      group.items.push(item)
    } else {
      verifyGroupMap.set(key, { key, label: item.categoryLabel, items: [item] })
    }
  }

  const verifyGroups = [...verifyGroupMap.values()].sort((a, b) => {
    const aPriority = categoryPriority(a.items[0]?.categories ?? [])
    const bPriority = categoryPriority(b.items[0]?.categories ?? [])
    if (aPriority !== bPriority) return aPriority - bPriority
    return (a.items[0]?.firstSeen ?? 0) - (b.items[0]?.firstSeen ?? 0)
  })

  const groupMap = new Map<string, ReportGroup>()
  for (const item of restockItems.sort((a, b) => a.firstSeen - b.firstSeen)) {
    const key = normalizeName(item.categoryLabel)
    const group = groupMap.get(key)
    if (group) {
      group.items.push(item)
    } else {
      groupMap.set(key, { key, label: item.categoryLabel, items: [item] })
    }
  }

  const groups = [...groupMap.values()].sort((a, b) => {
    const aPriority = categoryPriority(a.items[0]?.categories ?? [])
    const bPriority = categoryPriority(b.items[0]?.categories ?? [])
    if (aPriority !== bPriority) return aPriority - bPriority
    return (a.items[0]?.firstSeen ?? 0) - (b.items[0]?.firstSeen ?? 0)
  })

  return {
    ...base,
    groups,
    verifyItems,
    verifyGroups,
    ignoredItems,
    hiddenSingles,
    restockItemCount: restockItems.length,
    totalUnitsToPull: restockItems.reduce((sum, item) => sum + item.qtyToPull, 0),
  }
}

export function formatQuantity(value: number | null): string {
  if (value == null) return 'Not found'
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
