# RRG motion handoff — 0.3.1

## Exact immutable artifact

- **Package:** `@rrg/ui-motion` 0.3.1, private/unpublished.
- **Archive:** [vendor/rrg-ui-motion-0.3.1.tgz](../vendor/rrg-ui-motion-0.3.1.tgz).
- **Absolute archive:** `C:\Users\DKlar\OneDrive\Documents\RRG Logistics Assistant\vendor\rrg-ui-motion-0.3.1.tgz`.
- **SHA-256:** `16743f0797362bda2c0524b235fa890416632b9ca45c464e053e623c12216ca2`.
- **Matching handoff:** this document; copy it beside the archive as `vendor/MOTION-HANDOFF-0.3.1.md`.
- **Canonical source:** `packages/rrg-ui-motion/src/index.tsx` and `src/styles.css`.
- **Public API:** [package README](../packages/rrg-ui-motion/README.md), included inside the archive.
- **Exports:** `SlidingTabs`, `TextStateSwap`, `AnimatedCheckbox`, `Accordion`, `AccordionTrigger`, `PanelReveal`, and their TypeScript props interfaces.
- **CSS export:** `@rrg/ui-motion/styles.css`.

The archive contains compiled ESM, declarations, scoped CSS, README and metadata.
React and React DOM remain peers (`^18.2.0 || ^19.0.0`); there is no bundled React,
prepare hook, registry credential requirement or new animation library.

The initial 0.3.0 artifact is retained unchanged with SHA-256
`0d7984160f724b1e49d4b033725f244f44c552cd3e50a8bec89bda89ee2325c8`.
Its immediate/unmount focus regression was caught during Pullsmith integration;
use 0.3.1 for rollout. The repair keeps focused children attached through the
synchronous close layout effect, restores focus, then unmounts before paint.
The outer surface is already hidden/inert on the close render; no exit delay or
protected visible frame is introduced. Real Escape and outside pointer checks
failed on 0.3.0 and pass on 0.3.1.

The previous archives remain immutable:
0.2.0 SHA-256 `7b0b86612ec76ff1c1b08abb7e1af4f0fbfda053044a1c4672a9b20a66e86c3e`;
0.1.0 SHA-256 `b162594f96fe2452b84654b590fd0eb098e0c6063c685e0b84db383d2629cd99`.

## Install the exact archive

Copy the archive and this matching document into each existing checkout's
`vendor/` folder and verify the SHA-256. From that project's root:

```sh
npm install --ignore-scripts --no-audit --no-fund ./vendor/rrg-ui-motion-0.3.1.tgz
```

Both manifest and lockfile must resolve:

```json
"@rrg/ui-motion": "file:vendor/rrg-ui-motion-0.3.1.tgz"
```

Preserve the consumer's other locked dependency versions. Import shared CSS once
before app integration CSS. Verify the installed archive rather than aliasing
canonical source. Installing this artifact does not establish that the consumer's
own wrappers, native details adapters or print behavior have passed.

## Reproduced causes and changed behavior

The 0.2.0 real-browser baseline reproduced compressed content down to **0px**
inside padded grid and flex panels and an inline grid Accordion. Across 1000px
and 390px viewports, opening contained 10–15 compressed frames. The shared height
animation constrained the same inner element used as its target measurement.
Its ResizeObserver could then feed that compression back into the target.
Panel height/transform keyframes also changed natural popover/dialog geometry
and could overwrite a caller's positioning transform.

**PanelReveal now changes opacity only: 180ms opening from 0.65 to 1; 150ms
closing to 0.** It has no height, width, transform, scale or clipping effect.
Natural size, viewport max-height, scrolling, padding, borders, shadows and
positioning transforms remain under the application layout. This also applies
to reduced motion and print. A gear stays stationary. Child edits do not restart
the effect. Initial/restored open content remains static; `animateOnMount` stays
an explicit opt-in for a newly created surface.

**Accordion keeps 220ms opening / 160ms closing occupied-height animation.**
Its inner content has a natural max-content minimum and does not flex-shrink when
the envelope changes. Measurement includes its border box and margins at current
width. Genuine content changes, nested disclosures and wrapping retarget within
the existing opening deadline. Only the outer boundary clips during movement;
settled overflow returns to application policy.

Both retain the shared controlled presence, focus, draft, rapid-reversal and
reduced-motion behavior. Logical close sets inert, aria-hidden and pointer
exclusion immediately. Focus only returns when it was inside the closing body;
an already focused outside control keeps focus. `immediate` security close hides
on that render. Stale completions and pending native-layout measurements cancel.
Missing WAAPI produces usable static UI.

## Migration and wrapper ownership

Choose exactly one body effect:

```tsx
// Floating settings/dialog: existing positioning and scroll surface stays outside.
<PanelReveal open={settingsOpen} triggerRef={gearRef}
  className="settings-popover" contentClassName="settings-options">
  <ExistingSettings />
</PanelReveal>

// In-flow disclosure: all collapsible spacing goes inside its height envelope.
<Accordion open={expanded} triggerRef={triggerRef}
  className="details-envelope" contentClassName="details-layout">
  <ExistingDetails />
</Accordion>
```

The new optional `contentClassName` and `contentStyle` props address the existing
inner wrapper. Its public class remains `.rrg-motion-panel__content` or
`.rrg-motion-accordion__content`; the forwarded ref remains on the outer surface.
Existing explicit child layout wrappers work as before.

For panels, keep positioning/width/max-height/overflow on the outer surface and
put option grid/flex spacing inside. For Accordions, move collapsible padding,
borders and margins inside as well. A padded outer border box cannot reach zero
occupied height and will leave a strip before `hidden` removes it. Do not override
the Accordion inner minimum-size/shrink protection. Where adjacent sibling
margins would start collapsing only after the body becomes hidden, a static
`display: flow-root` slot around the Accordion preserves those margin boundaries;
it receives no animation.

Replace old in-flow PanelReveal uses with Accordion when following content should
move smoothly. Keep popovers/dialogs and one-time newly created editors on
PanelReveal. Do not introduce a new disclosure step, repeat creation handlers,
key editors by field values or apply both body effects to the same opening.

For table disclosures render `tr > td > Accordion`, never a div around a row.
Retained empty table rows may use the existing scoped `tr:has(...[hidden])` rule.
Required controls, warning summaries and security boundaries retain their policies.

## Native details adapter

Keep the real `details` and `summary`. Logical state controls Accordion while
the adapter owns the physical DOM `details.open`:

1. Prevent the summary's default toggle; physically open details before setting
   logical open, so its content is available for measurement.
2. On logical close retain the physical open attribute while the shared exit runs.
3. Observe the Accordion outer body's `hidden` attribute; physically close only
   after shared exit settlement. No second animation, guessed delay or timer.
4. Use current state refs in MutationObserver/native toggle callbacks. Native
   toggle events are queued/coalesced and may describe an earlier transition.
   Retained physical open must not be interpreted as a new logical open request.
5. Preserve initial-open state, retained drafts, summary keyboard activation and
   accurate aria-expanded/aria-controls. Rapid reopen cancels the pending close.

The shared component also waits for a closed native details ancestor to become
available, rather than using a zero measurement. Changing state or unmounting
cancels this pending layout work.

## Forge integration

- Invoice Settings and Paste Invoice Text retain their modal frames and handling.
- Special Orders Settings keeps outer positioning and inner option-grid ownership.
- Name/Amount Cleanup, contacts, table source/notes, reconciliation pages and GW
  format options use Accordion with their existing draft and initial-open rules.
- The in-flow bulk toolbar and diagnostics use Accordion.
- Create Blank PO retains one draft from its existing handler and a single
  PanelReveal entrance; editable fields and validation do not replay it.
- Other approved selection/text/checkbox effects remain. Domain parsers, money,
  exports, permissions, notes-fetch timing, customer data and print geometry are
  outside the package repair.

## Verification and reproducible evidence

Package behavior tests: **25 passed**, including geometry-only effect ownership,
inner layout props, margin-aware targets, native-layout availability, missing
WAAPI, focus, live reduced motion, StrictMode one-time entry, retained drafts and
stale completion/reopen.

Real Chromium geometry runner:
`scripts/check-motion-geometry.mjs`, fixture `tests/browser/motion-geometry.html`.
The baseline and repaired frame JSON are under ignored
`tmp/motion-geometry-evidence/{baseline,verify-0.3.1}/`. The repaired suite
passed **19 checks** across 1000px and 390px: padded grid/flex panels, constrained
scrolling/transformed dialog, inline grid, native details, nested and table
disclosures; content/width changes during opening; rapid reversals/drafts/focus;
live reduced motion and print. No repaired frame compressed inner content or
changed a floating surface's geometry. Slowed playback retained scrolling and
checkbox state; native summary Enter activation and immediate closing semantics
also passed. Immediate-close/unmount keyboard Escape restores the gear before
children disappear; an outside pointer click retains focus on the clicked control.
A captured 60ms panel frame was visually inspected at natural size.

Run against a fresh isolated agent-browser session on port 5230:

```sh
node scripts/check-motion-geometry.mjs <local-browser-websocket-url> http://127.0.0.1:5230 verify
```

All fixture requests to production HTTPS or /api paths are blocked. Forge app QA
uses `tests/browser/special-orders-fixture.js` and synthetic records, refuses
writes and intercepts clipboard. No customer records, emails, migrations or
production configuration are required.

Development candidates were made with `npm run pack:motion -- --draft`.
The final immutable artifact was built with `npm run pack:motion`; only README
guidance differs from the candidate whose executable geometry passed. The
pack script refuses to overwrite an existing version with different bytes.

Final 0.3.1 installed-archive gates passed with the original locked dependency
graph preserved:

- `npm run verify:motion-artifact`: fresh offline consumer installed this exact
  archive, typechecked public declarations including the inner-layout props,
  built all JavaScript/CSS exports and deduplicated React/React DOM **19.2.8**.
- `npm test -- --maxWorkers=4`: **120 test files, 1,788 tests passed; one skipped**.
- `npm run typecheck:api`: passed.
- `npm run build`: passed; the existing Vite chunk-size advisory remains.
- `git diff --check`: passed.

The separate package suite passed 25 behavior tests and the isolated geometry
runner passed 19 real-browser checks. The final installed Forge application
browser suite passed **31 checks**, including accepted reconciliation, cleanup,
dialogs, contacts, table disclosures, one-time blank-PO creation and editing,
GW safeguards, reduced motion and print. App-specific browser evidence is recorded
in Forge's `docs/MOTION.md` and each receiving application's motion documentation.

## Scope and limitations

Work remains local: no commit, push, registry publication or deployment.
Unrelated checkout work was preserved. Before repair, nonignored work was
snapshotted with SHA-256 evidence at
`C:\Users\DKlar\AppData\Local\RRG-Motion-Repair-Snapshots\20260915-231857\RRG Logistics Assistant`.
This is a source recovery snapshot, not a database backup.

Verification targets Chromium. React 18 and other browser engines were not
separately exercised. Print evidence is browser/PDF behavior, not physical printer
testing. Each receiving app requires its own wrapper/adapter and print checks;
the artifact's existence alone does not claim that those apps are updated.
