import { memo, useMemo, type ReactNode } from 'react'
import { ChevronDown, FileSpreadsheet } from 'lucide-react'
import { TextStateSwap } from '@rrg/ui-motion'
import MotionDetails from './MotionDetails'
import { formatQuantity, type BaseReport, type HandledSalesTotal } from './lib/restock'
import './RepeatRestock.css'

export type HandledRun = {
  number: number
  markedAt: string
  source: 'move' | 'upload'
  fileNames: string[]
  sourceFileNames: string[]
  latestTotals: HandledSalesTotal[]
  totals: HandledSalesTotal[]
  retainedItems: number
  errors: Comparison[]
}

export type RepeatReportContext = {
  runNumber: number
  generatedAt: string
  handledFileNames: string[]
}

export function RepeatPrintSources({ context, salesFileNames, showGenerated = false }: {
  context: RepeatReportContext
  salesFileNames: string[]
  showGenerated?: boolean
}) {
  return <div className="repeat-print-sources">
    <p><strong>Run {context.runNumber} · Qty Sold shows additional sales.</strong></p>
    {showGenerated && <p><strong>Generated:</strong> {new Date(context.generatedAt).toLocaleString('en-US')}</p>}
    <p><strong>Latest sales:</strong> {salesFileNames.join(', ')}</p>
    <p><strong>Already handled:</strong> {context.handledFileNames.join(', ')}</p>
  </div>
}

type Comparison = NonNullable<BaseReport['repeat']>['comparisons'][number]

const HandledRunDetails = memo(function HandledRunDetails({ run, current }: { run: HandledRun; current: boolean }) {
  const latestByKey = useMemo(() => new Map(run.latestTotals.map((sale) => [sale.key, sale.quantity])), [run.latestTotals])
  return <li className={`repeat-handled-run${current ? ' repeat-handled-current' : ''}`}>
    <div className="repeat-handled-heading">
      <h3>Run {run.number}</h3>
      {current && <span className="repeat-current-badge">Current comparison</span>}
      <span className="repeat-handled-time">{run.source === 'move' ? 'Handled' : 'Added'} <time dateTime={run.markedAt}>{new Date(run.markedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</time></span>
    </div>
    <ul className="repeat-handled-files">{run.fileNames.map((name, index) => <li className="file-pill repeat-handled-file" key={`${index}-${name}`}>
      <FileSpreadsheet size={17} aria-hidden="true" /><span>{name}</span>
    </li>)}</ul>
    <MotionDetails className="repeat-details" summary={<>View quantities <ChevronDown size={16} className="summary-chevron" aria-hidden="true" /></>}>
      <div className="repeat-table-scroll"><table className="repeat-table"><thead><tr><th>Item</th><th>Sales in this run</th><th>Handled total</th></tr></thead>
        <tbody>{run.totals.filter((item) => !item.excluded).map((item) => <tr key={item.key}><th scope="row">{item.item}</th><td>{formatQuantity(latestByKey.get(item.key) ?? 0)}</td><td>{formatQuantity(item.quantity)}</td></tr>)}</tbody>
      </table></div>
    </MotionDetails>
  </li>
})

export function RepeatErrors({ comparisons, printable = false }: {
  comparisons: Comparison[]
  printable?: boolean
}) {
  const errors = comparisons.filter((row) => row.error)
  if (!errors.length) return null
  return (
    <section className={printable ? 'repeat-print-errors' : 'message repeat-errors no-print'}
      aria-label="Sales comparison errors" role={printable ? undefined : 'alert'}>
      <div>
        <strong>Sales comparison errors · {errors.length}</strong>
        <p>These totals decreased or disappeared. No pull is requested for these items; other items can still be processed. Their earlier handled quantities are retained.</p>
        <ul>{errors.map((row) => <li key={row.key}><strong>{row.item}</strong>: latest {formatQuantity(row.latest)}, already handled {formatQuantity(row.handled)}. {row.error}</li>)}</ul>
      </div>
    </section>
  )
}

export default function RepeatRestockPanel({
  history, report, handledUpload, status,
}: {
  history: HandledRun[]
  report: BaseReport | null
  handledUpload: ReactNode
  status: string
}) {
  const latest = history.at(-1)
  return (
    <div className="repeat-content">
      <section className="repeat-import" aria-label="Already-handled sales">
        {handledUpload}
        <p className="repeat-status" role="status"><TextStateSwap>{status}</TextStateSwap></p>
        {history.length > 0 && <ol className="repeat-history" aria-label="Handled history">
          {[...history].reverse().map((run) => <HandledRunDetails run={run} current={run === latest} key={run.number} />)}
        </ol>}
      </section>
      {!report?.repeat && latest && <RepeatErrors comparisons={latest.errors} />}
      {report?.repeat && <>
        <RepeatErrors comparisons={report.repeat.comparisons} />
        <MotionDetails className="repeat-details" summary={<>View sales calculation <ChevronDown size={16} className="summary-chevron" aria-hidden="true" /></>}>
          <div className="repeat-table-scroll">
            <table className="repeat-table"><thead><tr><th>Item</th><th>Latest sales</th><th>Already handled</th><th>Additional sales</th></tr></thead>
              <tbody>{report.repeat.comparisons.map((row) => <tr key={row.key}><th scope="row">{row.item}</th><td>{formatQuantity(row.latest)}</td><td>{formatQuantity(row.handled)}</td><td>{row.error ? 'Error · no pull' : formatQuantity(row.additional)}</td></tr>)}</tbody>
            </table>
          </div>
        </MotionDetails>
      </>}
    </div>
  )
}
