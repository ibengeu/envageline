# Implementation Plan: Reading Pipeline Classification Quality

**Branch**: `003-pipeline-classification-quality` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-pipeline-classification-quality/spec.md`

## Summary

Close three concrete gaps in the existing Smart PDF Reading pipeline's block classification:
headings are currently narrated identically to body paragraphs (no section-boundary signal for
listeners), multi-paragraph blocks are narrated as one run-on unit (no paragraph-boundary signal
within a block), and footnotes/captions/tables are narrated as ordinary body text (disruptive or
nonsensical). All three extend the existing, already-implemented `analyzeDocumentStats` →
`classifyBlocks` → `renderNarrationText` chain from feature 001-clean-private-reading, reusing its
established "compare against the document's own learned profile, require corroborating evidence,
default to leaving content alone when evidence is weak" pattern (already proven for header/
footer/page-number detection) rather than introducing new architecture.

## Technical Context

**Language/Version**: JavaScript (ES2020+), running directly in the browser without a build step
or transpiler; test files run under Node.js using the built-in `node:test` runner — consistent
with the rest of `pdf-reader/`.

**Primary Dependencies**: None added. This plan extends existing functions in `pdf-reader/app.js`
using only geometry/text data already extracted by the existing PDF.js-based pipeline
(`extractPositionedItems`, `reconstructLines`, `reconstructBlocks`). One optional, non-blocking
enhancement (research.md §1) may read PDF.js's font descriptor objects via
`page.commonObjs.get(fontName)` — an existing PDF.js API surface, not a new dependency.

**Storage**: N/A — no new storage. All new classification data is computed fresh per extraction
call, in memory, exactly like the existing header/footer/page-number classification.

**Testing**: Node's built-in `node:test` + `node:assert/strict`, matching `pdf-reader/reader.test.js`'s
existing pattern. Each new classification behavior (heading, paragraph boundary, footnote,
caption, table) is independently testable as a pure function given synthetic positioned-item
fixtures, following the exact test style already used for `classifyBlocks`/`detectColumns`'s
existing regression tests (including their found-and-fixed real bugs, e.g. the header/footer
zone-confinement bug and the full-width-block reading-order bug).

**Target Platform**: Any modern browser (client-side, static files served over HTTP); no
server-side component — unchanged from the existing pipeline.

**Project Type**: Single static web app (`pdf-reader/`) — no new files beyond additions to the
existing `app.js`/`reader.test.js`, consistent with this project's established single-file
pattern for pipeline-adjacent logic (see specs 001 and 002).

**Performance Goals**: The new classification steps must not perceptibly slow document
processing — each is a single additional pass over already-reconstructed blocks (already O(pages
× blocks) work the pipeline already does), not a new per-character or per-pixel operation. No
specific millisecond budget beyond "stays within the same order of magnitude as the existing
classification pass," consistent with plan 002's qualitative main-thread-responsiveness treatment.

**Constraints**: Must not change narration output for any document that exhibits none of the
three new patterns (FR-014/SC-006) — every new classification step must default to leaving
content in its current classification when its own evidence is absent or weak, mirroring the
existing header/footer confidence-threshold pattern. Must not introduce any new network call,
worker, or persisted data (constitution Principle I; this plan operates entirely within the
existing in-memory, synchronous classification chain governed by spec 002's local-only rules).

**Scale/Scope**: Applies to every document processed through the existing pipeline's
`classifyBlocks`/`renderNarrationText` chain — this plan does not add a new entry point; it
extends the one the pipeline already has.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Local-First Privacy | Does this add any network call, upload, or new persisted data? | **Pass** — every new function operates on already-in-memory geometry/text data; nothing is persisted or transmitted. |
| II. Narrow Product Surface | Does this serve "make a document better to listen to?" | **Pass, directly** — this is the clearest possible fit: it improves what gets narrated and how section/paragraph structure comes across, with no new user-facing surface beyond better narration output. |
| III. Behavior-Driven TDD | Can this be developed as small, behavior-only test cycles? | **Pass** — each classification behavior (FR-001–FR-012) is independently testable as a pure function given synthetic block fixtures, following the project's existing test style for `classifyBlocks`/`detectColumns`. |
| IV. Security Review as a Gate | Does this touch parsing, network, storage, or third-party code? | Touches PDF.js text/geometry data already being read; the optional font-descriptor enhancement (research.md §1) touches one additional, existing PDF.js API surface. No new network or storage path. See Security Review below. |
| V. Simplicity & Cyclomatic Discipline | Can each rule stay under complexity 10 without hidden branching? | **Pass, by design** — each new classification behavior is its own small function (mirroring `isConfidentHeaderFooterCandidate`, `isFullWidthBlock`, etc.), not a single large branching function; the font-weight enhancement is explicitly optional/deferred (research.md §1) rather than adding required complexity for uncertain benefit. |

**Initial gate result: PASS.** No violations requiring Complexity Tracking justification.

### Security Review (Constitution Principle IV)

- **A03:2025 Software Supply Chain Failures**: N/A — no new dependency; this plan reads existing
  state from the already-vendored, pinned PDF.js 4.10.38 build (including, optionally, its font
  descriptor objects via an existing, stable API).
- **A08:2025 Mishandling of Exceptional Conditions**: Applicable. A malformed or unusual PDF could
  produce blocks with missing/zero font sizes, degenerate bounding boxes, or a font-descriptor
  lookup that throws for a corrupt embedded font. Mitigation: every new classification function
  follows the existing pipeline's pattern of treating missing/invalid geometry as "insufficient
  evidence, leave classification unchanged" (already true today for `fontSize` being optional in
  `buildLine`) rather than throwing; the optional font-descriptor lookup (research.md §1) is
  wrapped so a lookup failure degrades to "no weight signal available," never blocking
  extraction — consistent with FR-002/FR-012's "absence of evidence must not produce a false
  positive" requirement.
- **A02:2025 Security Misconfiguration**: N/A — no new configuration surface is introduced; all
  new thresholds are internal constants tuned against fixtures, not user- or environment-facing
  configuration.
- **A01, A04, A05, A06, A07, A09, A10**: N/A — this plan has no access control surface, no
  cryptography, no authentication, no new rendering path, and no external requests, unchanged from
  the pipeline it extends.

## Project Structure

### Documentation (this feature)

```text
specs/003-pipeline-classification-quality/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
pdf-reader/
├── app.js                # analyzeDocumentStats, classifyBlocks, renderNarrationText, and the
│                          # existing block-reconstruction chain live here. This plan adds new
│                          # pure functions alongside the existing header/footer/page-number
│                          # detection functions (e.g. isConfidentHeaderFooterCandidate,
│                          # isFullWidthBlock) for heading detection, paragraph-boundary
│                          # splitting, and footnote/caption/table detection — extending
│                          # analyzeDocumentStats's returned profile and classifyBlocks's
│                          # dispatch, and adding new entries to NARRATION_EXCLUDED_TYPES.
├── reader.test.js         # Existing behavior tests; this plan adds tests for each new
│                          # classification behavior, following the existing style (synthetic
│                          # positioned-item fixtures, assertions on classified output only).
```

**Structure Decision**: No new files or directories. This plan adds functions to the existing
`pdf-reader/app.js` module and tests to `pdf-reader/reader.test.js`, matching the single-file
pattern already used for every prior pipeline addition in this project (specs 001 and 002). The
new paragraph-boundary-splitting step is inserted into the existing pipeline call chain between
`reconstructBlocks` and `analyzeDocumentStats` (per research.md §3); heading/footnote/caption/
table detection extend `analyzeDocumentStats` and `classifyBlocks` in place, following the exact
pattern already established for header/footer/page-number detection.

## Complexity Tracking

*No Constitution Check violations were identified. This section is intentionally empty.*
