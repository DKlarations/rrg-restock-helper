import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Accordion, AnimatedCheckbox, TextStateSwap } from '@rrg/ui-motion'
import { AlertTriangle, ChevronDown, Info, Printer, Search, Settings2 } from 'lucide-react'
import MotionDetails from './MotionDetails'
import {
  buildHardReport,
  parseHardInventory,
  sanitizeHardSettings,
  splitHardReport,
  type HardCategoryNode,
  type HardInventory,
  type HardSettings,
} from './lib/hard-restock'
import { formatQuantity, type CsvInput } from './lib/restock'
import type { HardWorkerResult } from './hard-report.worker'
import './HardRestock.css'

const STORAGE_KEY = 'rrg-restock-helper-hard-settings-v1'
const DENSITIES: HardSettings['rowDensity'][] = ['microcompact', 'subcompact', 'compact', 'standard', 'roomy']
const DENSITY_LABELS = ['Micro-Compact', 'Subcompact', 'Compact', 'Standard', 'Roomy']
const ROW_HEIGHTS = ['0.21in', '0.24in', '0.28in', '0.32in', '0.38in']

function readSettings(): HardSettings {
  try { return sanitizeHardSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) }
  catch { return sanitizeHardSettings(null) }
}

function isPrefix(parent: string[], child: string[]): boolean {
  if (parent.length === 0) return child.length === 0
  return parent.length <= child.length && parent.every((part, index) => child[index] === part)
}

function selectionPaths(selected: string[]): string[][] {
  return selected.flatMap((key) => {
    try { const path: unknown = JSON.parse(key); return Array.isArray(path) && path.every((part) => typeof part === 'string') ? [path as string[]] : [] }
    catch { return [] }
  })
}

function matchesSearch(node: HardCategoryNode, search: string): boolean {
  return !search || node.path.join(' › ').toLocaleLowerCase().includes(search) || node.children.some((child) => matchesSearch(child, search))
}

function CategoryNode({ node, selected, search, onChange }: {
  node: HardCategoryNode
  selected: string[]
  search: string
  onChange: (next: string[]) => void
}) {
  const [expanded, setExpanded] = useState(node.path.length <= 1)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const bodyId = useId()
  const paths = selectionPaths(selected)
  const coveredByParent = paths.some((path) => path.length < node.path.length && isPrefix(path, node.path))
  const checked = coveredByParent || selected.includes(node.key)
  const mixed = !checked && paths.some((path) => isPrefix(node.path, path))
  const label = node.path.join(' › ') || node.label
  const open = Boolean(search) || expanded
  if (!matchesSearch(node, search)) return null

  return (
    <li className="hard-category-node">
      <div className="hard-category-line">
        {node.children.length > 0 ? (
          <button ref={triggerRef} type="button" className="hard-tree-expander" aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            aria-expanded={open} aria-controls={bodyId} disabled={Boolean(search)} onClick={() => setExpanded((value) => !value)}>
            <ChevronDown size={15} className={open ? 'hard-chevron-open' : ''} aria-hidden="true" />
          </button>
        ) : <span className="hard-tree-spacer" />}
        <label className={`hard-category-label${coveredByParent ? ' hard-category-inherited' : ''}`} title={coveredByParent ? 'Included by a selected parent. Uncheck that parent to choose individual categories.' : label}>
          <AnimatedCheckbox aria-label={label} checked={checked} indeterminate={mixed} disabled={coveredByParent}
            onChange={(event) => {
              const withoutBranch = selected.filter((key) => {
                try { return !isPrefix(node.path, JSON.parse(key) as string[]) }
                catch { return false }
              })
              onChange(event.target.checked ? [...withoutBranch, node.key] : withoutBranch)
            }} />
          <span>{node.label}</span>
          <small>{node.itemCount.toLocaleString()}</small>
        </label>
      </div>
      {node.children.length > 0 && (
        <Accordion id={bodyId} open={open} triggerRef={triggerRef}>
          <ul>{node.children.map((child) => <CategoryNode key={child.key} node={child} selected={selected} search={search} onChange={onChange} />)}</ul>
        </Accordion>
      )}
    </li>
  )
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const detailId = useId()
  return <label className="toggle-setting hard-toggle"><AnimatedCheckbox wrapperClassName="motion-toggle" aria-label={label} aria-describedby={detail ? detailId : undefined} checked={checked} onChange={(event) => onChange(event.target.checked)} /><span><strong>{label}</strong>{detail && <small id={detailId}>{detail}</small>}</span></label>
}

export type HardRestockPanelProps = {
  inventory: CsvInput | null
  inventoryControl: ReactNode
  busy: boolean
  active: boolean
  inventoryError?: string
}

export default function HardRestockPanel({ inventory, inventoryControl, busy, active, inventoryError }: HardRestockPanelProps) {
  const [settings, setSettings] = useState<HardSettings>(readSettings)
  const [search, setSearch] = useState('')
  const [parsed, setParsed] = useState<{ source: CsvInput; data: HardInventory } | null>(null)
  const [failure, setFailure] = useState<{ source: CsvInput; error: string } | null>(null)
  const [parsingSource, setParsingSource] = useState<CsvInput | null>(null)
  const [preferenceError, setPreferenceError] = useState('')
  const [printDate, setPrintDate] = useState(() => new Date())
  const reportRef = useRef<HTMLDivElement>(null)
  const data = !busy && parsed?.source === inventory ? parsed.data : null
  const parseError = !busy && failure?.source === inventory ? failure.error : ''
  const processing = busy || (parsingSource === inventory && inventory != null)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); setPreferenceError('') }
    catch { setPreferenceError('Preferences cannot be saved in this browser. Your current choices still work until this page closes.') }
  }, [settings])

  useEffect(() => {
    if (!active || busy || !inventory || parsed?.source === inventory || failure?.source === inventory) return
    let cancelled = false
    let worker: Worker | null = null
    let fallback: ReturnType<typeof setTimeout> | undefined
    setParsingSource(inventory)
    const finish = (result: HardWorkerResult) => {
      if (cancelled) return
      worker?.terminate()
      if (result.ok) { setParsed({ source: inventory, data: result.inventory }); setFailure(null) }
      else { setFailure({ source: inventory, error: result.error }); setParsed(null) }
      setParsingSource(null)
    }
    const runFallback = () => {
      if (fallback != null || cancelled) return
      fallback = setTimeout(() => {
        if (cancelled) return
        try { finish({ ok: true, inventory: parseHardInventory(inventory) }) }
        catch (error) { finish({ ok: false, error: error instanceof Error ? error.message : 'The inventory could not be read.' }) }
      }, 25)
    }
    try {
      if (typeof Worker === 'undefined') runFallback()
      else {
        worker = new Worker(new URL('./hard-report.worker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (event: MessageEvent<HardWorkerResult>) => finish(event.data)
        worker.onerror = (event) => { event.preventDefault(); worker?.terminate(); runFallback() }
        worker.postMessage(inventory)
      }
    } catch { worker?.terminate(); runFallback() }
    return () => { cancelled = true; worker?.terminate(); clearTimeout(fallback); setParsingSource(null) }
  }, [inventory, active, busy, parsed?.source, failure?.source])

  const report = useMemo(() => data ? buildHardReport(data, settings) : null, [data, settings])
  const packets = useMemo(() => {
    if (!report?.items.length) return []
    return settings.splitReport ? splitHardReport(report.groups, settings.splitCount) : [report.groups]
  }, [report, settings.splitReport, settings.splitCount])
  const visibleNodes = useMemo(() => data?.categories.filter((node) => matchesSearch(node, search.trim().toLocaleLowerCase())) ?? [], [data, search])
  const update = <K extends keyof HardSettings>(key: K, value: HardSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))

  // Screen preview has the same fixed portrait content width as print. Measure
  // only the name text, retaining the full name and every writing field.
  const fitNames = useCallback(() => {
    if (!active || !reportRef.current) return
    const basePixels = settings.printFontSize * 96 / 72
    const cells = [...reportRef.current.querySelectorAll<HTMLElement>('.hard-item-name')]
      .flatMap((cell) => {
        const label = cell.querySelector<HTMLElement>('.hard-item-label')
        return label ? [{ cell, label }] : []
      })
    // Batch writes, then measurements, then final writes: a large checklist
    // should not force a separate browser layout for each exported row.
    cells.forEach(({ label }) => { label.style.fontSize = `${basePixels}px` })
    const measurements = cells.map(({ cell, label }) => ({ label, width: label.getBoundingClientRect().width, available: cell.clientWidth - 2 }))
    measurements.forEach(({ label, width, available }) => {
      if (available > 0 && width > available) label.style.fontSize = `${Math.max(0.1, basePixels * available / width)}px`
    })
  }, [active, settings.printFontSize])

  useLayoutEffect(() => {
    fitNames()
    const element = reportRef.current
    if (!element) return
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitNames) : null
    observer?.observe(element)
    let cancelled = false
    document.fonts?.ready.then(() => { if (!cancelled) fitNames() })
    return () => { cancelled = true; observer?.disconnect() }
  }, [fitNames, packets])

  useEffect(() => {
    const beforePrint = () => { if (active) { fitNames(); setPrintDate(new Date()) } }
    window.addEventListener('beforeprint', beforePrint)
    return () => window.removeEventListener('beforeprint', beforePrint)
  }, [active, fitNames])

  const densityIndex = DENSITIES.indexOf(settings.rowDensity)
  const reportStyle = { '--hard-font-size': `${settings.printFontSize}pt`, '--hard-row-height': ROW_HEIGHTS[densityIndex] } as CSSProperties
  const selectedCount = settings.selectedCategories.length

  return (
    <div className="hard-workspace">
      <section className="workspace-panel no-print">
        <div className="panel-title-row"><h2>File Upload</h2></div>
        <div className="hard-intake">
          {inventoryControl}
        </div>
      </section>
      {(inventoryError || parseError) && <div className="message error-message no-print" role="alert"><AlertTriangle size={18} /><TextStateSwap>{inventoryError || parseError}</TextStateSwap></div>}
      {preferenceError && <div className="message info-message no-print"><Info size={18} /><p>{preferenceError}</p></div>}
      <p className="hard-inventory-status no-print" role="status"><TextStateSwap>{processing ? 'Reading inventory…' : data ? 'Inventory ready.' : inventory ? parseError ? 'Choose another inventory report to continue.' : 'Open Hard to prepare this inventory.' : 'Upload an inventory report to choose categories.'}</TextStateSwap></p>

      {data && <>
        <section className="workspace-panel hard-selection-panel no-print">
          <div className="panel-title-row"><h2>Categories</h2></div>
          <div className="hard-selection-content">
            <div className="hard-category-controls">
              <label className="hard-search-label"><Search size={17} aria-hidden="true" /><input className="hard-category-search" type="search" aria-label="Search categories" placeholder="Search categories…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
              <div className="hard-selection-actions"><button className="text-button" type="button" onClick={() => update('selectedCategories', data.categories.map((node) => node.key))}>Select all categories</button><button className="text-button" type="button" onClick={() => update('selectedCategories', [])}>Clear category selection</button></div>
              <p className="hard-help">Selecting a parent includes every category below it. Uncheck the parent to choose individual categories. Counts include products hidden by your filters.</p>
              <div className="hard-category-tree" role="group" aria-label="Inventory categories"><ul>{visibleNodes.map((node) => <CategoryNode key={node.key} node={node} selected={settings.selectedCategories} search={search.trim().toLocaleLowerCase()} onChange={(next) => update('selectedCategories', next)} />)}</ul>{visibleNodes.length === 0 && <p className="hard-help">No categories match your search.</p>}</div>
            </div>
            <div className="hard-stock-filters">
              <h3>Stock filters</h3>
              <Toggle label="Include zero-stock items" checked={settings.includeZeroStock} onChange={(value) => update('includeZeroStock', value)} />
              <Toggle label="Negative stock only" checked={settings.negativeStockOnly} onChange={(value) => update('negativeStockOnly', value)} />
              <p className="hard-selection-summary" aria-live="polite">{selectedCount} categor{selectedCount === 1 ? 'y' : 'ies'} selected · {report?.items.length.toLocaleString() ?? 0} checklist items</p>
            </div>
          </div>
        </section>

        {(data.warnings.length > 0 || data.duplicateProductNames.length > 0) && <section className="message info-message no-print"><Info size={19} /><div>{data.warnings.map((warning) => <p key={warning}>{warning}</p>)}{data.duplicateProductNames.length > 0 && <><p>Hard keeps every exported entry and its balance separate; † marks repeated names.</p><MotionDetails className="duplicate-details" summary={<>View duplicate product names<ChevronDown size={15} className="summary-chevron" aria-hidden="true" /></>}><pre>{data.duplicateProductNames.join('\n')}</pre></MotionDetails></>}</div></section>}
      </>}

      <MotionDetails className="settings-panel hard-settings no-print" summary={<><span><Settings2 size={19} /> Hard Report &amp; Print Settings</span><ChevronDown size={19} className="summary-chevron" aria-hidden="true" /></>}>
        <div className="settings-content">
          <Toggle label="Exclude paint and paint markers" detail="Painting Accessories stay available." checked={settings.excludePaint} onChange={(value) => update('excludePaint', value)} />
          <Toggle label="Exclude dice" detail="Other D&A accessories stay available." checked={settings.excludeDice} onChange={(value) => update('excludeDice', value)} />
          <Toggle label="Exclude Deactivate" checked={settings.excludeDeactivate} onChange={(value) => update('excludeDeactivate', value)} />
          <Toggle label="Exclude Z Online Sales" checked={settings.excludeOnlineSales} onChange={(value) => update('excludeOnlineSales', value)} />
          <label className="field-setting"><span><strong>Print text size</strong><small>{settings.printFontSize} pt</small></span><input aria-label="Hard print text size" type="range" min="6" max="14" step="1" value={settings.printFontSize} onChange={(event) => update('printFontSize', Number(event.target.value))} /></label>
          <label className="field-setting"><span><strong>Row spacing</strong><small>{DENSITY_LABELS[densityIndex]}</small></span><input aria-label="Hard row spacing" type="range" min="0" max="4" step="1" value={densityIndex} onChange={(event) => update('rowDensity', DENSITIES[Number(event.target.value)] ?? 'compact')} /></label>
          <div className="split-setting"><Toggle label="Split hard checklist" detail={settings.splitCount === 'max' ? 'Automatic · about 25 items per packet' : 'Balanced by item count'} checked={settings.splitReport} onChange={(value) => update('splitReport', value)} /><select aria-label="Divide hard checklist into" disabled={!settings.splitReport} value={settings.splitCount} onChange={(event) => update('splitCount', event.target.value === 'max' ? 'max' : Number(event.target.value))}>{[2, 3, 4, 5].map((count) => <option key={count} value={count}>{count}</option>)}<option value="max">MAX25</option></select></div>
          <label className="ignore-setting"><span><strong>Ignore list</strong><small>One item, category, or full category path per line. End an item name with * for a prefix. D&amp;D minis remain available unless you exclude them.</small></span><textarea aria-label="Hard ignore list" rows={6} value={settings.ignoreText} onChange={(event) => update('ignoreText', event.target.value)} /></label>
          <p className="hard-help hard-settings-note">These preferences are separate from Soft and saved in this browser. Hidey Hole and non-stock membership/event records are always excluded.</p>
        </div>
      </MotionDetails>

      {data && <section className="results-toolbar no-print"><div><p className="eyebrow">HARD CHECKLIST</p><h2>{report?.items.length.toLocaleString() ?? 0} items on the checklist</h2><p>{report?.excludedItems.toLocaleString() ?? 0} excluded · {report?.zeroStockHidden.toLocaleString() ?? 0} zero-stock hidden · {report?.negativeFilterHidden.toLocaleString() ?? 0} hidden by negative-only filter</p></div><button className="primary-button" type="button" disabled={!report?.items.length || processing || !active} onClick={() => { setPrintDate(new Date()); window.setTimeout(() => { fitNames(); window.print() }, 0) }}><Printer size={18} />Print Hard Checklist</button></section>}
      {data && !report?.items.length && <p className="hard-empty no-print">{selectedCount ? 'No items match the selected categories and filters. Check the exclusions or choose other categories.' : 'Select categories to preview your hard restock checklist.'}</p>}

      {report && report.items.length > 0 && <div className="hard-preview-scroll"><div ref={reportRef} className="hard-report-card" style={reportStyle}>
        <header className="hard-report-heading"><h2>Hard Restock Checklist</h2><span>{printDate.toLocaleDateString('en-US')}</span></header>
        <div className="hard-report-summary">{report.items.length.toLocaleString()} items · {report.groups.length} categories{settings.negativeStockOnly ? ' · NEGATIVE STOCK ONLY' : ''}{report.items.some((item) => item.duplicateName) ? ' · † Repeated names: separate exported entries' : ''}</div>
        {packets.map((groups, packetIndex) => <section className={`hard-packet${settings.splitReport ? ' hard-packet-split' : ''}`} key={packetIndex}>
          {settings.splitReport && <div className="hard-packet-heading"><strong>PACKET {packetIndex + 1} OF {packets.length}</strong></div>}
          <div className="hard-row hard-table-header"><span>Item</span><span>Current<br />Stock</span><span>Upstairs</span><span>Backstock</span><span>Unable<br />to Locate</span></div>
          {groups.map((group) => <section className="hard-report-group" key={group.key}><h3>{group.label}</h3>{group.items.map((item) => <div className="hard-row" data-key={item.key} key={item.key}>
            <span className="hard-item-name" title={item.item}><span className="hard-item-label">{item.item}{item.duplicateName ? ' †' : ''}</span></span>
            <strong className={`hard-current-stock${item.currentStock < 0 ? ' hard-negative-stock' : ''}`}>{formatQuantity(item.currentStock)}</strong>
            <span className="hard-write-field"><span className="hard-paper-checkbox" /><span className="hard-write-line" /></span>
            <span className="hard-write-field"><span className="hard-paper-checkbox" /><span className="hard-write-line" /></span>
            <span className="hard-unable-field"><span className="hard-paper-checkbox" /></span>
          </div>)}</section>)}
        </section>)}
        <footer className="hard-print-footer">Generated with {data?.inventoryFileName}</footer>
      </div></div>}
    </div>
  )
}
