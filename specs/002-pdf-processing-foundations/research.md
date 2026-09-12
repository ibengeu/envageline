# Phase 0 Research: PDF Processing Foundations (Rules & Capability Detection)

No items in Technical Context were marked `NEEDS CLARIFICATION` — the existing codebase already
answers language, testing approach, and architecture. This document resolves the concrete design
questions needed to implement the four rules and the capability-assessment step correctly and
minimally, deliberately not adopting the source document's heavier worker-topology/OPFS
architecture (out of scope per plan.md).

## 1. Detecting a real vs. fake PDF.js worker (FR-010)

**Decision**: Treat the PDF.js worker as confirmed-real only when `typeof Worker === "function"`
in the current environment AND the vendored PDF.js build's console warning path does not emit
its known fake-worker message (`"Setting up fake worker."`) during document load. Capture this
via a scoped `console.warn` interception during the `getDocument(...).promise` call, restoring
the original `console.warn` immediately after — narrow enough not to swallow unrelated warnings,
and using only PDF.js's existing, stable public behavior (a documented log message this exact
vendored version emits, confirmed by inspecting the vendored file directly) rather than reaching
into `PDFWorker`'s private class fields.

**Rationale**: PDF.js does not expose a simple public boolean like `pdf.usedFakeWorker`; the
console-warning path is the most stable, already-present signal without adding a new dependency
or patching the vendored file. `typeof Worker === "function"` alone is necessary but not
sufficient — a browser could support `Worker` in general while PDF.js still falls back for other
reasons (e.g., cross-origin worker script restrictions), so both signals are checked together,
consistent with FR-012's "treat inconclusive as unavailable" default.

**Alternatives considered**:
- *Patch or wrap `pdfjsLib.PDFWorker` to intercept its internal fallback path.* Rejected —
  reaches into private/internal API surface of a vendored dependency, which is fragile across
  PDF.js version upgrades and heavier than the problem requires.
- *Assume the worker is real whenever `typeof Worker === "function"`.* Rejected — this is
  exactly the "capability appears present but is actually a non-functional substitute" case
  FR-010 exists to catch; same-origin restrictions and other environment quirks can still force
  PDF.js's fallback even when `Worker` exists globally.

## 2. What "large document" means for FR-008/FR-009's gate (page-count threshold)

**Decision**: Use PDF.js's own reported page count (`pdf.numPages`, already read by
`extractPdfText` today) against a single threshold, informed by where main-thread
responsiveness has actually been reported as a problem in this project: no such report exists
yet, but the existing per-page `await` loop already yields between pages, so the risk is
specifically long individual-page processing on documents with very many pages compounding into
a long *total* wait, not a single blocking call. A page-count threshold of 200 pages is used as
the "large document" boundary for gating (i.e., requiring a confirmed-real worker and confirmed
storage availability before proceeding) — chosen as a round, defensible number well above this
project's typical fixtures (the session's own manual-testing fixtures ranged from 18 to 389
pages) without being so low that ordinary documents get gated unnecessarily.

**Rationale**: The spec deliberately leaves the exact threshold as an implementation detail
(Assumptions). Tying it to `pdf.numPages` reuses data already read by `extractPdfText`, adding no
new PDF.js calls. The number itself is a tunable constant, not a business rule — documented here
so `/speckit-tasks` has something concrete to implement and test against, and easily revised
later without needing a new spec.

**Alternatives considered**:
- *Byte size instead of page count.* Rejected — page count more directly predicts the number of
  per-page `await extractPositionedItems/reconstructLines/reconstructBlocks` cycles the Smart PDF
  Reading pipeline already runs, which is the actual driver of cumulative main-thread time, more
  than raw file size.
- *No threshold — treat every document as "large."* Rejected — directly conflicts with FR-009,
  which requires small documents to proceed even when a capability is missing.

## 3. Which capabilities are checked (FR-007)

**Decision**: Check exactly three capabilities, matching what this codebase's existing features
already depend on (confirmed by inspecting `app.js`): (a) whether `Worker` exists and PDF.js
confirmed a real worker (research.md §1) — required for large documents; (b) whether
`localStorage` is accessible (already guarded defensively by the existing `bookmarkStorage()`
function) — required only for bookmarking, not for extraction/narration itself; (c) whether
`indexedDB` is accessible (already used by the existing local-TTS audio cache) — required only
for local-TTS audio caching, not for extraction/narration itself. No other capability from the
source document's Epic 2 list (OffscreenCanvas, ImageBitmap, WebAssembly, OPFS, SharedArrayBuffer,
cross-origin isolation, CPU core count, device memory) is checked, since none of them are used by
anything this codebase actually does today — checking them would be speculative, violating
Constitution Principle V (YAGNI).

**Rationale**: FR-007 requires determining "relevant" capabilities — relevance is scoped to what
the current feature set actually needs, not the source document's full future-looking list
built for OCR/worker-topology/OPFS features this plan explicitly excludes.

**Alternatives considered**:
- *Adopt the full Epic 2 capability list (OPFS, OffscreenCanvas, SharedArrayBuffer, etc.).*
  Rejected — none of those capabilities are used by any shipped feature; checking for them now
  would be dead code with no consumer, violating simplicity and inviting confusion about what
  the checks actually gate.

## 4. Verifying reproducibility (FR-004/FR-005) as an actual test

**Decision**: Add a deterministic-output test that runs the existing `buildPipelineOutput`
function twice with byte-identical synthetic input and asserts the two results are deeply equal
— this already has partial coverage (`buildPipelineOutput is deterministic across repeated calls
with the same input`, added during the Smart PDF Reading feature) but this plan extends that
same pattern to cover the full rule explicitly at the level of the *whole* processing rule (not
just one pipeline stage), including the display-text path, and documents it as satisfying
FR-004/FR-005 directly rather than being an incidental side effect of another feature's tests.

**Rationale**: Reproducibility was previously verified only incidentally (as part of testing the
narration pipeline's own correctness). This plan makes it an explicit, named guarantee with its
own test, so a future change that breaks reproducibility fails a test whose purpose is
unambiguous, rather than relying on an unrelated feature's test to happen to catch it.

**Alternatives considered**:
- *Rely entirely on the existing incidental test.* Rejected — that test is scoped to
  `buildPipelineOutput`'s pipeline internals and could be refactored or removed without anyone
  realizing it was also the only check for this rule; an explicitly-named test tied to this
  spec's FR-004/FR-005 makes the guarantee visible and intentional.

## 5. Verifying byte-preservation (FR-003) as an actual test

**Decision**: Add a test asserting that `extractPdfText`/`extractEpubText` never call any
mutating method on the input `File`/`Blob` object — verified by asserting the file object passed
in is never reassigned and its `arrayBuffer()` result (read once) is never written back to
anything resembling the original file reference. Since browsers already make `File`/`Blob`
objects immutable by platform design (there is no public API to mutate the bytes of a `File`
object from JavaScript), this is largely a design constraint already enforced by the browser
itself; the test's role is to confirm the code never attempts to construct a new file/write path
that could violate this (e.g., no `FileSystemWritableFileStream` or similar write-back API is
ever invoked against the source file).

**Rationale**: FR-003 is, in the browser environment this project targets, substantially
guaranteed by the platform (JS cannot mutate a `File`'s bytes in place). The meaningful thing to
test is that this project's own code never attempts to open a write handle back to the original
file — which it does not do anywhere today (confirmed: no `createWritable`, no
`FileSystemWritableFileStream`, no OPFS write calls exist in `app.js`).

**Alternatives considered**:
- *Hash the file before and after processing and compare.* Considered as an additional,
  belt-and-suspenders check; adopted as the quickstart's manual verification step
  (quickstart.md) rather than a unit test, since a unit test already knows the code never
  attempts a write and a hash-compare test would only prove what's already structurally
  guaranteed by the browser platform.

## 6. Verifying local-only processing (FR-001/FR-002) as an actual test

**Decision**: Add a test that provides a `fetch` spy to the existing fake-browser test harness
during a normal document-load-and-narrate cycle (reusing `loadBrowserApp`'s existing
`fetchImpl` hook) and asserts that no fetch call's URL or body contains the loaded document's
extracted text, and that the only fetch calls made (if any, e.g. to a local Kokoro TTS endpoint)
target `localhost`/`127.0.0.1` — reusing the existing `isLocalTtsEndpoint` guard already tested
elsewhere. This directly exercises FR-001 for the one network-capable code path this project
has (local TTS), since every other code path already makes no network calls at all.

**Rationale**: The local-TTS path is the only place this codebase makes any `fetch` call at all;
proving FR-001 there also demonstrates the rest of the pipeline (no other code path calls
`fetch`) has nothing to violate it with, consistent with what's already implicitly tested by the
existing `isLocalTtsEndpoint` rejection tests.

**Alternatives considered**:
- *Audit every function for the absence of `fetch`.* Rejected as a one-time manual check instead
  of an automated test — not repeatable, wouldn't catch a future regression. The chosen test
  (assert no document text ever appears in a fetch body/URL) is automated and catches exactly
  the failure mode FR-001 exists to prevent.
