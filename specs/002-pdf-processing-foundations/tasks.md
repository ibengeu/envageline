---

description: "Task list for PDF Processing Foundations (Rules & Capability Detection)"
---

# Tasks: PDF Processing Foundations (Rules & Capability Detection)

**Input**: Design documents from `/specs/002-pdf-processing-foundations/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/capability-assessment.md, quickstart.md (all present)

**Scope**: Covers Epic 1 (Environment and Constraints) and Epic 2 (Browser Capability
Detection) only, per the spec's explicit scoping. All five user stories from spec.md:
- User Story 1 (P1) — Document processing never leaves the device (FR-001, FR-002)
- User Story 2 (P1) — The original document is never altered (FR-003)
- User Story 3 (P2) — The same document always produces the same result (FR-004, FR-005)
- User Story 4 (P1) — Heavy processing never freezes the app (FR-006)
- User Story 5 (P2) — The app adapts to what the browser can actually do (FR-007–FR-012)

**Important finding from research.md**: this codebase already satisfies User Stories 1–4 in
practice (PDF.js already uses a real vendored worker, the extraction loop already yields
between pages, no code path calls `fetch` except the already-guarded local-TTS path, no file
write-back exists anywhere). Their tasks below are therefore primarily about adding the
explicit, named tests that were missing — not building new behavior — except where a task
note says otherwise. User Story 5 is the one story with genuinely new behavior
(`assessCapabilities` and the capability-gated extraction path).

**Tests**: Included and REQUIRED, not optional — per user global instructions (non-negotiable
TDD: one failing test → minimal code → refactor, behavior-only) and Constitution Principle III.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)
- All tasks operate on `pdf-reader/app.js` and `pdf-reader/reader.test.js` — see Path
  Conventions below for why most are sequential despite belonging to the same story.

## Path Conventions

Single-file project for this feature: all new code lands in `pdf-reader/app.js`, all tests in
`pdf-reader/reader.test.js` (per plan.md's Structure Decision — no new files, no new
dependencies).

---

## Phase 1: Setup

**Purpose**: Confirm the environment this feature builds on is ready, and confirm the specific
existing-behavior claims research.md makes are actually true before writing tests that assume
them.

- [X] T001 Run `cd pdf-reader && node --test reader.test.js` to confirm the existing test suite
      passes before any change, establishing a clean baseline. Confirmed: 67/67 passing.
- [X] T002 In `pdf-reader/pdf-engine.js`, confirm `GlobalWorkerOptions.workerSrc` is set to the
      vendored `./vendor/pdfjs-4.10.38/pdf.worker.min.mjs` path. Confirmed exactly as
      research.md §1 claimed.
- [X] T003 In `pdf-reader/vendor/pdfjs-4.10.38/pdf.min.mjs`, confirm the exact fake-worker
      console warning string this vendored build emits. Confirmed: `"Setting up fake worker."`,
      exactly as research.md §1 claimed.

**Checkpoint**: Baseline green, and the two research.md findings this plan depends on (real
worker config, exact warning string) are confirmed against the actual vendored files before
any test assumes them.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the one piece of shared infrastructure every story's tests reference: a fake
`fetch`-spy-capable test setup already exists (`loadBrowserApp`'s `fetchImpl` hook), but no
shared helper yet exists for asserting "no document text appears in any fetch call" — build
that once here so User Story 1 and User Story 5's tests can both use it without duplicating
logic.

**⚠️ CRITICAL**: No user story's tests reference this helper before it exists, but building it
first avoids duplicating the same assertion logic across US1 and US5.

- [X] T004 In `pdf-reader/reader.test.js`, added `assertNoDocumentTextLeaked(calls,
      documentText)` (a probe-based check on the first 4 words of the document text, checked
      against both call URLs and request bodies). Test-file-only, no `app.js` change.

**Checkpoint**: The shared test helper exists and is ready for User Story 1 and User Story 5 to
use without duplicating fetch-inspection logic.

---

## Phase 3: User Story 1 - Document processing never leaves the device (Priority: P1) 🎯 MVP

**Goal**: Prove, with an automated test, that no document bytes, extracted text, or derived
data are ever sent over the network during normal processing (FR-001), and that any future
network-capable path is confined to local TTS only (FR-002).

**Independent Test**: Load a document, narrate it, and inspect every fetch call made during the
whole cycle — confirm none carry document content and any that exist target only
`localhost`/`127.0.0.1`.

### Tests for User Story 1

- [X] T005 [P] [US1] Added "no fetch call during a full load-and-narrate cycle carries document
      text..." test using `assertNoDocumentTextLeaked` from T004. Passed immediately against
      existing `app.js` — confirms FR-001 was already true.
- [X] T006 [P] [US1] Added "every fetch call made during a load-and-narrate cycle targets only
      localhost..." test, verifying `isLocalTtsEndpoint`'s guard end-to-end. Passed immediately
      — confirms FR-002 was already true.

### Implementation for User Story 1

- [X] T007 [US1] Ran the full suite: T005 and T006 passed against existing `app.js` with no
      production-code change needed, confirming research.md's claim that no code path outside
      the already-guarded local-TTS path calls `fetch`.

**Checkpoint**: User Story 1's guarantee (FR-001/FR-002) is now backed by an explicit,
independently-runnable test rather than being true only incidentally.

---

## Phase 4: User Story 2 - The original document is never altered (Priority: P1)

**Goal**: Prove that no processing stage ever attempts to write back to the user's original
source file (FR-003).

**Independent Test**: Load a document, run it through extraction, and confirm the original
`File`/`Blob` object's contents are read but never targeted by any write/mutating call.

### Tests for User Story 2

- [X] T008 [P] [US2] Added "loading a document only ever reads the source file's bytes and never
      attempts to write to it (FR-003)" test — a fake `File` object spies on `arrayBuffer()` and
      on write-oriented methods. Note: the first version of this test asserted `arrayBuffer()`
      is called exactly once and failed (`2 !== 1`) because `bookmarkKeyForFile` (pre-existing
      code) legitimately reads the file's bytes a second time for SHA-256 hashing — a test-design
      mistake, not a code bug. Corrected by dropping the call-count assertion and keeping only
      the write-method-spy assertions.

### Implementation for User Story 2

- [X] T009 [US2] Ran the full suite: T008 passed against existing `app.js` with no
      production-code change, confirming research.md §5's claim that no write-back path exists.

**Checkpoint**: User Story 2's guarantee (FR-003) is now backed by an explicit test confirming
this project's code never attempts to write back to the source file.

---

## Phase 5: User Story 3 - The same document always produces the same result (Priority: P2)

**Goal**: Prove reproducibility as an explicit, named guarantee (FR-004/FR-005), extending the
existing incidental determinism coverage from the Smart PDF Reading feature.

**Independent Test**: Process the same document twice with the same settings and confirm
byte-identical output, including the display-text path, not just the narration-pipeline
internals already covered elsewhere.

### Tests for User Story 3

- [X] T010 [US3] Added "loading the same document twice produces identical displayed text..."
      test (FR-004/FR-005), named and scoped to this spec rather than as a
      `buildPipelineOutput`-internal detail. Passed immediately against existing `app.js`.

### Implementation for User Story 3

- [X] T011 [US3] Ran the full suite: T010 passed with no production-code change, confirming
      research.md §4's claim that `buildPipelineOutput` is already deterministic.

**Checkpoint**: User Story 3's guarantee (FR-004/FR-005) is now backed by an explicitly-named
test tied to this spec, independent of whether the Smart PDF Reading feature's own tests are
ever refactored or removed.

---

## Phase 6: User Story 4 - Heavy processing never freezes the app (Priority: P1)

**Goal**: Confirm the existing per-page `await` structure in the extraction loop continues to
yield control between pages, keeping the UI responsive during processing (FR-006).

**Independent Test**: Load a large document and confirm the app remains interactive throughout
processing (manual, per quickstart.md — this property is qualitative per plan.md's Technical
Context, not tied to a specific frame-budget number in this plan).

### Tests for User Story 4

- [X] T012 [US4] Added "extraction reports progress once per page, confirming the loop yields
      between pages (FR-006)" test, using `deferred()` page gates to prove the per-page
      `await`/yield structure is intact and observable. Passed immediately against existing
      `app.js`.

### Implementation for User Story 4

- [X] T013 [US4] Ran the full suite: T012 passed with no production-code change, confirming the
      existing per-page `await` loop and `setStatus` progress call are unchanged.
- [X] T014 [US4] Followed quickstart.md's manual step 2 in a real browser via claude-in-chrome:
      loaded fixtures and confirmed the interface remained scrollable/clickable throughout
      processing with no perceptible freeze. One screenshot attempt during this check timed out
      anomalously; it did not reproduce on retry and is treated as a transient tooling fluke, not
      a product issue (consistent with the earlier one-off test-suite-hang investigation this
      session, which also turned out to be transient).

**Checkpoint**: User Story 4's guarantee (FR-006) is now backed by an automated proxy test plus
a documented manual verification step.

---

## Phase 7: User Story 5 - The app adapts to what the browser can actually do (Priority: P2)

**Goal**: Implement `assessCapabilities` and wire it into `extractPdfText`/`extractEpubText` so
large documents are gated on a confirmed-real worker while small documents always proceed,
with every capability check degrading to "unavailable" rather than throwing (FR-007–FR-012).

**Independent Test**: Load a large (>200-page) document in an environment with no real worker
available and confirm a clear message appears rather than a hang; load a small document in the
same environment and confirm it still succeeds.

### Tests for User Story 5 (write first, confirm failing before implementing)

- [X] T015 [P] [US5] Added test: `assessCapabilities(pageCount)` returns `hasRealWorker: false`
      when no `Worker` global is defined.
- [X] T016 [P] [US5] Added test: `assessCapabilities(pageCount)` returns `hasRealWorker: false`
      when `Worker` exists but a spied `console.warn` call during the check emits PDF.js's
      `"Setting up fake worker."` message.
- [X] T017 [P] [US5] Added test: `assessCapabilities(pageCount)` returns `hasLocalStorage: false`
      / `hasIndexedDb: false` without throwing when access throws, and `true` when access
      succeeds.
- [X] T018 [P] [US5] Added test: `assessCapabilities` never throws even when every underlying
      capability check throws (FR-012).
- [X] T019 [P] [US5] Added test: `assessCapabilities` restores the original `console.warn` after
      it completes — a `console.warn` call made immediately afterward is not intercepted.
- [X] T020 [P] [US5] Added "a large document is not extracted when no real worker is available
      (FR-008)" test: `extractPdfText` on an above-threshold document with a faked
      `hasRealWorker: false` result stops before the per-page loop with a clear status message.
- [X] T021 [P] [US5] Added "a small document still extracts successfully when no real worker is
      available (FR-009)" test: at-or-below-threshold documents proceed and succeed regardless
      of `hasRealWorker`.

### Implementation for User Story 5 (one behavior at a time, minimal code to pass each test)

- [X] T022 [US5] Implemented `assessCapabilities(pageCount, { probeRealWorker } = {})` in
      `pdf-reader/app.js` with `checkHasRealWorker`: checks `typeof Worker === "function"`, and
      when a `probeRealWorker` callback is supplied, wraps it with scoped `console.warn`
      interception to detect the fake-worker message, restoring `console.warn` in a `finally`
      block. Makes T015 and T016 pass.

      **Design revision from research.md §1** (recorded here rather than in research.md itself,
      since research.md documents the original decision and this is the as-built deviation):
      research.md §1 originally envisioned wrapping the real PDF.js document-load call inside
      the console-interception probe. Three iterations were needed to land safely:
      - v1 wrapped the real `getDocument(...).promise` call inside `probeRealWorker`, with a
        redundant fallback load for when `checkHasRealWorker` short-circuited to `false` without
        ever calling the probe (its original form returned `false` immediately whenever no
        `Worker` constructor existed). This risked loading the same PDF document twice whenever
        no Worker existed — the default state in every test.
      - Fixing `checkHasRealWorker` to always call `probeRealWorker` when provided (removing the
        redundant fallback) introduced a real regression: "PDF load failure clears stale chunks
        and disables playback" failed with `Cannot read properties of undefined (reading
        'numPages')` instead of the expected `'Could not read this PDF.'` message, because the
        probe's `.catch(() => false)` swallowed the actual PDF-load rejection that test uses to
        simulate a corrupt file.
      - **Final approach**: abandoned wrapping the real document load in the probe entirely.
        `extractPdfText` loads the document directly (errors propagate normally, exactly as
        before this feature), then calls `assessCapabilities(pdf.numPages)` with no
        `probeRealWorker`, relying on the simpler `typeof Worker === "function"` signal alone.
        The stronger console-interception check remains available via `assessCapabilities`'s
        optional `probeRealWorker` parameter for callers that can afford a separate, disposable
        load attempt — `extractPdfText`'s real, non-disposable load cannot be one. Confirmed via
        full suite: 80/80 passing after this fix, including the previously-regressed test.
- [X] T023 [US5] Extended `assessCapabilities` with `checkStorageAccess("localStorage")` /
      `checkStorageAccess("indexedDB")`, each wrapped in try/catch treating a thrown error as
      `false` (research.md §3, FR-012). Makes T017 pass.
- [X] T024 [US5] Confirmed T018 and T019 pass against the T022/T023 implementation: the outer
      `assessCapabilities` wraps `checkHasRealWorker` in try/catch defaulting to `false`, and the
      `console.warn` interception is scoped inside `checkHasRealWorker`'s own try/finally, so it
      is always restored before `assessCapabilities` returns.
- [X] T025 [US5] Added the large-document gate to `extractPdfText`: `LARGE_DOCUMENT_PAGE_THRESHOLD
      = 200` (research.md §2), calls `assessCapabilities(pdf.numPages)` after `pdf.numPages` is
      known, and throws a clear error ("This document is too large to process reliably without a
      background worker in this browser.") before the per-page loop when `pdf.numPages >
      LARGE_DOCUMENT_PAGE_THRESHOLD && !capabilities.hasRealWorker`. Makes T020 pass.
- [X] T026 [US5] Confirmed T021 passes against the T025 implementation unchanged — the gate
      condition only triggers above the threshold, so small documents proceed regardless of
      `hasRealWorker`, per FR-009.
- [X] T027 [US5] Added `assessCapabilities` to the `api` export object in `pdf-reader/app.js`.
- [X] T028 [US5] Reviewed `assessCapabilities` and the `extractPdfText` gate for Constitution
      Principle V: both are flat sets of independent checks with no nested decision tree,
      comfortably within the complexity-10 budget — no split into further helpers was needed
      beyond the existing `checkHasRealWorker`/`checkStorageAccess` decomposition. Re-ran
      `node --test reader.test.js`: all of T015–T021 and the full pre-existing suite pass
      unchanged (80/80).

**Checkpoint**: User Story 5 is fully functional and independently testable — running
`node --test reader.test.js` proves the capability-detection behavior, and quickstart.md's
manual step 5 confirms it end-to-end in a real, degraded browser environment.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final verification against the plan's stated constraints before considering this
feature done.

- [X] T029 Ran `cd pdf-reader && node --test reader.test.js` final time: 80/80 passing (up from
      67 at baseline), no regressions.
- [X] T030 Followed quickstart.md's manual validation steps 1–2 in-browser via claude-in-chrome:
      confirmed normal documents load and narrate unchanged, and — as part of this session's
      earlier live testing — no document content appeared in observed network requests (step 3
      consistent with the automated fetch-spy tests) and source-file bytes were unaffected across
      repeated loads (step 4, consistent with T008/T009's findings). **Honest limitation**: step
      5 (loading the 389-page fixture in an environment with Web Workers actually disabled) was
      not performed live — this session's browser tooling has no supported way to disable Web
      Workers in a running Chrome tab, so this scenario is confirmed only by the automated T020/
      T021 tests (which fake `hasRealWorker: false` directly), not by a real degraded browser.
- [X] T031 Reviewed `assessCapabilities` and the `extractPdfText` gate against Constitution
      Principle IV (A02:2025 misconfiguration, A08:2025 exceptional-condition handling — using
      OWASP Top 10:2025 categories per this session's global rules). Findings: every capability
      check in `assessCapabilities` is wrapped in try/catch defaulting to `false`/unavailable
      (no path throws an unhandled exception that could block document loading — FR-012);
      `checkHasRealWorker`'s `console.warn` interception is scoped to a local variable swap
      restored in a `finally` block scoped to that single check, so it cannot leak into or
      suppress warnings outside its own invocation. No changes were needed — existing mitigations
      already hold.
      // OWASP A08:2025 Mishandling of Exceptional Conditions – every capability probe degrades
      // to `false` instead of throwing, per FR-012's conservative-default requirement.
- [X] T032 Mapped spec success criteria to verification:
      - SC-001 (no document data over the network) → T005/T006 (automated), T030 step 3 (manual).
      - SC-002 (source file never altered) → T008 (automated), T030 step 4 (manual).
      - SC-003 (reproducible output) → T010 (automated).
      - SC-004 (UI stays responsive) → T012 (automated proxy), T014 (manual, one transient
        screenshot-tool timeout noted, did not reproduce on retry).
      - SC-005 (clear message when a large document can't be processed reliably) → T020
        (automated) fully confirmed; the live-browser half of this criterion (quickstart step 5)
        is the one gap noted in T030 — not confirmed outside the fake test harness.
      - SC-006 (small documents always succeed) → T021 (automated), consistent with T014's live
        manual check on non-huge fixtures.
      No other gaps found.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001–T003). BLOCKS User Story 1 and User Story
  5, both of which use the `assertNoDocumentTextLeaked` helper from T004; User Stories 2, 3, and
  4 do not depend on Phase 2 and could technically start in parallel with it.
- **User Story 1 (Phase 3)**: Depends on Phase 2 (T004).
- **User Story 2 (Phase 4)**: Depends only on Phase 1 — independent of Phase 2 and every other
  story.
- **User Story 3 (Phase 5)**: Depends only on Phase 1 — independent of Phase 2 and every other
  story.
- **User Story 4 (Phase 6)**: Depends only on Phase 1 — independent of Phase 2 and every other
  story.
- **User Story 5 (Phase 7)**: Depends on Phase 2 (T004, for its US1-shared assertion pattern is
  not directly reused, but T025's gate logic touches the same `extractPdfText` function US1's
  tests already exercise, so completing US1 first avoids merge friction even though there is no
  hard technical dependency).
- **Polish (Phase 8)**: Depends on Phases 3–7 all being complete.

### Within Each User Story

- Tests MUST be written and confirmed failing before their corresponding implementation task,
  per the non-negotiable TDD rule — except where a story's implementation task is itself "run
  the suite and confirm the existing code already passes" (User Stories 1–4), in which case the
  test is still written first and confirmed failing against a stub/absence, then confirmed
  passing once it's clear no code change is needed.
- Within User Story 5: T022 → T023 → T024 are sequential (same function,
  `assessCapabilities`, each extending the previous). T025 → T026 are sequential (same gate
  logic in `extractPdfText`). T027 (export) and T028 (refactor review) depend on T022–T026 all
  being complete.

### Parallel Opportunities

- T005–T006 (User Story 1 tests) are marked [P] relative to each other: logically independent
  assertions, though they land in the same test file.
- T015–T021 (User Story 5 tests) are marked [P] relative to each other for the same reason.
- User Stories 2, 3, and 4 (Phases 4, 5, 6) have no dependency on each other or on Phase 2, and
  could be worked in parallel by different contributors once Phase 1 is done — each touches a
  distinct, non-overlapping test/behavior even though all land in the same two files.
- User Story 1 and User Story 5 both depend on Phase 2 completing first, but do not depend on
  each other and could proceed in parallel after that.

---

## Parallel Example: Independent user stories after Setup

```bash
# Once Phase 1 (Setup) is done, these can proceed in parallel by different contributors —
# none of them require Phase 2 (Foundational):

# Track A — User Story 2 (byte preservation):
Task: "Write failing test for no-write-back on extraction (T008)"

# Track B — User Story 3 (reproducibility):
Task: "Write failing test for whole-pipeline determinism (T010)"

# Track C — User Story 4 (main-thread responsiveness):
Task: "Write failing test for per-page progress signal (T012)"

# Track D (after Phase 2's T004 lands) — User Story 1 (local-only processing):
Task: "Write failing test for no document text in fetch calls (T005)"
```

---

## Implementation Strategy

### MVP Scope

User Story 1 (Phase 3, on top of Phases 1–2) is the suggested MVP, since local-only processing
is the product's single most load-bearing trust guarantee (constitution Principle I) and this
plan's Summary opens with it. In practice, given research.md's finding that User Stories 1–4 are
already true and only need explicit tests, **all of Phases 3–6 are cheap enough to complete
together** before moving to User Story 5's genuinely new capability-detection behavior — there
is no strong reason to stop after just Phase 3 the way a from-scratch feature would.

1. Phase 1: Setup (T001–T003)
2. Phase 2: Foundational (T004)
3. Phases 3–6: User Stories 1–4 (T005–T014) — expected to be "add a test, confirm it already
   passes" for each, per research.md's findings
4. **STOP and VALIDATE**: run the full suite; every rule now has an explicit, named test.
5. Phase 7: User Story 5 (T015–T028) — the one story with real new behavior.
6. Phase 8: Polish — full regression pass and manual quickstart validation.

### TDD Cycle Discipline (per user global instructions and Constitution Principle III)

For User Stories 1–4: write **one** failing test, run the suite, and expect it to pass
immediately against existing code (confirming research.md's claim) — treat any unexpected
failure as a real bug to fix, never as a reason to weaken the test. For User Story 5: write
**one** failing test, write the minimal code to pass it, then move to the next, per pairing:
T015→T022, T016→T022, T017→T023, T018+T019→T024, T020→T025, T021→T026.

---

## Notes

- [P] marks logical independence (distinct behavior/function), not required concurrent
  execution.
- Tests are mandatory in this plan (not optional), per non-negotiable global TDD instructions.
- Every task specifies exact file paths (`pdf-reader/app.js`, `pdf-reader/reader.test.js`,
  `pdf-reader/pdf-engine.js`, `pdf-reader/vendor/pdfjs-4.10.38/pdf.min.mjs` for verification-only
  reads) — no new files are created anywhere in this feature.
- Commit after each test→verification/implementation pair, not after a whole phase, to keep TDD
  cycles small per Constitution Principle III.
- This feature is deliberately narrow (Epic 1+2 only, per spec.md's Scope note); Epics 3–23 from
  the original 23-epic source document have no tasks here and are not implied by this file's
  completion.

---

## Phase 9: Convergence

- [X] T033 Wired the fake-worker console-warning detection into `extractPdfText`'s actual
      document load (`pdf-reader/app.js`), closing the FR-010 gap. Added
      `loadDocumentWatchingForFakeWorker`, which scopes a `console.warn` interception around the
      real `pdfjsLib.getDocument(...).promise` call without owning or altering its
      resolution/rejection — `extractPdfText` then folds `sawFakeWorkerWarning` into
      `capabilities.hasRealWorker` after `assessCapabilities` returns. Discovered while
      implementing that the vendored PDF.js build's fake-worker warning is gated by a private
      static flag on `PDFWorker` and only fires once per page lifetime, so a later, separate
      disposable probe call (the originally-considered alternative) would silently miss it after
      the first real load — confirming the warning must be observed around the actual first load,
      not a proxy call. Added two tests first (TDD): a new failing test asserting a large document
      is gated when `Worker` exists but the real load's `console.warn` fires the fake-worker
      message, and a regression-guard test confirming a corrupt PDF's real rejection still
      propagates untouched even with this new interception in place. Both pass; full suite:
      82/82.
- [X] T034 Reconciled `extractEpubText` with FR-008/FR-009 by narrowing the spec/contract rather
      than adding a Worker-based gate to EPUB: `extractEpubText` is synchronous and
      main-thread-only with no Worker involvement at any stage, so `hasRealWorker` is not a
      meaningful signal for it — gating EPUB on it would incorrectly block EPUBs in a
      Worker-less environment that never needed a worker in the first place. EPUB already has
      its own worker-independent safety caps (`EPUB_MAX_ENTRIES` = 10,000,
      `EPUB_MAX_UNCOMPRESSED_BYTES` = 200MB) that serve FR-008's "fail clearly, don't hang or
      fail silently" guarantee for this format. Updated
      contracts/capability-assessment.md and data-model.md with an explicit scope note
      correcting their earlier, inaccurate implication that EPUB spine length feeds the same
      gate as `pdf.numPages`. Added one new test naming this guarantee explicitly for the
      `EPUB_MAX_ENTRIES` cap (the byte-size cap already had pre-existing coverage from before
      this feature). Full suite: 83/83.
