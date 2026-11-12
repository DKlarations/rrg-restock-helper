import { buildBaseReport, type BaseReport, type CsvInput, type HandledSalesTotal } from './lib/restock'

export type ReportWorkerResult = { ok: true; report: BaseReport } | { ok: false; error: string }

// Same parser, matching and exclusions as the main-thread fallback. Data never leaves this browser.
self.onmessage = (event: MessageEvent<{ sales: CsvInput[]; inventory: CsvInput; handledTotals?: HandledSalesTotal[] }>) => {
  let result: ReportWorkerResult
  try { result = { ok: true, report: buildBaseReport(event.data.sales, event.data.inventory, event.data.handledTotals) } }
  catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'The reports could not be processed.' } }
  self.postMessage(result)
}
