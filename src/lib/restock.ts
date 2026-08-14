import Papa from 'papaparse'

export type CsvInput = {
  name: string
  text: string
}

export type ReportSettings = {
  includeMiscAndSingles: boolean
  showCategoryHeadings: boolean
  printVerifyStock: boolean
  splitReport: boolean
  splitCount: number | 'max'
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
  isMiscOrSingle: boolean
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

export type SplitReportPart = {
  groups: ReportGroup[]
  verifyGroups: ReportGroup[]
  restockItemCount: number
  verifyItemCount: number
  workload: number
}

export type DisplayReport = BaseReport & {
  groups: ReportGroup[]
  verifyItems: RestockItem[]
  verifyGroups: ReportGroup[]
  ignoredItems: number
  hiddenMiscAndSingles: number
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
  includeMiscAndSingles: false,
  showCategoryHeadings: true,
  printVerifyStock: true,
  splitReport: false,
  splitCount: 2,
  printFontSize: 10,
  rowDensity: 'standard',
  ignoreText: [
    'D&A',
    'Event',
    'Events',
    'Food',
    'Rental',
    'Soda',
    'Tickets',
    'ad hoc*',
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

function containsMiscOrSingles(value: string): boolean {
  return /(^|[^a-z0-9])(misc|singles)(?=$|[^a-z0-9])/.test(normalizeName(value))
}

function isMiscOrSingle(itemName: string, categories: string[]): boolean {
  return containsMiscOrSingles(itemName) || categories.some(containsMiscOrSingles)
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
        isMiscOrSingle: isMiscOrSingle(sale.displayName, categories),
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
      isMiscOrSingle: isMiscOrSingle(categorySource.displayName || sale.displayName, categories),
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
  let hiddenMiscAndSingles = 0

  const includedMatched = base.matchedItems.filter((item) => {
    if (matchesIgnoreRule(item, ignoreRules)) {
      ignoredItems += 1
      return false
    }
    if (!settings.includeMiscAndSingles && item.isMiscOrSingle) {
      hiddenMiscAndSingles += 1
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
    hiddenMiscAndSingles,
    restockItemCount: restockItems.length,
    totalUnitsToPull: restockItems.reduce((sum, item) => sum + item.qtyToPull, 0),
  }
}

export function splitReportGroups(
  groups: ReportGroup[],
  requestedParts: number | 'max',
): ReportGroup[][] {
  if (groups.length === 0) return []
  const totalItems = groups.reduce((sum, group) => sum + group.items.length, 0)
  if (totalItems === 0) return [groups]

  const normalizedRequestedParts = requestedParts === 'max'
    ? Math.max(1, Math.round(totalItems / 25))
    : Number.isFinite(requestedParts)
      ? Math.floor(requestedParts)
      : 1
  const partCount = Math.max(1, Math.min(totalItems, normalizedRequestedParts))
  if (partCount === 1) return [groups]

  const assignments = Array.from({ length: partCount }, () => ({
    itemCount: 0,
    groups: [] as Array<{
      group: ReportGroup
      items: RestockItem[]
      originalIndex: number
    }>,
  }))
  const largestCategoriesFirst = groups
    .map((group, originalIndex) => ({ group, originalIndex }))
    .sort((a, b) => b.group.items.length - a.group.items.length || a.originalIndex - b.originalIndex)

  for (const category of largestCategoriesFirst) {
    let lightestPartIndex = 0
    for (let index = 1; index < assignments.length; index += 1) {
      const candidate = assignments[index]
      const lightest = assignments[lightestPartIndex]
      if (
        candidate.itemCount < lightest.itemCount ||
        (candidate.itemCount === lightest.itemCount && candidate.groups.length < lightest.groups.length)
      ) {
        lightestPartIndex = index
      }
    }

    assignments[lightestPartIndex].groups.push({
      ...category,
      items: [...category.group.items],
    })
    assignments[lightestPartIndex].itemCount += category.group.items.length
  }

  const targetItemsPerPart = totalItems / partCount
  const allowedDifference = Math.max(2, Math.floor(targetItemsPerPart * 0.08))
  const maximumRebalanceSteps = totalItems * partCount

  for (let step = 0; step < maximumRebalanceSteps; step += 1) {
    let heaviestPartIndex = 0
    let lightestPartIndex = 0
    for (let index = 1; index < assignments.length; index += 1) {
      if (assignments[index].itemCount > assignments[heaviestPartIndex].itemCount) {
        heaviestPartIndex = index
      }
      if (assignments[index].itemCount < assignments[lightestPartIndex].itemCount) {
        lightestPartIndex = index
      }
    }

    const heaviest = assignments[heaviestPartIndex]
    const lightest = assignments[lightestPartIndex]
    const difference = heaviest.itemCount - lightest.itemCount
    if (difference <= allowedDifference) break

    let wholeGroupIndex = -1
    let bestWholeGroupDifference = difference
    for (let index = 0; index < heaviest.groups.length; index += 1) {
      const itemCount = heaviest.groups[index].items.length
      const nextDifference = Math.abs(
        (heaviest.itemCount - itemCount) - (lightest.itemCount + itemCount),
      )
      if (nextDifference < bestWholeGroupDifference) {
        wholeGroupIndex = index
        bestWholeGroupDifference = nextDifference
      }
    }

    if (wholeGroupIndex >= 0) {
      const [movedGroup] = heaviest.groups.splice(wholeGroupIndex, 1)
      heaviest.itemCount -= movedGroup.items.length
      lightest.groups.push(movedGroup)
      lightest.itemCount += movedGroup.items.length
      continue
    }

    const splittableGroupIndex = heaviest.groups.reduce(
      (largestIndex, group, index, allGroups) =>
        group.items.length > allGroups[largestIndex].items.length ? index : largestIndex,
      0,
    )
    const splittableGroup = heaviest.groups[splittableGroupIndex]
    if (!splittableGroup || splittableGroup.items.length < 2) break

    const desiredMove = Math.max(1, Math.floor(difference / 2))
    const moveCount = Math.min(desiredMove, splittableGroup.items.length - 1)
    const movedItems = splittableGroup.items.splice(-moveCount)
    heaviest.itemCount -= movedItems.length
    lightest.groups.push({ ...splittableGroup, items: movedItems })
    lightest.itemCount += movedItems.length
  }

  return assignments
    .map((assignment, partIndex) => {
      const combinedGroups = new Map<number, { group: ReportGroup; items: RestockItem[] }>()
      for (const assignedGroup of assignment.groups) {
        const existing = combinedGroups.get(assignedGroup.originalIndex)
        if (existing) {
          existing.items.push(...assignedGroup.items)
        } else {
          combinedGroups.set(assignedGroup.originalIndex, {
            group: assignedGroup.group,
            items: [...assignedGroup.items],
          })
        }
      }

      const orderedGroups = [...combinedGroups.entries()].sort(([a], [b]) => a - b)
      return {
        firstOriginalIndex: orderedGroups[0]?.[0] ?? Number.POSITIVE_INFINITY,
        groups: orderedGroups.map(([originalIndex, { group, items }]) => {
          const itemOrder = new Map(group.items.map((item, index) => [item, index]))
          return {
            ...group,
            key: `${group.key}--split-${partIndex}-${originalIndex}`,
            items: items.sort((a, b) => (itemOrder.get(a) ?? 0) - (itemOrder.get(b) ?? 0)),
          }
        }),
      }
    })
    .sort((a, b) => a.firstOriginalIndex - b.firstOriginalIndex)
    .map((assignment) => assignment.groups)
}

const VERIFY_WORKLOAD = 3
const MAX_PACKET_WORKLOAD = 25

function groupTopLevelKey(group: ReportGroup): string {
  const category = group.items[0]?.categories[0] ?? group.label.split(/\s*[›>]\s*/)[0] ?? ''
  return normalizeName(category)
}

function partHasGroup(part: SplitReportPart, groupKey: string): boolean {
  return part.groups.some((group) => normalizeName(group.label) === groupKey)
}

function partHasTopLevelCategory(part: SplitReportPart, topLevelKey: string): boolean {
  return part.groups.some((group) => groupTopLevelKey(group) === topLevelKey)
}

function addVerifyItems(
  part: SplitReportPart,
  group: ReportGroup,
  items: RestockItem[],
  partIndex: number,
  groupIndex: number,
): void {
  const existing = part.verifyGroups.find((candidate) => candidate.key.startsWith(`${group.key}--verify-split-`))
  if (existing) {
    existing.items.push(...items)
  } else {
    part.verifyGroups.push({
      ...group,
      key: `${group.key}--verify-split-${partIndex}-${groupIndex}`,
      items: [...items],
    })
  }
  part.verifyItemCount += items.length
  part.workload += items.length * VERIFY_WORKLOAD
}

/**
 * Creates coworker packets using weighted work rather than printed row count.
 * Ordinary restock rows cost one unit; Verify Stock rows cost three. Categories
 * stay together unless keeping one intact would make the packets substantially
 * uneven, and Verify Stock prefers the packet already handling its category.
 */
export function splitReportIntoParts(
  groups: ReportGroup[],
  verifyGroups: ReportGroup[],
  requestedParts: number | 'max',
): SplitReportPart[] {
  const restockItemCount = groups.reduce((sum, group) => sum + group.items.length, 0)
  const verifyItemCount = verifyGroups.reduce((sum, group) => sum + group.items.length, 0)
  const totalRows = restockItemCount + verifyItemCount
  if (totalRows === 0) return []

  const totalWorkload = restockItemCount + verifyItemCount * VERIFY_WORKLOAD
  const normalizedRequestedParts = requestedParts === 'max'
    ? Math.max(1, Math.round(totalWorkload / MAX_PACKET_WORKLOAD))
    : Number.isFinite(requestedParts)
      ? Math.floor(requestedParts)
      : 1
  const partCount = Math.max(1, Math.min(totalRows, normalizedRequestedParts))
  const restockParts = groups.length > 0 ? splitReportGroups(groups, partCount) : []
  const parts: SplitReportPart[] = Array.from({ length: partCount }, (_, index) => {
    const partGroups = restockParts[index] ?? []
    const itemCount = partGroups.reduce((sum, group) => sum + group.items.length, 0)
    return {
      groups: partGroups,
      verifyGroups: [],
      restockItemCount: itemCount,
      verifyItemCount: 0,
      workload: itemCount,
    }
  })

  const targetWorkload = totalWorkload / partCount
  const allowedDifference = Math.max(VERIFY_WORKLOAD, Math.floor(targetWorkload * 0.12))
  const orderedVerifyGroups = verifyGroups
    .map((group, originalIndex) => ({ group, originalIndex }))
    .sort((a, b) => b.group.items.length - a.group.items.length || a.originalIndex - b.originalIndex)

  for (const { group, originalIndex } of orderedVerifyGroups) {
    const fullCategoryKey = normalizeName(group.label)
    const topLevelKey = groupTopLevelKey(group)
    const exactCandidates = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => partHasGroup(part, fullCategoryKey))
    const topLevelCandidates = parts
      .map((part, index) => ({ part, index }))
      .filter(({ part }) => partHasTopLevelCategory(part, topLevelKey))
    const preferredCandidates = exactCandidates.length > 0
      ? exactCandidates
      : topLevelCandidates.length > 0
        ? topLevelCandidates
        : parts.map((part, index) => ({ part, index }))
    const lightestPreferred = preferredCandidates.reduce((lightest, candidate) =>
      candidate.part.workload < lightest.part.workload ? candidate : lightest,
    )
    const groupWorkload = group.items.length * VERIFY_WORKLOAD
    const projectedWorkloads = parts.map((part, index) =>
      index === lightestPreferred.index ? part.workload + groupWorkload : part.workload,
    )
    const projectedSpread = Math.max(...projectedWorkloads) - Math.min(...projectedWorkloads)
    const shouldKeepWhole =
      group.items.length <= 3 ||
      projectedSpread <= allowedDifference

    if (shouldKeepWhole) {
      addVerifyItems(lightestPreferred.part, group, group.items, lightestPreferred.index, originalIndex)
      continue
    }

    // An oversized Verify category may cross packets. Workload wins first;
    // category affinity breaks ties so related work still stays together where possible.
    for (const item of group.items) {
      const lightestWorkload = Math.min(...parts.map((part) => part.workload))
      const candidates = parts
        .map((part, index) => ({ part, index }))
        .filter(({ part }) => part.workload <= lightestWorkload + VERIFY_WORKLOAD - 1)
      const best = candidates.reduce((current, candidate) => {
        const currentAffinity = partHasGroup(current.part, fullCategoryKey)
          ? 0
          : partHasTopLevelCategory(current.part, topLevelKey) ? 1 : 2
        const candidateAffinity = partHasGroup(candidate.part, fullCategoryKey)
          ? 0
          : partHasTopLevelCategory(candidate.part, topLevelKey) ? 1 : 2
        if (candidate.part.workload !== current.part.workload) {
          return candidate.part.workload < current.part.workload ? candidate : current
        }
        return candidateAffinity < currentAffinity ? candidate : current
      })
      addVerifyItems(best.part, group, [item], best.index, originalIndex)
    }
  }

  const verifyOrder = new Map(verifyGroups.map((group, index) => [normalizeName(group.label), index]))
  for (const part of parts) {
    part.verifyGroups.sort(
      (a, b) => (verifyOrder.get(normalizeName(a.label)) ?? 0) - (verifyOrder.get(normalizeName(b.label)) ?? 0),
    )
  }

  return parts
}

export function formatQuantity(value: number | null): string {
  if (value == null) return 'Not found'
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
