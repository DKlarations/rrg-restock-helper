# Project instructions

- Whenever the app is updated, change the static `Updated:` date in the bottom-left footer of `src/App.tsx` to the date of that update.
- In the eventual user-facing write-up, explain that the inventory exports contain some unexpected duplicate product names whose upstream meaning is uncertain. Document that the app currently combines their balances and makes the complete duplicate-name list viewable beneath the processing warning.
- Hidey Hole inventory is always out of scope. Inventory rows whose category path contains `Hidey Hole` or whose product name begins with `[HH]` must never contribute stock or appear anywhere on the printable report, including Verify Stock.
- Club Memberships is a non-stock sales category. `Level Up Discount`, `Teacher/Librarian Discount`, and `Employee` must never appear in the restock report or Verify Stock.
- Reuse the versioned `@rrg/ui-motion` archive in `vendor/` for new motion: sliding indicators, text-state swaps, native checkbox strokes, Accordion, and PanelReveal only. Use Accordion for inline disclosures whose height moves following content, and PanelReveal for separate secondary surfaces; never animate one opening with both. Preserve native summaries, reduced-motion behavior, focus, drafts, and static printed marks. See `docs/MOTION.md` for controls and updates.
