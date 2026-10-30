import { parseHardInventory, type HardInventory } from './lib/hard-restock'
import type { CsvInput } from './lib/restock'

export type HardWorkerResult = { ok: true; inventory: HardInventory } | { ok: false; error: string }

// The inventory stays in this browser, including the worker/fallback path.
self.onmessage = (event: MessageEvent<CsvInput>) => {
  let result: HardWorkerResult
  try { result = { ok: true, inventory: parseHardInventory(event.data) } }
  catch (error) { result = { ok: false, error: error instanceof Error ? error.message : 'The inventory could not be read.' } }
  self.postMessage(result)
}
