# Restockulator motion

## Interaction polish, October 15, 2026

File intake now shows actual pending reads in a reserved status line and keeps the
drop-zone footprint stable. Concurrent sales batches retain existing accumulation
and deduplication rules; the newest inventory selection wins. Reset or removal
invalidates stale operations, and file removal restores focus to the next file or
upload control. Errors clear busy state and remain visible. Processing/printing
controls cannot use partially read or stale results.

Synthetic local measurements found roughly 315–337 ms of main-thread work for
10,000 sales and inventory rows each. The unchanged `buildBaseReport` function now
runs in a local module worker with cancellation and a guarded main-thread fallback
for unavailable or blocked workers. Parsing, duplicate balances, exclusions and
all numeric rules are unchanged; no file data leaves the browser. Duplicate-name
meaning remains uncertain upstream; balances combine and the full list remains
available beneath the warning.

Buttons use 140 ms explicit property transitions with the shared easing, without
translation or scaling. Reduced motion removes those transitions. Focus rings and
printed report marks remain intact. `src/App.test.tsx` covers intake races, stale
results, errors, cancellation, duplicate processing and worker fallback. The
synthetic `scripts/check-polish-browser.mjs` covers frame stability, focus, exact
worker/direct output equivalence, active browser frames during large reports,
CSP denial, already-loaded offline processing, and reduced motion. Existing
motion/PDF comparisons remain the print-equivalence check.

Implemented locally on September 15, 2026. The application remains version 0.1.2.

## Shared package

- Package: `@rrg/ui-motion` **0.3.1**.
- Archive: `vendor/rrg-ui-motion-0.3.1.tgz`.
- Dependency: `file:vendor/rrg-ui-motion-0.3.1.tgz`, with the existing npm lockfile.
- SHA-256: `16743f0797362bda2c0524b235fa890416632b9ca45c464e053e623c12216ca2`.
- Matching Forge handoff: [`vendor/MOTION-HANDOFF-0.3.1.md`](../vendor/MOTION-HANDOFF-0.3.1.md).
- Canonical source: Forge's `packages/rrg-ui-motion`; copied from its verified
  archive without editing the source project or compiled package.
- Scoped CSS is imported once in `src/main.tsx`, before application styles.
- React and React DOM remain the existing deduplicated 19.2.8 peer dependencies.

The archive includes JavaScript, declarations, CSS, and its API README. A clean
checkout can install it without a sibling checkout or a private registry.

## Exact control mapping

| Approved pattern | Restockulator integration |
| --- | --- |
| Text-state swap | **Process Reports / Processing…**, the existing result eyebrow **REPORT READY / PROCESSING…** during reprocessing, and the existing processing error inside its `role="alert"` container. |
| Native checkbox stroke | **Print Category Headings**, **Print Verify Stock**, **Include card singles**, and **Split restock list**. |
| Accordion | Native **View duplicate product names** and **Report & Print Settings** disclosures, each with a turning chevron and independent open state. The ignore list remains inside the existing settings disclosure. |
| PanelReveal | Inapplicable: there is no separate secondary conditional settings/detail surface. Both existing disclosures use Accordion. |
| Sliding indicator | **Soft / Hard** are actual restock modes, with a shared sliding indicator. Native tab roles, roving focus, arrow/Home/End keys, and retained hidden panels are owned by the app. Packet count remains a select. |

Text comes from actual `isProcessing`/`error` state. The existing 25 ms processing
schedule and 0 ms print schedule are unchanged. The package renders current text
immediately and does not animate initial text. This keeps a newly mounted error
alert's existing announcement timing, while changes to mounted feedback use the
shared text swap. There are no invented stages, success timers, or additional
live regions. Quantities and report rows are static.

The four controls retain native checkboxes, wrapping labels, immediate change
handlers, persistence, and their 38 × 22 px switch appearance. The shared 150 ms
stroke sits inside the existing white thumb. Its original 140 ms movement is
retained; the app adapter snaps that movement under reduced motion. Focus has a
visible ring on the track. Forced colors restores the platform checkbox and hides
the decorative track and mark. No current checkbox has a mixed or disabled state;
the shared native-input behavior remains available without manufacturing one.

`MotionDetails` preserves native `details`/`summary`, including keyboard activation.
It uses the shared Accordion body and a presence observer so native details stays
physically open until the shared exit completes. There is no second timer or
nested button. Logical close immediately makes content inert and inaccessible and
returns focus from the body to its summary. Children stay mounted, retaining
settings and ignore-list drafts. Both disclosures start closed as before and may
be open together. The package handles rapid reversal, dynamic content, and live
reduced motion. Chevron timing matches its 220 ms open / 160 ms close and
`cubic-bezier(0.22, 1, 0.36, 1)` easing.

## Preserved boundaries

- The warning summary stays visible. The complete duplicate-name list remains
  available in its original scrollable viewport; Accordion adds no height cap.
- Unexpected duplicate inventory names have uncertain upstream meaning. Their
  ordinary inventory balances currently combine; their full names remain beneath
  the processing warning.
- CSV parsing, normalized matching, summed sales, duplicate balances, exclusions,
  Quantity to Pull, category order, Verify Stock, weighted packets, MAX25, settings
  migration, and ignore-list persistence are unchanged.
- Hidey Hole stock and Club Membership discount products remain excluded.
- The printable report, its paper checkboxes, quantities, layout, and pagination
  contain no motion components. Motion controls remain in existing `no-print`
  surfaces. Shared print resets cannot change report transforms or geometry.
- No new disclosure hides required fields, main actions, or unresolved warnings.

## Native disclosure repair

Both controls remain inline Accordion disclosures. `MotionDetails` now physically
opens native `details` before the shared body measures opening. The newest logical
state is held in a ref, and native closure follows the shared body's actual
`hidden` presence. A browser-driven close retains the body for exit measurement;
queued `toggle` notifications cannot override a newer reopen or revive a settled
close. There is no second timer or presence state. Children remain mounted, with
immediate inert/aria-hidden on logical close and focus returned to the summary.

The existing content wrappers already own their grid, padding and margins; the
shared outer height envelopes stay undecorated. The duplicate-name `pre` retains
its original 260 px scroll limit, and the ignore textarea keeps its resize handle.
No parsing, report, quantities, exclusions, persistence or printable JSX changed.

The focused `scripts/check-motion-geometry.mjs` extension samples every frame at
normal speed and 0.2 playback speed for both controls at 1440, 390 and 320 px.
It checks natural inner/control dimensions, envelope width, final-close footprint,
new disclosure overflow, rapid reversals and live reduced motion, including focus
after a direct reduced-motion close. JSON traces and intermediate PNGs accompany
the existing synthetic fixtures. The focused unit test adds delayed native-toggle
notifications after a newer close/reopen. `--geometry-only` runs just the new
browser checks; the ordinary command also runs behavior and print comparisons.

Print geometry is measured relative to the printable report after resetting
screen scroll, avoiding false differences caused by focus scrolling and SVG
floating-point coordinates. Markup, quantities, transforms, pagination and PDF
raster comparisons remain exact.

## Repair verification: 0.3.1, September 15, 2026

- `npm run test`: **18 passed** (11 domain tests and 7 native-disclosure tests).
  `npm run lint`, `npm run build` (including TypeScript), and
  `git diff --check`: passed.
- Final installed-archive Chromium run: **35 checks passed**, including 18 focused
  frame/presence checks, 13 existing behavior checks and 4 print comparisons.
  Both disclosures retain natural inner/control dimensions through every sampled
  opening/closing frame at 1440, 390 and 320 px, at normal and 0.2 playback speed.
  Final presence causes no footprint jump or new disclosure overflow.
- Real native Enter/Space and label activation, immediate switches, retained and
  persisted ignore drafts, focus recovery, rapid reversals, live reduced motion
  and direct reduced-motion closes passed. The textarea resized during opening
  without compressing controls; 40 duplicate names retained their existing scroll
  viewport. Both disclosures can remain open together and warnings stay visible.
- Ordinary, split-three and MAX25 output plus reduced ordinary output match the
  pre-repair baseline exactly in report markup, text, quantities, categories,
  element geometry/transforms, **3 US Letter pages** and **67 static paper marks**
  per case, including PDF raster hashes. The ordinary motion cases print while
  the duplicate Accordion is actively opening. No physical printer was used.
- Existing narrow-page overflow remains **421 px at a 390 px viewport** and
  **367 px at 320 px**; the internal report remains 720 px wide. There is no new
  disclosure overflow. Intermediate narrow screenshots were visually inspected.
  Only Chromium was exercised.
- Archive metadata, SHA-256, matching handoff and lock integrity agree. The exact
  dependency was installed with `npm install --offline --ignore-scripts --no-audit
  --no-fund` after a scoped manifest/lock update. Other locked packages are
  unchanged from the source snapshot; React/React DOM remain deduplicated 19.2.8
  and shared CSS remains imported once. Older archives are preserved unchanged.
- The footer already read `Updated: 9.15.2026`, the actual local implementation
  date, so its value remains correct. CSV parsing, exclusions, balance aggregation,
  settings rules and printable JSX are unchanged.

The run used the isolated `http://127.0.0.1:5233` origin with synthetic CSVs,
mocked printing and blocked remote/API requests. Evidence is under
`tmp/motion-browser-evidence/compare/` (`checks.json`, `network.json`, frame traces,
intermediate PNGs and PDFs). Source snapshot:
`C:\Users\DKlar\AppData\Local\RRG-Motion-Repair-Snapshots\20260915-231857\RRG Inventory Restock Helper`.

Repair files are `src/MotionDetails.tsx` and its focused test, both browser
regression scripts, `package.json`/`package-lock.json`, versioned vendor
archive/handoff and this document. No commit, push, publication or deployment
was performed. Unexpected duplicate inventory names still have uncertain upstream
meaning: the app combines their ordinary inventory balances and exposes the
complete names beneath the processing warning.

## Original integration verification

Focused native-disclosure tests use the existing Vitest/Testing Library tools.
Browser verification uses synthetic sales and inventory CSVs, including ordinary
duplicates, excluded stock, normal restock, and Verify Stock cases. The browser
runner and fixtures live in `scripts/check-motion-browser.mjs` and `tools/motion/`;
generated captures and PDFs remain under ignored `tmp/motion-*/` paths.

- `npm run test`: **17 tests passed** (11 existing domain tests and 6 new native
  disclosure tests).
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript compilation.
- `git diff --check`: passed.
- Local Chromium: **17 checks passed**, including four print comparisons and
  desktop, 390 px, and 320 px layouts; real file-input processing,
  40 duplicate names, ordinary/Hidey Hole mixed stock, permanent exclusions,
  immediate checkbox changes, native Space/Enter activation, visible focus,
  retained/persisted ignore drafts, split reset on reload, and real error feedback.
  Reprocessing immediately exposes the real busy state and ends enabled/ready.
  Resizing the textarea during expansion retargets occupied height without
  clipping, and changing reduced motion during an active close settles immediately.
- Ordinary, split-three, and MAX25 PDF comparisons: **3 US Letter pages each**,
  all **67 static paper marks** retained. Report markup, text, quantities,
  categories, descendant geometry, and 120 dpi page rasters exactly match the
  pre-change app. The updated captures print during an active Accordion opening;
  a fourth reduced-motion ordinary capture also matches. No physical printer was
  used.
- Source inspection independently confirms the parser and printable JSX are
  unchanged. The browser makes no API requests or uploads.

Existing narrow-screen overflow is unchanged: the document measures 421 px at a
390 px viewport and 367 px at 320 px. The report keeps its existing 720 px internal
width. This integration does not redesign that layout.

To repeat the browser comparison, serve a pre-change checkout with its dependencies
using `MOTION_QA_ROOT` and `tools/motion/vite.config.mjs` on port 5220; serve this
checkout with the same config and no root override on port 5221. The separate QA
config limits HTML dependency discovery and ignores generated captures.

```powershell
agent-browser --session restockulator-motion open about:blank
$motionCdp = agent-browser --session restockulator-motion get cdp-url
node scripts/check-motion-browser.mjs $motionCdp http://127.0.0.1:5220 baseline
node scripts/check-motion-browser.mjs $motionCdp http://127.0.0.1:5221 compare
agent-browser --session restockulator-motion close
```

The runner requires the existing local `pdfinfo` and `pdftoppm` tools. It initializes
only its isolated local origin, freezes the report date, uploads generated CSVs
through native inputs, intercepts the print command, captures PDFs, and blocks
remote/API traffic. It does not change application storage formats or processing.

The five Transitions.dev reference pages could not be opened by the available web
tool on this date. The implementation follows the verified Forge archive and its
documented behavioral contract. No reference source was copied and no additional
third-party license notices are required. This does not block local integration.

## Future updates

Make shared changes in Forge's canonical package, run its behavior and consumer
checks, increment its version, and build a **new** versioned archive. Read the
updated Forge handoff and verify its checksum. Copy that archive into `vendor/`
and install it with the existing npm package manager:

```sh
npm install --ignore-scripts --no-audit --no-fund ./vendor/rrg-ui-motion-<version>.tgz
npm run test
npm run lint
npm run build
```

Repeat disclosure, keyboard, reduced-motion, and report/print comparisons. Include
the new archive, manifest, and lockfile together in an authorized change set.
Never replace the bytes of an existing version, edit compiled vendor code, or
substitute a similarly named registry package. Reuse the approved five patterns;
choose Accordion for inline height changes and PanelReveal for separate secondary
surfaces, with one body effect per opening.

No commit, push, package publication, or production deployment is part of this work.

## Files changed

- Application wiring and presentation: `src/App.tsx`, `src/App.css`, `src/main.tsx`.
- Native disclosure adapter and focused regressions: `src/MotionDetails.tsx`,
  `src/MotionDetails.test.tsx`.
- Reproducible dependency: `package.json`, `package-lock.json`,
  `vendor/rrg-ui-motion-0.2.0.tgz`.
- Local browser/PDF verification: `scripts/check-motion-browser.mjs`,
  `tools/motion/fixture.mjs`, `tools/motion/vite.config.mjs`.
- Guidance and generated-output exclusions: `AGENTS.md`, `.gitignore`,
  `docs/MOTION.md`.

## Hard restock mode — October 30, 2026

Soft remains the default and retains its existing processing, duplicate-balance
aggregation, settings, and print layout. The new Soft/Hard tab strip uses
SlidingTabs for the indicator only. The app owns tab semantics, arrow/Home/End
keys, focus, and retained hidden panels; no body transition runs on a mode switch.
Both modes share the current inventory upload. Each keeps its own preferences.

Hard uses AnimatedCheckbox for category selection, real stock/exclusion toggles,
and splitting. Nested category disclosures use one Accordion body per opening.
Hard settings and duplicate-name disclosures reuse MotionDetails. TextStateSwap
reflects actual inventory reading and error state. No new motion dependency or
package version was introduced.

The Hard report has separate scoped print styles: Letter portrait, category
headings, one line per raw inventory entry, and three static paper checkboxes.
Negative balances appear in Current Stock. Full product names shrink within
their column using measured widths, with batched writes/reads, font-load and
resize handling, and a beforeprint refresh. Long names can become smaller than
the selected base size to honor the approved single-line layout.

Hard keeps duplicate inventory entries separate. Their upstream meaning remains
uncertain. Soft still combines ordinary duplicate balances and exposes its full
duplicate-name list beneath the warning; Hard exposes its list and marks repeated
names without summing their balances. Permanent exclusions stay out of all Hard
rows, category choices, and duplicate diagnostics.

Release validation covers 55 unique tests, TypeScript and lint, plus 16 synthetic Hard
browser checks and 35 Soft motion/behavior checks. All ten saved inventory exports
were audited for raw row preservation and stock totals. Soft ordinary, split-three,
MAX25 and reduced-motion PDFs match the pre-change local baseline. Hard ordinary
and split-three PDFs use 612 × 792 point Letter portrait pages; all names remain
complete on one line. Browser PDF captures do not validate a physical printer.

Repeat Hard checks against an isolated local browser session and local server:

```powershell
node scripts/check-hard-browser.mjs <local-CDP-websocket> http://127.0.0.1:5221
```

The runner uses a disposable browser context, synthetic inventory, blocked remote
requests, and stubbed window.print. Screenshots, PDFs, and check results are saved
under ignored `tmp/hard-restock-evidence/`. Reload opens Soft, clears uploaded
inventory, and restores only Hard preferences. No digital findings are stored.

### October 30 copy and spacing refinement

The mode buttons now contain only centered **SOFT** and **HARD** labels. Hard's
upload heading is **File Upload**, the category heading is **Categories**, and
the requested introductory help and stock-filter subtitles were removed. Category
rows and expanders are 24 px high. Checkbox, disclosure, filtering, and persistence
behavior is unchanged. Both printable footers now read `Generated with {filename}`;
this intentional text change postdates the earlier Soft PDF baseline comparison.

Validation: 55 unique tests, TypeScript, lint and production build passed. The updated
Hard runner passed 19 checks against the built preview, including centered labels,
removed copy, category spacing, both filename-only footers, and portrait output.

The Hard print heading and column labels no longer explain upstairs/backstock,
and the unused staff-name line is removed. Packet numbering remains available.

The clean release suite contains 53 self-contained tests and two optional audits
of the ten private saved exports. The audits skip when those local files are not
present. Earlier 82-test local runs also discovered 27 unchanged tests inside the
temporary pre-change backup; that backup is not part of the release.
