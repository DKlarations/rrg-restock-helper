import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatedCheckbox, TextStateSwap } from '@rrg/ui-motion'
import MotionDetails from './MotionDetails'
import {
  AlertTriangle,
  ChevronDown,
  FileSpreadsheet,
  FileUp,
  Info,
  Printer,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from 'lucide-react'
import './App.css'
import {
  applyReportSettings,
  buildBaseReport,
  DEFAULT_SETTINGS,
  formatQuantity,
  splitReportIntoParts,
  type BaseReport,
  type CsvInput,
  type ReportGroup,
  type ReportSettings,
  type RestockItem,
} from './lib/restock'

type LoadedFile = CsvInput & {
  id: string
  size: number
}

const STORAGE_KEY = 'rrg-restock-helper-settings-v8'
const PREVIOUS_STORAGE_KEY = 'rrg-restock-helper-settings-v7'
const LEGACY_DEFAULT_IGNORE_TEXT = [
  'Soda',
  'Food',
  'ad hoc*',
  'D&A',
  'Event',
  'Events',
  'Rental',
  'Tickets',
].join('\n')
const ROW_DENSITIES: ReportSettings['rowDensity'][] = [
  'microcompact',
  'subcompact',
  'compact',
  'standard',
  'roomy',
]
const ROW_DENSITY_LABELS: Record<ReportSettings['rowDensity'], string> = {
  microcompact: 'Micro-Compact',
  subcompact: 'Subcompact',
  compact: 'Compact',
  standard: 'Standard',
  roomy: 'Roomy',
}

function loadSettings(): ReportSettings {
  try {
    const currentStored = localStorage.getItem(STORAGE_KEY)
    const previousStored = localStorage.getItem(PREVIOUS_STORAGE_KEY)
    const stored = currentStored ?? previousStored
    if (!stored) return DEFAULT_SETTINGS

    const saved = JSON.parse(stored) as Partial<ReportSettings>
    const isMigratingPreviousDefaults = currentStored == null && previousStored != null
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      splitReport: false,
      printFontSize:
        isMigratingPreviousDefaults && saved.printFontSize === 10
          ? DEFAULT_SETTINGS.printFontSize
          : saved.printFontSize ?? DEFAULT_SETTINGS.printFontSize,
      rowDensity:
        isMigratingPreviousDefaults && saved.rowDensity === 'standard'
          ? DEFAULT_SETTINGS.rowDensity
          : saved.rowDensity ?? DEFAULT_SETTINGS.rowDensity,
      ignoreText:
        saved.ignoreText == null || saved.ignoreText === LEGACY_DEFAULT_IGNORE_TEXT
          ? DEFAULT_SETTINGS.ignoreText
          : saved.ignoreText,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

async function readFile(file: File): Promise<LoadedFile> {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}`,
    name: file.name,
    size: file.size,
    text: await file.text(),
  }
}

function FileDropZone({
  title,
  description,
  multiple,
  files,
  onFiles,
  onRemove,
}: {
  title: string
  description: string
  multiple: boolean
  files: LoadedFile[]
  onFiles: (files: File[]) => void
  onRemove: (id: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const acceptFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return
      onFiles([...fileList].filter((file) => file.name.toLowerCase().endsWith('.csv')))
    },
    [onFiles],
  )

  return (
    <section className="upload-column">
      <div className="upload-heading">
        <span className="step-number">{multiple ? '1' : '2'}</span>
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>

      <button
        type="button"
        className={`drop-zone ${isDragging ? 'is-dragging' : ''} ${files.length ? 'has-files' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          acceptFiles(event.dataTransfer.files)
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          multiple={multiple}
          onChange={(event) => {
            acceptFiles(event.target.files)
            event.currentTarget.value = ''
          }}
        />
        <FileUp size={28} aria-hidden="true" />
        <strong>Drop {multiple ? 'sales reports' : 'an inventory report'} here</strong>
        <span>or click to browse</span>
      </button>

      <div className="file-list" aria-live="polite">
        {files.map((file) => (
          <div className="file-pill" key={file.id}>
            <FileSpreadsheet size={17} aria-hidden="true" />
            <span title={file.name}>{file.name}</span>
            <small>{Math.max(1, Math.round(file.size / 1024))} KB</small>
            <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}>
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function ReportRow({ item }: { item: RestockItem }) {
  return (
    <div className="report-row">
      <span className="pull-checkbox" aria-hidden="true" />
      <span className="report-item-name">{item.item}</span>
      <strong className="qty-to-pull">{formatQuantity(item.qtyToPull)}</strong>
      <span className="qty-sold">{formatQuantity(item.qtySold)}</span>
      <span className={`current-stock ${item.currentStock != null && item.currentStock < 0 ? 'negative-number' : ''}`}>
        {formatQuantity(item.currentStock)}
      </span>
    </div>
  )
}

function ReportTableHeader() {
  return (
    <div className="report-row report-table-header">
      <span className="item-heading">Item</span>
      <span>Qty to Pull</span>
      <span>Qty Sold</span>
      <span>Current Stock</span>
    </div>
  )
}

function ReportGroups({
  groups,
  showCategoryHeadings,
}: {
  groups: ReportGroup[]
  showCategoryHeadings: boolean
}) {
  return groups.map((group) => (
    <section className="report-group" key={group.key}>
      {showCategoryHeadings && <h3>{group.label}</h3>}
      {group.items.map((item) => <ReportRow item={item} key={item.key} />)}
    </section>
  ))
}

function VerifySection({
  groups,
  packet = false,
}: {
  groups: ReportGroup[]
  packet?: boolean
}) {
  if (groups.length === 0) return null

  return (
    <section className={`verify-section${packet ? ' packet-verify-section' : ''}`}>
      <div className="verify-heading">
        <AlertTriangle size={20} />
        <div>
          <h3>VERIFY STOCK</h3>
          <p>These items are out of stock, negative, or missing from the inventory report.</p>
        </div>
      </div>
      <ReportTableHeader />
      {groups.map((group) => (
        <section className="verify-group" key={group.key}>
          <h4>{group.label}</h4>
          {group.items.map((item) => (
            <ReportRow item={item} key={`${item.key}-${item.firstSeen}`} />
          ))}
        </section>
      ))}
    </section>
  )
}

function App() {
  const [salesFiles, setSalesFiles] = useState<LoadedFile[]>([])
  const [inventoryFiles, setInventoryFiles] = useState<LoadedFile[]>([])
  const [baseReport, setBaseReport] = useState<BaseReport | null>(null)
  const [settings, setSettings] = useState<ReportSettings>(loadSettings)
  const [error, setError] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [printDate, setPrintDate] = useState(() => new Date())

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    const updatePrintDate = () => setPrintDate(new Date())
    window.addEventListener('beforeprint', updatePrintDate)
    return () => window.removeEventListener('beforeprint', updatePrintDate)
  }, [])

  const report = useMemo(
    () => (baseReport ? applyReportSettings(baseReport, settings) : null),
    [baseReport, settings],
  )

  const splitParts = useMemo(() => {
    if (!report) return []
    if (!settings.splitReport) {
      return [{
        groups: report.groups,
        verifyGroups: [],
        restockItemCount: report.restockItemCount,
        verifyItemCount: 0,
        workload: report.restockItemCount,
      }]
    }
    return splitReportIntoParts(
      report.groups,
      settings.printVerifyStock ? report.verifyGroups : [],
      settings.splitCount,
    )
  }, [report, settings.printVerifyStock, settings.splitCount, settings.splitReport])

  const totalPrintableRows = (report?.restockItemCount ?? 0) +
    (settings.printVerifyStock ? report?.verifyItems.length ?? 0 : 0)
  const maximumNumericSplit = Math.max(2, Math.min(5, totalPrintableRows || 2))
  const splitCountOptions = Array.from(
    { length: maximumNumericSplit - 1 },
    (_, index) => index + 2,
  )
  const splitCountValue = settings.splitCount === 'max'
    ? 'max'
    : String(Math.max(2, Math.min(settings.splitCount, maximumNumericSplit)))

  const addSalesFiles = useCallback(async (files: File[]) => {
    const loaded = await Promise.all(files.map(readFile))
    setSalesFiles((current) => {
      const ids = new Set(current.map((file) => file.id))
      return [...current, ...loaded.filter((file) => !ids.has(file.id))]
    })
    setBaseReport(null)
    setError('')
  }, [])

  const addInventoryFile = useCallback(async (files: File[]) => {
    const file = files.at(-1)
    if (!file) return
    setInventoryFiles([await readFile(file)])
    setBaseReport(null)
    setError('')
  }, [])

  const processFiles = () => {
    if (!salesFiles.length || !inventoryFiles.length) return
    setIsProcessing(true)
    setError('')
    window.setTimeout(() => {
      try {
        const nextReport = buildBaseReport(salesFiles, inventoryFiles[0])
        setBaseReport(nextReport)
      } catch (processingError) {
        setBaseReport(null)
        setError(processingError instanceof Error ? processingError.message : 'The reports could not be processed.')
      } finally {
        setIsProcessing(false)
      }
    }, 25)
  }

  const reset = () => {
    setSalesFiles([])
    setInventoryFiles([])
    setBaseReport(null)
    setError('')
  }

  const updateSetting = <K extends keyof ReportSettings>(key: K, value: ReportSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }

  const printReport = () => {
    setPrintDate(new Date())
    window.setTimeout(() => window.print(), 0)
  }

  const reportStyle = {
    '--print-font-size': `${settings.printFontSize}pt`,
    '--report-row-padding': {
      microcompact: '0',
      subcompact: '0.06rem',
      compact: '0.15rem',
      standard: '0.23rem',
      roomy: '0.4rem',
    }[settings.rowDensity],
    '--category-row-padding': {
      microcompact: '0.04rem',
      subcompact: '0.12rem',
      compact: '0.2rem',
      standard: '0.34rem',
      roomy: '0.55rem',
    }[settings.rowDensity],
    '--verify-category-row-padding': {
      microcompact: '0.03rem',
      subcompact: '0.08rem',
      compact: '0.13rem',
      standard: '0.2rem',
      roomy: '0.28rem',
    }[settings.rowDensity],
    '--report-row-min-height': {
      microcompact: '1.05rem',
      subcompact: '1.35rem',
      compact: '1.65rem',
      standard: '1.95rem',
      roomy: '2.25rem',
    }[settings.rowDensity],
    '--pull-checkbox-size': {
      microcompact: '0.82rem',
      subcompact: '0.95rem',
      compact: '1.03rem',
      standard: '1.1rem',
      roomy: '1.18rem',
    }[settings.rowDensity],
  } as React.CSSProperties

  return (
    <div className="app-shell">
      <header className="site-header">
        <img src="/rrg-header-logo.png" alt="Red Raccoon Games" />
        <div className="title-lockup">
          <h1>RRG Restockulator</h1>
          <span className="version-badge">v0.1.2</span>
        </div>
        <img src="/rrg-header-logo.png" alt="" aria-hidden="true" />
      </header>

      <main>
        <section className="workspace-panel no-print">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">UPLOAD REPORTS</p>
              <h2>Choose the files to compare</h2>
            </div>
            {(salesFiles.length > 0 || inventoryFiles.length > 0) && (
              <button type="button" className="icon-button text-button" onClick={reset}>
                <Trash2 size={17} /> Clear all
              </button>
            )}
          </div>

          <div className="upload-grid">
            <FileDropZone
              title="Sales reports"
              description="One or more EmailProductSales CSV files"
              multiple
              files={salesFiles}
              onFiles={addSalesFiles}
              onRemove={(id) => {
                setSalesFiles((files) => files.filter((file) => file.id !== id))
                setBaseReport(null)
              }}
            />
            <FileDropZone
              title="Current inventory"
              description="One InventoryReport CSV file"
              multiple={false}
              files={inventoryFiles}
              onFiles={addInventoryFile}
              onRemove={() => {
                setInventoryFiles([])
                setBaseReport(null)
              }}
            />
          </div>

          {error && (
            <div className="message error-message" role="alert">
              <AlertTriangle size={18} />
              <TextStateSwap>{error}</TextStateSwap>
            </div>
          )}

          <div className="process-row">
            <p>
              Files stay on this computer. Nothing is uploaded when the list is processed.
            </p>
            <button
              type="button"
              className="primary-button"
              disabled={!salesFiles.length || !inventoryFiles.length || isProcessing}
              onClick={processFiles}
            >
              <TextStateSwap reserve={['Processing…', 'Process Reports']}>
                {isProcessing ? 'Processing…' : 'Process Reports'}
              </TextStateSwap>
            </button>
          </div>
        </section>

        {report && (
          <>
            <section className="results-toolbar no-print">
              <div>
                <p className="eyebrow">
                  <TextStateSwap reserve={['PROCESSING…', 'REPORT READY']}>
                    {isProcessing ? 'PROCESSING…' : 'REPORT READY'}
                  </TextStateSwap>
                </p>
                <h2>{report.restockItemCount} items ready to restock</h2>
                <p>{formatQuantity(report.totalUnitsToPull)} total units to pull</p>
              </div>
              <div className="toolbar-actions">
                <button type="button" className="secondary-button" onClick={processFiles}>
                  <RotateCcw size={17} /> Reprocess
                </button>
                <button type="button" className="primary-button" onClick={printReport}>
                  <Printer size={18} /> Print Restock List
                </button>
              </div>
            </section>

            <section className="stats-grid no-print" aria-label="Processing summary">
              <div><strong>{report.restockItemCount}</strong><span>Restock items</span></div>
              <div><strong>{report.verifyItems.length}</strong><span>Verify stock</span></div>
              <div><strong>{report.hiddenMiscAndSingles}</strong><span>Misc. / Singles hidden</span></div>
              <div><strong>{report.ignoredItems}</strong><span>Ignored by rule</span></div>
            </section>

            {(report.warnings.length > 0 || report.ignoredReportRows > 0) && (
              <section className="message info-message no-print">
                <Info size={19} />
                <div>
                  {report.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  {report.ignoredReportRows > 0 && <p>{report.ignoredReportRows} footer or incomplete rows were ignored.</p>}
                  {report.duplicateInventoryProductNames.length > 0 && (
                    <MotionDetails className="duplicate-details" summary={
                      <>
                        View duplicate product names
                        <ChevronDown size={15} className="summary-chevron" aria-hidden="true" />
                      </>
                    }>
                      <pre>{report.duplicateInventoryProductNames.join('\n')}</pre>
                    </MotionDetails>
                  )}
                </div>
              </section>
            )}

            <MotionDetails className="settings-panel no-print" summary={
              <>
                <span><Settings2 size={19} /> Report &amp; Print Settings</span>
                <ChevronDown size={19} className="summary-chevron" aria-hidden="true" />
              </>
            }>
              <div className="settings-content">
                <label className="toggle-setting">
                  <AnimatedCheckbox
                    wrapperClassName="motion-toggle"
                    checked={settings.showCategoryHeadings}
                    onChange={(event) => updateSetting('showCategoryHeadings', event.target.checked)}
                  />
                  <span><strong>Print Category Headings</strong><small>Group the report with its inventory path.</small></span>
                </label>
                <label className="toggle-setting">
                  <AnimatedCheckbox
                    wrapperClassName="motion-toggle"
                    checked={settings.printVerifyStock}
                    onChange={(event) => updateSetting('printVerifyStock', event.target.checked)}
                  />
                  <span><strong>Print Verify Stock</strong><small>Include the Verify Stock section on printed pages.</small></span>
                </label>
                <label className="toggle-setting">
                  <AnimatedCheckbox
                    wrapperClassName="motion-toggle"
                    checked={settings.includeMiscAndSingles}
                    onChange={(event) => updateSetting('includeMiscAndSingles', event.target.checked)}
                  />
                  <span><strong>Include card singles</strong><small>Show products inside any Singles category.</small></span>
                </label>
                <label className="field-setting">
                  <span><strong>Print text size</strong><small>{settings.printFontSize} pt</small></span>
                  <input
                    type="range"
                    min="6"
                    max="14"
                    step="1"
                    value={settings.printFontSize}
                    onChange={(event) => updateSetting('printFontSize', Number(event.target.value))}
                  />
                </label>
                <label className="field-setting">
                  <span><strong>Row spacing</strong><small>{ROW_DENSITY_LABELS[settings.rowDensity]}</small></span>
                  <input
                    type="range"
                    min="0"
                    max={ROW_DENSITIES.length - 1}
                    step="1"
                    value={ROW_DENSITIES.indexOf(settings.rowDensity)}
                    onChange={(event) =>
                      updateSetting('rowDensity', ROW_DENSITIES[Number(event.target.value)] ?? 'standard')
                    }
                  />
                </label>
                <div className="split-setting">
                  <label className="toggle-setting split-toggle-control">
                    <AnimatedCheckbox
                      wrapperClassName="motion-toggle"
                      checked={settings.splitReport}
                      onChange={(event) => updateSetting('splitReport', event.target.checked)}
                    />
                    <span>
                      <strong>Split restock list</strong>
                      <small>
                        {settings.splitCount === 'max'
                          ? 'Automatic · about 25 work units per part'
                          : 'Balanced by workload'}
                      </small>
                    </span>
                  </label>
                  <select
                    aria-label="Divide restock list into"
                    value={splitCountValue}
                    disabled={!settings.splitReport}
                    onChange={(event) =>
                      updateSetting(
                        'splitCount',
                        event.target.value === 'max' ? 'max' : Number(event.target.value),
                      )
                    }
                  >
                    {splitCountOptions.map((count) => (
                      <option value={count} key={count}>{count}</option>
                    ))}
                    <option value="max">MAX25</option>
                  </select>
                </div>
                <label className="ignore-setting">
                  <span>
                    <strong>Ignore list</strong>
                    <small>
                      One item or category per line.
                      <br />
                      End a name with * to ignore every matching prefix.
                    </small>
                  </span>
                  <textarea
                    rows={6}
                    value={settings.ignoreText}
                    onChange={(event) => updateSetting('ignoreText', event.target.value)}
                    placeholder={'Soda\nSnacks\nTickets\nEvent name prefix*'}
                  />
                </label>
              </div>
            </MotionDetails>

            <section className="report-card" style={reportStyle}>
              <header className="print-report-header">
                <div>
                  <h2>Inventory Restock List</h2>
                </div>
                <div className="report-meta">
                  <span><strong>Date:</strong> {printDate.toLocaleDateString('en-US')}</span>
                </div>
              </header>

              <div className="report-summary-strip">
                <span><strong>{report.restockItemCount}</strong> items</span>
                <span><strong>{formatQuantity(report.totalUnitsToPull)}</strong> units to pull</span>
                <span><strong>{report.groups.length}</strong> sections</span>
              </div>

              {splitParts.map((part, partIndex) => {
                return (
                  <section
                    className={settings.splitReport ? 'split-report-part' : 'report-part'}
                    key={`part-${partIndex}-${part.groups.map((group) => group.key).join('|')}`}
                  >
                    {settings.splitReport && (
                      <div className="split-part-heading">
                        <strong>RESTOCK PART {partIndex + 1} OF {splitParts.length}</strong>
                        <span>
                          {part.restockItemCount} restock · {part.verifyItemCount} verify ·{' '}
                          {part.workload} work unit{part.workload === 1 ? '' : 's'}
                        </span>
                      </div>
                    )}
                    {part.groups.length > 0 && (
                      <>
                        <ReportTableHeader />
                        <ReportGroups
                          groups={part.groups}
                          showCategoryHeadings={settings.showCategoryHeadings}
                        />
                      </>
                    )}
                    {settings.splitReport && (
                      <VerifySection groups={part.verifyGroups} packet />
                    )}
                  </section>
                )
              })}

              {report.groups.length === 0 && !settings.splitReport && (
                <div className="empty-report">No in-stock restock items remain with the current settings.</div>
              )}

              {!settings.splitReport && settings.printVerifyStock && (
                <VerifySection groups={report.verifyGroups} />
              )}

              <footer className="print-footer">
                Generated by RRG Restockulator · {report.salesFileNames.length} sales report{report.salesFileNames.length === 1 ? '' : 's'} compared with {report.inventoryFileName}
              </footer>
            </section>
          </>
        )}

      </main>

      <footer className="site-footer no-print">
        <span>Updated: 9.15.2026</span>
        <span>As always, let me know if you have any issues or ideas with this -Derek</span>
      </footer>
    </div>
  )
}

export default App
