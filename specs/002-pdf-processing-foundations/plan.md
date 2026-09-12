# Implementation Plan: PDF Processing Foundations (Rules & Capability Detection)

**Branch**: `002-pdf-processing-foundations` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-pdf-processing-foundations/spec.md`

## Summary

Formalize the four non-negotiable processing rules (local-only, byte-preservation,
reproducibility, main-thread responsiveness) as explicit, testable guarantees, and add a small
capability-assessment step that runs before extraction begins. Rather than building the source
document's full multi-worker/OPFS architecture (Epics 3+, out of scope here), this plan works
with what the codebase already has: PDF.js already ships its own vendored worker
(`pdf-reader/pdf-engine.js` sets `GlobalWorkerOptions.workerSrc` explicitly, avoiding the
default CDN/fake-worker fallback risk), and `extractPdfText`'s per-page `await` loop already
yields to the event loop between pages. The concrete gaps this plan closes are: (1) no explicit
check today for whether the PDF.js worker actually initialized as a real worker versus silently
falling back to a synchronous "fake worker" shim, (2) no formal capability assessment before
processing starts, so a missing capability degrades silently instead of being reported clearly,
and (3) reproducibility and byte-preservation are true in practice but not verified by any
test today.

## Technical Context

**Language/Version**: JavaScript (ES2020+), running directly in the browser without a build
step or transpiler; test files run under Node.js using the built-in `node:test` runner —
consistent with the rest of `pdf-reader/`.

**Primary Dependencies**: None added. PDF.js 4.10.38 (already vendored, already configured with
an explicit worker script) is the only dependency this plan touches, and only to read
already-exposed state (whether its worker actually initialized), not to add new PDF.js API
surface.

**Storage**: No new storage introduced by this plan. Capability assessment results are computed
fresh each time processing starts (per spec Assumptions — not persisted between sessions) and
held only in memory for the duration of one document's processing.

**Testing**: Node's built-in `node:test` + `node:assert/strict`, matching the existing pattern in
`pdf-reader/reader.test.js`. Rules (FR-001–FR-006) and capability detection (FR-007–FR-012) are
each independently testable as pure functions or narrowly-scoped integration checks against the
existing fake-browser test harness already used for Kokoro/bookmark tests.

**Target Platform**: Any modern browser (client-side, static files served over HTTP); no
server-side component. Capability detection must work across the range of browsers this project
already targets (no browser-specific matrix testing infrastructure is introduced — Epic 23's
browser-matrix testing is explicitly out of scope for this plan).

**Project Type**: Single static web app (`pdf-reader/`) — no new files beyond additions to the
existing `app.js`/`reader.test.js`, consistent with the project's established single-file
pattern for pipeline-adjacent logic.

**Performance Goals**: Capability assessment must complete in well under 100ms so it doesn't
introduce a perceptible delay before extraction begins. The main-thread responsiveness guarantee
(FR-006) is a qualitative property (no perceptible freeze) rather than a specific frame-budget
number for this plan — Epic 19's formal 50ms long-task budget is source-document detail this
plan does not adopt wholesale, since it depends on worker-topology infrastructure this plan
explicitly does not build.

**Constraints**: Must not change any existing extraction, chunking, or narration behavior for
documents that already process successfully today — this plan adds a gate and a reporting layer
in front of the existing pipeline, not a replacement for it. Must not introduce any new network
call (Principle I) or any new persisted data (spec Assumptions).

**Scale/Scope**: Applies to every document processed through `extractPdfText`, regardless of
size; the "large document" / "small document" distinction from the spec (Edge Cases, FR-009) is
resolved by this plan as a page-count threshold checked against the capability assessment,
detailed in research.md.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Result |
|---|---|---|
| I. Local-First Privacy | Does this add any network call, upload, or new persisted data? | **Pass** — capability assessment reads only local browser/runtime state (worker init status, storage availability) and makes no network calls; nothing is persisted between sessions per spec Assumptions. |
| II. Narrow Product Surface | Does this serve "make a document better to listen to?" | **Pass, scoped deliberately** — this plan implements only Epic 1+2 of a much larger source document; it improves reliability of the existing extraction pipeline without adding OCR, semantic classification, or any new user-facing surface. The spec's own header records that Epics 3–23 are NOT pre-approved by this work. |
| III. Behavior-Driven TDD | Can this be developed as small, behavior-only test cycles? | **Pass** — each rule (FR-001–FR-006) and each capability-detection behavior (FR-007–FR-012) maps to one or two small, independently testable functions, consistent with the project's existing TDD practice. |
| IV. Security Review as a Gate | Does this touch parsing, network, storage, or third-party code? | Touches capability-checking around existing storage (`localStorage`, `IndexedDB`) and the existing vendored PDF.js worker — no new dependency, no new network path. See Security Review below. |
| V. Simplicity & Cyclomatic Discipline | Can each rule stay under complexity 10 without hidden branching? | **Pass, by design** — capability assessment is a flat set of independent boolean checks (one per capability), not a nested decision tree; each check and each fallback decision is its own small function. |

**Initial gate result: PASS.** No violations requiring Complexity Tracking justification.

### Security Review (Constitution Principle IV)

- **A03:2025 Software Supply Chain Failures**: N/A — no new dependency is added; this plan reads
  existing state from the already-vendored, pinned PDF.js 4.10.38 build.
- **A02:2025 Security Misconfiguration**: Applicable. The fake-worker detection (FR-010) exists
  specifically to catch a misconfiguration case (PDF.js silently running without its real
  worker) that could otherwise degrade main-thread responsiveness without any error being
  surfaced. Mitigation: treat an unconfirmed/fake worker the same as a missing capability
  (research.md documents the detection method), consistent with FR-012's conservative-default
  principle.
- **A08:2025 Mishandling of Exceptional Conditions**: Applicable. A capability check that itself
  throws (e.g., a browser that partially implements an API in a way that errors on feature
  detection) must not crash the app or block document loading. Mitigation: every capability
  check is wrapped so a thrown error is treated as "capability not confirmed" (FR-012), never
  propagated as an unhandled exception.
- **A01, A04, A05, A06, A07, A09, A10**: N/A — this plan has no access control surface, no
  configuration change beyond internal capability flags, no cryptography, no authentication, no
  new rendering path, and no external requests.

## Project Structure

### Documentation (this feature)

```text
specs/002-pdf-processing-foundations/
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
├── app.js                # extractPdfText, buildPipelineOutput, and the existing storage-access
│                          # functions (bookmarkStorage, IndexedDB cache) live here. This plan
│                          # adds a capability-assessment function and wires extractPdfText to
│                          # consult it before/during extraction, without altering existing
│                          # extraction, chunking, or narration logic.
├── pdf-engine.js           # Already configures PDF.js's real worker explicitly; this plan reads
│                          # (does not change) whether that worker actually initialized.
├── reader.test.js         # Existing behavior tests; this plan adds tests for each rule and
│                          # each capability-detection behavior, following the existing style.
```

**Structure Decision**: No new files or directories. This plan adds functions to the existing
`pdf-reader/app.js` module and tests to `pdf-reader/reader.test.js`, matching the single-file
pattern already used for every prior pipeline addition in this project. The source document's
Epic 3 worker topology (a separate semantic worker, an OCR worker, a page-batch request loop) is
explicitly not built here — this plan works within the project's existing single-script
architecture.

## Complexity Tracking

*No Constitution Check violations were identified. This section is intentionally empty.*
