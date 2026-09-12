# Implementation Plan: Document AST & Block Schema

**Branch**: `004-document-ast` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-document-ast/spec.md`

## Summary

Reshape the pipeline's internal block representation — currently anonymous objects with
`{ page, lines, text, bbox, fontSize, type, confidence, column }`, discarded entirely at the end
of `buildPipelineOutput` in favor of two flattened strings (`displayText`, `narrationText`) — into
an explicit, typed `DocumentBlock` shape (adding stable `id`, `readingOrder`, and a `speak`
boolean derived from the existing `NARRATION_EXCLUDED_TYPES` set) grouped into a `Document` /
`Section` tree. This is a pure internal reshaping: `classifyBlocks`, `resolveReadingOrder`, and
every type-assignment decision already made by specs 001-003 are untouched, so narration output
and display text are byte-identical before and after. `buildPipelineOutput` additionally returns
the new `document` structure alongside the existing `displayText`/`narrationText` fields (both
kept, unchanged) so later specs (005 speech policy, 006 normalization) have a typed structure to
consume without any spec needing to re-derive it.

## Technical Context

**Language/Version**: JavaScript (Node.js `--test` runner; browser-executed via `<script>`, no
build step, no TypeScript compiler — the goal document's `DocumentBlock` type is implemented as a
plain-object shape, not a compiled type)

**Primary Dependencies**: None new. Existing: PDF.js (vendored, `pdf-reader/vendor/`), fflate
(vendored, EPUB path) — this feature touches neither.

**Storage**: N/A — in-memory structure only; no persistence format introduced by this spec (that
is deferred to the resume-state spec later in the 004-009 sequence).

**Testing**: `node --test reader.test.js` (Node's built-in test runner + `node:assert/strict`,
consistent with specs 001-003).

**Target Platform**: Browser (client-side, offline-first), per constitution Principle I.

**Project Type**: Single-page web application, single source file (`pdf-reader/app.js`) plus its
co-located test file (`pdf-reader/reader.test.js`) — same structure as specs 001-003, no new
project or module boundary introduced.

**Performance Goals**: No new performance target; must not regress existing pipeline latency
since the change is a reshape of already-computed data, not new computation.

**Constraints**: Must not change `displayText`, `narrationText`, block `type` assignment, or
reading order for any document specs 001-003 already process correctly (FR-005, FR-006). Must
not touch `index.html`/`styles.css`/reader controls (explicit user decision: rebuild the pipeline
underneath, not the interface).

**Scale/Scope**: One file (`pdf-reader/app.js`), additive changes to `buildPipelineOutput` and a
handful of new small functions (id assignment, section grouping); no change to file/module count.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS / N/A-clean. No new storage, no new network path,
  no new persisted identifier. Block ids are derived in-memory from content + position (FR-009)
  and are not written to disk in this spec.
- **Principle II (Narrow Product Surface)**: PASS. This is infrastructure for the already-planned
  005/006 specs (speech policy, normalization), not a new user-facing feature; it does not expand
  what the product does today.
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS, with a scoping note. Most of
  this spec's requirements (FR-005, FR-006 — no behavior change) are proven by the *existing*
  test suite continuing to pass unmodified, not by new tests — there is no new observable
  narration/display behavior to write a new behavioral test against. The genuinely new observable
  behaviors (schema completeness FR-001–FR-004, id stability FR-009, section grouping FR-007–
  FR-008) each get one new failing test before their minimal implementation, per the tasks.md
  breakdown. No test targets a constructor, private helper, or internal call sequence — every new
  test asserts on the shape/content of `buildPipelineOutput`'s (or a newly-exposed grouping
  function's) return value, which is this feature's public contract.
- **Principle IV (Security Review as a Gate)**: N/A, justified. This spec touches no document
  parsing input path, no network request, no storage, and no third-party code — it reshapes
  already-extracted, already-classified in-memory data. No new OWASP-relevant surface is
  introduced. (Security Review section included below per the mandatory-section rule, with this
  N/A reasoning stated explicitly.)
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS. Id assignment and section grouping
  are each single-purpose functions with low branching (content/position hash; a linear
  heading-boundary scan). No configuration surface or extensibility hook is introduced beyond
  what FR-007/FR-008 require. Complexity Tracking table below is empty — no violations to
  justify.

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1 data-model.md/contracts/quickstart.md): PASS, unchanged.
The finalized design adds exactly two new pure functions (`assignBlockIds`, `buildDocumentAst`)
and one extended function (`buildPipelineOutput` gains a `document` field); no new file, module,
storage, network path, or configuration surface emerged during design that wasn't already
accounted for in the initial gate. Principle V's complexity ceiling is not at risk — both new
functions are single-purpose with linear control flow (id hashing; one grouping pass), well under
the cyclomatic limit of 10.

## Security Review

*(Constitution Principle IV — included per mandatory-section rule; N/A justification stated per
gate above.)*

- **Applicable OWASP Top 10:2025 risks**: N/A. This feature adds no new input path (it consumes
  data already extracted and classified by specs 001-003's existing PDF/EPUB import), no network
  request, no storage write, and no third-party dependency. A06 (Injection), A07/A09
  (Authentication/Components), A10 (SSRF) are N/A — no such surface exists here. A08 (Mishandling
  of Exceptional Conditions) is already covered by the existing extraction path (spec 002) and is
  unchanged by this spec.
- **Mitigations**: N/A — no mitigation needed given no new surface.
- **Key behavior-driven security tests planned via TDD**: None required for this spec. Security-
  relevant behavior tests (loopback-only TTS endpoint validation, zip-bomb bounds, literal-text
  rendering) already exist from specs 001-003 and are unaffected; SC-001 (full existing suite
  passes unmodified) is this spec's guardrail against silently regressing them.

## Project Structure

### Documentation (this feature)

```text
specs/004-document-ast/
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
├── app.js               # Single source file (specs 001-003). This feature adds:
│                         #   - buildDocumentAst(...)/groupBlocksIntoSections(...) (new)
│                         #   - assignBlockIds(...)/assignReadingOrder(...) (new)
│                         #   - a `speak` boolean derived from NARRATION_EXCLUDED_TYPES (new)
│                         #   - buildPipelineOutput(...) extended to also return `document`
│                         #     (existing displayText/narrationText fields unchanged)
├── reader.test.js        # Same file; new tests appended per tasks.md, existing tests untouched
├── index.html            # NOT modified by this feature (explicit scope boundary)
└── styles.css            # NOT modified by this feature (explicit scope boundary)
```

**Structure Decision**: Single-file project, matching specs 001-003 — no new project, module, or
build step. All new logic lives in `pdf-reader/app.js` as additional functions exported the same
way existing pipeline functions already are (see the `module.exports` block); all new tests live
in `pdf-reader/reader.test.js` alongside the existing suite. This is a reshape of one function's
output (`buildPipelineOutput`) plus new pure functions that produce the id/section/AST layer from
data `classifyBlocks`/`resolveReadingOrder` already compute — it does not warrant a new file or
directory per Principle V (no abstraction beyond current, real requirements).

## Complexity Tracking

*No violations — this section is intentionally empty. Constitution Check above passed without
requiring any justified exception.*
