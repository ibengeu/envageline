# Implementation Plan: Smart PDF Reading — Layout-Aware Listening Compiler

**Branch**: `001-clean-private-reading` | **Date**: 2026-09-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-clean-private-reading/spec.md` (revised to
the "Smart PDF Reading" layout-aware scope)

**Revision note**: This plan replaces the earlier flat-text-regex plan for the same feature
directory. The spec was updated first (per user direction: "its an improvement on the initial
spec") to describe a layout-aware pipeline instead of pure string cleanup; this plan is derived
from that updated spec. The previous plan's four rules (URL, citation, page-number,
header/footer suppression) are preserved as requirements (FR-003–FR-006) but are now
implemented as part of a geometry-aware pipeline rather than as standalone regex passes over
already-flattened text, because reliable header/footer and reading-order detection require
knowing where text sits on the page — a flattened string discards that information
irrecoverably.

## Summary

Extend PDF extraction in `pdf-reader/app.js` to capture each text fragment's position and size
on the page — already available from the vendored PDF.js dependency's `getTextContent()` via
`item.transform`/`width`/`height`, just not read today — instead of only `item.str`. Build a
staged, deterministic pipeline on top of that positioned text: reconstruct visual lines,
reconstruct paragraph-like blocks, compute document-wide statistics (needed to tell "this line
repeats at the same position across many pages" from "this line happens to repeat once"),
classify header/footer/page-number blocks with a confidence score, detect single- vs.
two-column layout, determine reading order from block position (not raw extraction order), and
only at the end render two divergent text outputs: the literal per-page text already used for
the reading pane (unchanged, per FR-009) and a cleaned, correctly ordered narration text handed
to `splitIntoSpeechChunks`. Every classification favors preservation over removal and a
conservative fallback order over a confident-but-wrong one (FR-012), matching the spec's
core principle. No new dependency, no network call, no server-side processing — all analysis
runs in the browser on data the app already has (Constitution Principle I).

**Scope carried over unchanged from the prior plan**: User Story 2 (non-retention messaging,
FR-013/014) and User Story 3's UI implications beyond "text is unchanged" are specified but not
re-planned here in detail; they remain straightforward UI/copy work independent of the pipeline
rebuild below, and can be picked up alongside or after this plan's pipeline work without
blocking it.

## Technical Context

**Language/Version**: JavaScript (ES2020+), running directly in the browser without a build
step or transpiler; test files run under Node.js using the built-in `node:test` runner.

**Primary Dependencies**: None added. Existing vendored dependency PDF.js 4.10.38
(`pdf-reader/vendor/pdfjs-4.10.38/`) already returns per-text-item `transform` (position/scale
matrix), `width`, `height`, and font metadata from `page.getTextContent()` — this plan reads
fields already returned by the existing call, it does not add a new API surface or dependency.

**Storage**: N/A — no new storage. All positioned text, reconstructed lines/blocks, and
document statistics are transient, in-memory, per-extraction-call values; nothing is persisted
beyond what already isn't (bookmarks remain untouched by this feature).

**Testing**: Node's built-in `node:test` + `node:assert/strict`, following the existing pattern
in `pdf-reader/reader.test.js` (behavior-only assertions on exported pure functions, no
framework/mocking library). Given the added structural complexity (lines → blocks → columns →
reading order), tests are organized per pipeline stage per contracts/ below, each asserting
input/output behavior of one exported function, never internal representation details.

**Target Platform**: Any modern browser (client-side, static files served over HTTP); no
server-side component for this feature.

**Project Type**: Single static web app (`pdf-reader/`) — one `app.js`, no frontend/backend
split, no build pipeline.

**Performance Goals**: The added pipeline stages must not introduce a perceptible delay beyond
today's page-by-page extraction loop. Target: each stage (line reconstruction, block
reconstruction, document-stats pass, classification, reading-order resolution) runs in time
linear in the number of text items/lines/blocks on a page or in the document — no per-page
stage may re-scan the full document repeatedly. Document-wide statistics (header/footer
repetition, dominant font size) are computed once per document, not recomputed per page.

**Constraints**: Must not change the literal text or its order shown in the reading pane
(FR-009). Must be deterministic (FR-011) — every stage is a pure function over its input, no
randomness, no async state beyond the existing page-by-page PDF.js extraction loop. Must
degrade to "no change" / "conservative fallback order" rather than guess aggressively when
confidence is low (FR-010, FR-012) — this is the spec's explicit, mandatory core principle, not
merely a nice-to-have.

**Scale/Scope**: Documents in scope are typical academic papers, reports, and legal filings —
tens to low hundreds of pages — including two-column academic layouts. Per spec Assumptions,
three-or-more-column and irregular/magazine layouts route to the conservative fallback rather
than dedicated detection in this release; ML-based layout understanding is explicitly out of
scope (spec Assumptions, product plan's stated non-goal).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Local-First Privacy | Does this add any network call, upload, or new persisted data? | **Pass** — all new geometry/structure data is read from the existing local PDF.js extraction call and stays in memory; FR-015 makes this an explicit requirement, not just an inference. |
| II. Narrow Product Surface | Does this serve "make a document better to listen to?" | **Pass** — directly implements the plan's highest-priority Listening Compiler capability at higher fidelity (correct reading order, not just noise removal); no surface expansion into summarization, chat, or unrelated features. Headings/footnotes/captions/tables remain read (not selectively skippable) in this release per spec Assumptions — classification is a side effect used for ordering/noise detection, not yet exposed as a user-facing toggle, keeping scope narrow. |
| III. Behavior-Driven TDD | Can this be developed as small, behavior-only test cycles? | **Pass, with more stages than before** — each pipeline stage (line reconstruction, block reconstruction, header/footer classification, page-number classification, column detection, reading-order resolution, dehyphenation, citation/URL suppression) is independently testable via input/output assertions on its exported function. More stages means more small TDD cycles, consistent with the constitution's target of many small cycles rather than fewer large ones. |
| IV. Security Review as a Gate | Does this touch parsing, network, storage, or third-party code? | Touches parsing-adjacent processing of data already returned by the vendored, pinned PDF.js dependency — no new dependency, no new rendering path. See Security Review below. |
| V. Simplicity & Cyclomatic Discipline | Can each rule stay under complexity 10 without hidden branching? | **Pass, by design, but higher risk than the prior plan** — the reading-order and column-detection stages are the most branch-prone parts of this feature. The plan requires each classification/detection concern (header, footer, page-number, column boundary, reading-order transition cost) to be its own small function with an explicit confidence/threshold check, not one large combined function. Flagged for extra attention during implementation and code review. |

**Initial gate result: PASS.** No violations requiring Complexity Tracking justification, but
Principle V carries elevated risk in the reading-order stage — tracked as a design constraint
in Phase 1 rather than a violation, since the mitigation (small per-concern functions with
explicit thresholds) is part of the design itself, not an exception to it.

### Security Review (Constitution Principle IV)

- **A03:2025 Software Supply Chain Failures**: N/A — no new dependency is added; this feature
  reads additional fields (`transform`, `width`, `height`, font metadata) already returned by
  the existing pinned PDF.js 4.10.38 call to `getTextContent()`.
- **A07:2025 Injection**: N/A for this feature specifically — extracted text (and now its
  position/font metadata) remains untrusted data rendered only as literal text
  (`renderExtractedText`, `renderChunkedText`); this feature does not introduce any new
  rendering path, and geometry values are used only for numeric comparisons (position math),
  never interpreted as markup or code.
- **A08:2025 Mishandling of Exceptional Conditions**: Applicable, more so than the prior plan.
  A PDF with pathological structure (thousands of tiny overlapping text fragments, extreme
  font-size variance, a degenerate single "column" spanning the full page) must not cause the
  line/block reconstruction or reading-order stages to hang or produce a combinatorial blowup.
  Mitigation: every stage must be bounded to linear-time operations over its input (Technical
  Context, Performance Goals); the reading-order stage in particular must use the simplified
  deterministic ordering path described in the source design's Section 16 ("for straightforward
  pages, the implementation may use simpler deterministic ordering rather than a full graph
  solver") rather than an unbounded graph search, and the Edge Cases/FR-012 fallback (treat
  low-confidence layouts conservatively) doubles as the safety valve for pathological input, not
  just an accuracy nicety.
- **A01, A02, A04, A05, A06, A09, A10**: N/A — this feature has no access control surface,
  no configuration change, no cryptography, no authentication, no external requests, and no
  new component/dependency surface.

## Project Structure

### Documentation (this feature)

```text
specs/001-clean-private-reading/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan;
                          # NOTE: an earlier tasks.md exists from the pre-revision flat-text plan
                          # and is now stale — it must be regenerated by /speckit-tasks against
                          # this plan before implementation resumes.)
```

### Source Code (repository root)

```text
pdf-reader/
├── app.js                # extractPdfText, normalizePdfText, splitIntoSpeechChunks live here.
│                          # This feature adds the pipeline stages (positioned extraction,
│                          # line/block reconstruction, document stats, classification, column
│                          # detection, reading-order resolution, speakable-text rendering) as
│                          # new functions alongside them, and rewires extractPdfText to use the
│                          # richer PDF.js item data instead of item.str alone.
├── reader.test.js         # Existing behavior tests; this feature adds one test() per new
│                          # pipeline stage/function, following the existing style.
├── pdf-engine.js           # PDF.js loader — untouched; this feature reads more fields from the
│                          # data it already returns, no loader change needed.
├── index.html / styles.css # Untouched by the pipeline work in this plan. Non-retention
│                          # messaging (User Story 2, FR-013/014) is a separate, small,
│                          # independent addition to these files, not detailed further here.
```

**Structure Decision**: No new files or directories. This remains a single-file addition inside
the existing `pdf-reader/app.js` module and its companion `reader.test.js` — the same structure
decision as the prior plan, just with substantially more functions added to that one file,
given the added pipeline stages. The project has no frontend/backend split and no build step.

## Complexity Tracking

*No Constitution Check violations were identified. This section is intentionally empty.*

The elevated branching risk in the reading-order and column-detection stages (noted under
Principle V above) is addressed as a design requirement in Phase 1 (small, single-concern
functions with explicit confidence thresholds) rather than logged here as an accepted
violation — if implementation later finds this insufficient to stay within the complexity
budget, that would warrant a Complexity Tracking entry at that time, with the specific function
and threshold named.
