# Restockulator motion

Implemented locally on September 15, 2026. The application remains version 0.1.2.

## Shared package

- Package: `@rrg/ui-motion` **0.2.0**.
- Archive: `vendor/rrg-ui-motion-0.2.0.tgz`.
- Dependency: `file:vendor/rrg-ui-motion-0.2.0.tgz`, with the existing npm lockfile.
- SHA-256: `7b0b86612ec76ff1c1b08abb7e1af4f0fbfda053044a1c4672a9b20a66e86c3e`.
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
| Sliding indicator | Inapplicable: there are no horizontal tabs or mutually exclusive mode buttons. Packet count remains a select; ranges and action buttons retain their existing semantics. |

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

## Verification

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
