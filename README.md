# RRG Restockulator

RRG Restockulator turns Red Raccoon Games sales and inventory CSV exports into a categorized, printable floor-restock list.

**Soft** is the default, sales-driven restock list. **Hard** produces inventory-only category checklists for physical stock counts. Both modes share the current inventory upload and keep their own settings.

## How it works

1. Drop in one or more `EmailProductSales` CSV files.
2. Drop in the current `InventoryReport` CSV file.
3. Process the reports and review the results.
4. Adjust the print settings and print the restock list.

All CSV processing happens locally in the browser. The files are not uploaded to an application server.

## Additional Soft restocks

The optional **Subtract already-handled sales** control starts off. Leave it off to use the existing Soft upload, calculation, and printing workflow.

1. Enable subtraction and process the current sales and inventory as usual. Each run can combine multiple nonoverlapping sales files.
2. Once the run is covered, choose **Move to already handled** beneath Step 1. Its files move into the visible history under Step 3 with a **Handled** date/time. Their cumulative sales become the comparison point, current sales uploads clear, and inventory/settings stay in place. Previewing and printing never advance the handled totals or change that timestamp.
3. Upload the next cumulative sales report, covering the same starting date through a later cutoff, and process again. Totals of 10, 15, and 17 produce additional sales of 10, 5, and 2; the existing inventory limits still determine the pull quantities.

To begin partway through a day, upload an already-covered report to Step 1 and move it without needing to generate another preview. Alternatively, upload files from one previously handled run directly under **Already-handled sales**: the selected batch is validated and saved automatically once inventory is available, without clearing current sales uploads. Imported groups show an **Added** timestamp because their actual historical pull time is unknown. Failed moves/imports keep their files available for correction.

Handled filenames and timestamps are always visible while subtraction is enabled. The newest group is labeled **Current comparison**; earlier groups remain visible underneath it. Only item-level quantities are collapsed. Separate days within one run add together; overlapping cumulative snapshots belong in separate runs. The CSV cannot reliably identify reporting dates, so staff must choose matching coverage.

Decreased or missing sales are shown as errors, with no negative pulls. Valid items can still print. Marking a run handled retains each errored item's earlier handled quantity, preventing duplicate pulls if its sales total later rebounds. All sales in the input count as handled, including user-hidden categories, stock-limited quantities, and Verify Stock items. Enabling a hidden category later does not bring back its older sales.

Follow-up printouts say **Additional restock**, identify the run, generation time, and source files, and show only the additional sales in **Qty Sold**. Stock caps, exclusions, Verify Stock, category settings, and packet splitting keep their existing behavior. Inventory can be reused or replaced. Comparison errors appear on screen and on the printout; the sales calculation and handled history are available on screen for review.

Use the existing **Clear all** action to reset sales, handled history, and inventory when changing the sales starting date or correcting a mistaken handled run. Midnight does not reset anything. Files, repeat mode, and history exist only in the current page session: refreshing or closing the page clears them. Report settings remain saved as before.

## Hard restock checklists

1. Open **Hard** and upload an `InventoryReport` CSV, or use the inventory already uploaded in Soft. No sales report is needed.
2. Search the category tree and choose one or more categories. A parent includes its descendants. Detailed paths, including Board Games filing letters and numbers, are preserved.
3. Adjust the zero-stock, negative-stock-only, and exclusion toggles. The preview updates as the selection changes.
4. Print a portrait US Letter checklist, optionally divided into 2–5 packets or MAX25. Packets balance by item count and retain category groups where practical.

Each item occupies one line: item name, Current Stock, Upstairs checkbox and amount, Backstock checkbox and amount, and Unable to Locate checkbox. Upstairs is the sales floor; Backstock is the downstairs storage room. Staff write the physical quantities they find. Negative balances appear directly in Current Stock. Long names shrink within their column to stay complete on one line.

Zero-stock items start included. Negative stock only is an optional toggle. Paint and paint markers, dice, Deactivate, and Z Online Sales start excluded; those exclusions are configurable independently of Soft. Painting Accessories and D&D miniatures remain available. The ignore list also accepts exact items, categories, category paths, and item-name prefixes ending in `*`. Permanent Hidey Hole, event, and membership-discount exclusions still apply.

Hard preserves every valid inventory entry separately, including repeated names within the same category. It does not add duplicate balances together. A warning and complete duplicate-name list make repeated names visible for review.

Hard preferences are saved in the current browser, including category selections, exclusions, filters, and print choices. Switching modes keeps the working reports; reloading opens Soft and requires a fresh inventory upload. Checkmarks and amounts are completed on paper. Digital count tracking and follow-up lists based on staff findings are future work.

## Restock rules

- Sales quantities are combined across every selected sales report.
- Products are matched by normalized product name after inventory category paths are removed.
- Quantity to Pull is the lesser of Quantity Sold and available Current Stock.
- Processing is shown first; other categories retain their first-seen sales order.
- Board Games alphabetical filing segments are removed from printed category headings.
- Zero, negative, and genuinely unmatched inventory records appear under **Verify Stock**.
- Verify Stock starts on a new printed page when the list is not split. In split mode, each coworker packet gets its own Verify Stock subsection after its ordinary restock rows.
- Items or categories containing the words Misc. or Singles can be included or excluded with a setting.
- Exact items, categories, paths, and wildcard prefixes can be added to the ignore list.

Permanent exclusions include Events, Tickets, Rentals, Club Membership discounts, and all Hidey Hole (`HH`) inventory. HH stock never contributes to the report, including when an item also has ordinary inventory.

## Duplicate inventory names

The inventory exports contain some unexpected duplicate product names whose upstream meaning is not yet clear. Soft combines the balances of matching ordinary inventory records. Hard retains each inventory entry separately. In both modes, the warning panel includes a collapsible plain-text list showing every duplicated product name so the behavior remains visible and reviewable.

## Print settings

- Print category headings
- Include or exclude Misc. and Singles items
- Include or exclude Verify Stock from printed pages
- Split the report into 2–5 balanced coworker packets, keeping categories intact when practical
- Count each Verify Stock row as three ordinary restock rows when balancing the work
- Allow oversized categories to continue across packets when needed to balance the workload
- Use MAX25 to choose an automatic number of useful packets averaging about 25 workload units each
- Text sizes from 6–14 pt
- Micro-Compact, Subcompact, Compact, Standard, and Roomy row spacing
- Locally saved ignore-list preferences

The output is designed for US Letter paper and includes checkboxes, item names, quantity to pull, quantity sold, and current stock.

## Development

```bash
npm install
npm run dev
```

Validation commands:

```bash
npm run test
npm run typecheck
npm run lint
npm run build
```

The private store CSV samples used for local validation are intentionally excluded from Git.
