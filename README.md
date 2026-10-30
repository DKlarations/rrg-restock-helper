# RRG Restockulator

RRG Restockulator turns Red Raccoon Games sales and inventory CSV exports into a categorized, printable floor-restock list.

**Soft** is the default, sales-driven restock list. **Hard** produces inventory-only category checklists for physical stock counts. Both modes share the current inventory upload and keep their own settings.

## How it works

1. Drop in one or more `EmailProductSales` CSV files.
2. Drop in the current `InventoryReport` CSV file.
3. Process the reports and review the results.
4. Adjust the print settings and print the restock list.

All CSV processing happens locally in the browser. The files are not uploaded to an application server.

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
