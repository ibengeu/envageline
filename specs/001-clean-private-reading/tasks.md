---

description: "Task list for Smart PDF Reading — Layout-Aware Listening Compiler"
---

# Tasks: Smart PDF Reading — Layout-Aware Listening Compiler

**Input**: Design documents from `/specs/001-clean-private-reading/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/text-cleanup-functions.md, quickstart.md (all present, revised to the layout-aware
scope)

**Supersedes**: an earlier tasks.md existed for this feature directory, written against the
prior flat-text-regex plan. It is fully replaced by this file — the underlying plan changed
(positioned extraction and structural analysis instead of string-only cleanup), so no task IDs
or content carry over.

**Scope**: Covers all three user stories in spec.md:
- User Story 1 (P1) — Smoother narration on real-world PDFs (the layout-aware pipeline: line/
  block reconstruction, header/footer/page-number classification, column detection,
  reading-order resolution, dehyphenation, citation/URL suppression).
- User Story 2 (P2) — Understanding that nothing is retained (non-retention messaging in the
  UI). Independent of the pipeline; can proceed in parallel with User Story 1 once Setup is
  done.
- User Story 3 (P3) — Confidence that cleanup doesn't remove or scramble real content
  (reading-pane fidelity to display literal, unmodified, original-order text regardless of
  narration-side cleanup/reordering). Its core guarantee (FR-009) is established structurally in
  Foundational (the display path is never touched by the pipeline) and verified end-to-end once
  User Story 1 exists to compare against.

**Tests**: Included and REQUIRED, not optional — per user global instructions (non-negotiable
TDD: one failing test → minimal code → refactor, behavior-only) and Constitution Principle III.
Every implementation task is preceded by its own failing-test task for the same behavior.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All pipeline tasks operate on `pdf-reader/app.js` and `pdf-reader/reader.test.js` — see Path
  Conventions below for why most are NOT marked [P] despite belonging to the same story.

## Path Conventions

Single-file project for this feature: pipeline implementation lands in `pdf-reader/app.js`,
pipeline tests in `pdf-reader/reader.test.js` (plan.md's Structure Decision — no new files).
User Story 2 (non-retention messaging) is the exception: it touches `pdf-reader/index.html`
and/or `pdf-reader/styles.css` instead, which is why it can run in parallel with the
`app.js`-only pipeline work in User Story 1.

---

## Phase 1: Setup

**Purpose**: Confirm the environment this feature builds on is ready. No new dependencies or
scaffolding are introduced (plan.md — zero new dependencies; PDF.js 4.10.38 already returns the
position/font metadata this feature reads, it's just not read today).

- [X] T001 Run `cd pdf-reader && node --test reader.test.js` to confirm the existing test suite
      passes before any change, establishing a clean baseline.
- [X] T002 In `pdf-reader/app.js`, inspect the object returned by the existing
      `page.getTextContent()` call inside `extractPdfText` (around `app.js:788-805`) — confirm
      `item.transform`, `item.width`, `item.height`, and font-related fields are present on a
      real extracted PDF (add a temporary `console.log` during this check only; remove it
      before committing) so the exact field shapes used in T004+ are verified against this
      project's actual PDF.js version rather than assumed from research.md alone.

**Checkpoint**: Baseline green, and the real shape of PDF.js's per-item metadata is confirmed
before any pipeline code depends on it.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the pipeline stages that have no independent user-visible acceptance
criteria on their own but that every later stage (classification, column detection,
reading-order resolution, narration rendering — all of User Story 1) depends on: positioned
extraction, line reconstruction, block reconstruction, and document-wide statistics
(contracts/text-cleanup-functions.md; research.md §1–§4). Also establishes the
display/narration seam User Story 3's core guarantee depends on.

**⚠️ CRITICAL**: No User Story 1 classification/ordering task can be implemented until this
phase is complete — each depends on the block/stats shapes built here.

- [X] T003 Write a failing test in `pdf-reader/reader.test.js` asserting `extractPositionedItems`
      (given a fake PDF.js `getTextContent()`-shaped input) returns plain objects with `text`,
      `page`, and a normalized 0–1 `bbox`, and that it performs no filtering — every input item
      appears in the output (research.md §1, data-model.md "Positioned Text Item").
- [X] T004 In `pdf-reader/app.js`, implement `extractPositionedItems(items, page, pageWidth,
      pageHeight)` to make T003 pass: normalize each item's `transform`/`width`/`height` into a
      0–1 `NormalizedBBox`, carry through `fontName`/approximate `fontSize` where available, and
      add it to the `api` export object (`app.js:141-147`).
- [X] T005 Write a failing test in `pdf-reader/reader.test.js` asserting `reconstructLines`
      groups Positioned Text Items whose vertical centers are within `0.35 * medianLineHeight`
      of each other into one `PageLine`, ordered left-to-right (research.md §2).
- [X] T006 Write a failing test in `pdf-reader/reader.test.js` asserting `reconstructLines`
      keeps items in separate lines when their vertical centers differ by more than the
      threshold, and computes the per-page median line height from that page's own items (not a
      shared/global constant).
- [X] T007 In `pdf-reader/app.js`, implement `reconstructLines(items)` to make T005 and T006
      pass, and add it to the `api` export object.
- [X] T008 Write a failing test in `pdf-reader/reader.test.js` asserting `reconstructBlocks`
      groups consecutive `PageLine`s with aligned left edges, consistent font, and consistent
      spacing into one `PageBlock` (research.md §3, data-model.md "Page Block").
- [X] T009 Write a failing test in `pdf-reader/reader.test.js` asserting `reconstructBlocks`
      starts a new block when a font-size jump or a left-edge/spacing break occurs between two
      lines.
- [X] T010 In `pdf-reader/app.js`, implement `reconstructBlocks(lines)` to make T008 and T009
      pass (`type` initially `"unknown"`/`"body"`, classification deferred to Phase 3), and add
      it to the `api` export object.
- [X] T011 Write a failing test in `pdf-reader/reader.test.js` asserting `analyzeDocumentStats`,
      given multiple pages' blocks, correctly identifies a candidate header/footer pattern that
      repeats across pages at a stable horizontal region, and does NOT flag a line that occurs
      on only one page (research.md §4–§5, data-model.md "Document Statistics").
- [X] T012 In `pdf-reader/app.js`, implement `analyzeDocumentStats(blocksByPage)` to make T011
      pass — compute `pageCount`, `medianBodyFontSize`, `headerCandidates`,
      `footerCandidates` (each normalized per research.md §5: lowercase, whitespace-collapsed,
      digit-runs replaced with a placeholder) — and add it to the `api` export object.
- [X] T013 Write a failing test in `pdf-reader/reader.test.js` asserting that `extractPdfText`
      (around `app.js:788-805`) now produces two distinct values from one extraction: the
      existing literal, original-order display text (unchanged from today), and a
      pipeline-derived value (at this point in the pipeline, still equivalent to display text,
      since classification/ordering/narration-rendering don't exist yet) — establishing the
      seam User Story 3 depends on before any removal/reordering logic exists (FR-009,
      research.md §10). Implemented as a new pure `buildPipelineOutput(pagesOfItems, pageWidth,
      pageHeight)` function tested directly, rather than reaching through the full PDF.js fake
      harness, per Constitution Principle III (test the function's behavior, not the loader).
- [X] T014 In `pdf-reader/app.js`, wire `extractPdfText` to call `extractPositionedItems` →
      `reconstructLines` → `reconstructBlocks` per page, then `analyzeDocumentStats` across all
      pages' blocks, and return both the unchanged display text and a placeholder narration
      value (identical to display text for now) to make T013 pass. This is the seam every
      Phase 3 task extends — later tasks change what feeds the narration value, never the
      display value. Also fixed `extractPositionedItems` to degrade gracefully (zero-size box)
      instead of throwing when an item lacks `transform`/`width`/`height`, per A08:2025 — this
      was caught by the existing integration test suite's fake PDF.js harness, whose fixtures
      only provide `item.str`.

**Checkpoint**: The pipeline can extract, line-reconstruct, block-reconstruct, and compute
document stats for a real PDF, and the display/narration split exists and is verified
by a test — but nothing is classified, reordered, or removed yet. Every Phase 3 (US1) task
builds on this without touching `extractPdfText`'s call sites again.

---

## Phase 3: User Story 1 - Smoother narration on real-world PDFs (Priority: P1) 🎯 MVP

**Goal**: Narrated speech skips repeated headers/footers, page numbers, inline numeric citation
markers, and bare URLs; merges hyphenated line-wraps within a paragraph; and reads two-column
pages column-by-column — while the reading pane continues to show the literal, unmodified,
original-order extracted text (FR-001–FR-012).

**Independent Test**: Load a multi-page PDF containing a repeated header/footer, page numbers,
a `[12]`-style citation marker, a bare URL, a hyphenated line wrap, and (separately) a
two-column paper. Confirm none of the noise is spoken, all real content is spoken in correct
order (column-by-column on the two-column fixture), and the reading pane still shows every
original character in original order (quickstart.md manual validation steps 2–3).

### Tests for User Story 1 (write first, confirm failing before implementing)

- [X] T015 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `classifyBlocks` marks a block `"header"` (or `"footer"`) only when its text, normalized
      per research.md §5, repeats at a stable horizontal region on ≥60% of eligible pages —
      and leaves a single-occurrence line classified `"body"` (contracts.md, research.md §5).
- [X] T016 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `classifyBlocks` marks a standalone digit-only (or Roman-numeral) first/last-line block
      `"page-number"` only when it sits in the header/footer zone AND shows stable
      sequential/formatted progression across pages — and leaves a number embedded in a
      sentence (e.g. "In 2024,") classified `"body"` (research.md §6, the spec's page-number
      edge case).
- [X] T017 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `detectColumns` assigns `column: 0`/`column: 1` to blocks on either side of a stable,
      page-height-spanning horizontal gap, and assigns `column: undefined` to a full-width
      block (e.g. a title) spanning the gap (research.md §7, the spec's column-ambiguity edge
      case).
- [X] T018 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `detectColumns` assigns `column: undefined` to every block on a page with no stable gap
      (single-column or unknown-layout fallback per FR-008).
- [X] T019 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `resolveReadingOrder` reorders a two-column page's blocks so every column-0 block
      precedes every column-1 block, with full-width blocks interleaved by vertical position
      (research.md §8, spec acceptance scenario 5). A second test locking in the specific
      mid-page full-width interleaving behavior was added after a real bug was found during
      implementation (see T029 notes).
- [X] T020 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `resolveReadingOrder` leaves a single-column (or fallback) page's block order unchanged
      from its input order (FR-008, FR-010).
- [X] T021 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `renderNarrationText` excludes text from blocks classified `"header"`, `"footer"`, or
      `"page-number"` from its output, while including all `"body"` block text (research.md §5,
      §6; FR-003, FR-004).
- [X] T022 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `renderNarrationText` removes numeric citation markers (`[12]`, `[3, 7]`) and bare
      `http(s)://` URLs from its output while leaving surrounding sentence text intact, and does
      NOT remove non-numeric bracketed text such as `[sic]` (research.md §9; FR-005, FR-006,
      FR-012).
- [X] T023 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `renderNarrationText` merges a hyphenated line-wrap ("under-" / "standing") into one word
      when both lines belong to the same block, and does NOT merge when the hyphen and its
      continuation fall in two different blocks (research.md §9, the spec's dehyphenation edge
      case; FR-002).
- [X] T024 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting that after the
      full pipeline runs, the display text returned by `extractPdfText` still contains the
      original header/footer, page-number, citation-marker, and URL text, in original order,
      completely unaffected by classification/reordering/narration-rendering (the core FR-009
      guarantee, now covering reordering as well as removal). Implemented against
      `buildPipelineOutput` directly (plain PDF.js-shaped item fixtures), consistent with T013.
- [X] T025 [P] [US1] Write a failing test in `pdf-reader/reader.test.js` asserting
      `buildPipelineOutput` (covering `classifyBlocks`, `detectColumns`, `resolveReadingOrder`,
      and `renderNarrationText` together) is deterministic — calling it twice with the same
      input produces identical output (FR-011).

### Implementation for User Story 1 (one behavior at a time, minimal code to pass each test)

- [X] T026 [US1] In `pdf-reader/app.js`, implement `classifyBlocks`'s header/footer detection:
      given `PageBlock[][]` and Document Statistics, promote a block to `"header"`/`"footer"`
      only at the ≥60% stable-region tier from T012's candidates. Makes T015 pass.
- [X] T027 [US1] Extend `classifyBlocks` with page-number detection per the three boolean gates
      in research.md §6 (standalone digit/Roman line, in header/footer zone, stable
      progression). Makes T016 pass without breaking T015.
- [X] T028 [US1] In `pdf-reader/app.js`, implement `detectColumns(blocksByPage)`: find a stable,
      page-height-spanning horizontal gap among non-full-width blocks and assign `column`
      accordingly; leave full-width blocks and no-stable-gap pages as `column: undefined`.
      Makes T017 and T018 pass.
- [X] T029 [US1] In `pdf-reader/app.js`, implement `resolveReadingOrder(blocksByPage,
      columnLayoutByPage)`: for two-column pages, order left-column blocks before right-column
      blocks (full-width blocks interleaved by vertical position); for single-column/unknown
      pages, leave order unchanged. Makes T019 and T020 pass. **Bug found and fixed during
      implementation**: an initial version placed every full-width block before all column
      content regardless of its actual vertical position (a mid-page full-width caption would
      have wrongly jumped to before column-0/column-1 content). Fixed with a segment-based
      approach — a full-width block breaks the page into segments; within each segment the
      left column reads to completion, then the right column, then the next full-width block —
      and locked in with an additional test (see T019 notes).
- [X] T030 [US1] In `pdf-reader/app.js`, implement `renderNarrationText(orderedBlocksByPage)`:
      join `"body"`-classified block text in reading order, excluding
      `"header"`/`"footer"`/`"page-number"` block text entirely. Makes T021 pass.
- [X] T031 [US1] Extend `renderNarrationText` with citation-marker removal and bare-URL removal
      applied to the joined body text. Makes T022 pass. **Bug found and fixed during
      implementation**: the initially planned pattern `\[\d+(?:[,\-\s]\d+)*\]` failed to match
      `[12, 14]` (comma AND space between numbers, not just one separator character); corrected
      to `\[\d+(?:[,\-–]\s*\d+)*\]`.
- [X] T032 [US1] Extend `renderNarrationText` with block-boundary-aware dehyphenation: merge a
      trailing-hyphen line with the next line's text only when both belong to the same
      `PageBlock`. Makes T023 pass.
- [X] T033 [US1] Wire `extractPdfText`/`buildPipelineOutput` (extending T014's seam) to run
      `classifyBlocks` → `detectColumns` → `resolveReadingOrder` → `renderNarrationText` and
      expose the result as the narration-text value, while the display-text value continues to
      bypass this entire chain. Full suite confirmed T024 (display unaffected) and T025
      (determinism) pass. Also wired `handleFile`'s `splitIntoSpeechChunks` call to use
      `result.narrationText || result.text` instead of `result.text`, since EPUB extraction
      does not yet produce a separate narration text.
- [X] T034 [US1] Refactor for Constitution Principle V (cyclomatic complexity ≤10 per function)
      in `pdf-reader/app.js`: review `classifyBlocks`, `detectColumns`, and
      `resolveReadingOrder` — the three functions plan.md flags as highest branching risk.
      Reviewed all three: each already sits at 2–5 branch points, well under the budget, because
      each was already decomposed into small named helpers during implementation
      (`isFullWidthBlock`, `findStableColumnGap`, `resolveTwoColumnOrder`,
      `isConfidentHeaderFooterCandidate`, `isStandalonePageNumberText`,
      `hasStablePageNumberProgression`, `findMatchingCandidate`). No further refactor needed; no
      complexity exception required. Full suite (60 tests) passes.

**Checkpoint**: User Story 1 is fully functional and independently testable — running
`node --test reader.test.js` proves it, and quickstart.md's manual steps 2–3 confirm it
end-to-end in-browser, including the two-column reading-order case.

---

## Phase 4: User Story 2 - Understanding that nothing is retained (Priority: P2)

**Goal**: A non-retention assurance is visible before a document is loaded and remains visible
or reachable while reading, per FR-013/FR-014.

**Independent Test**: Open the app cold, confirm the assurance is visible on the pre-load
screen without reading external docs; load a document and confirm it remains visible or
reachable on the reading screen (quickstart.md notes this is independent UI/copy work, not
part of the pipeline).

**Note on parallelism**: This story touches `pdf-reader/index.html`/`pdf-reader/styles.css`
only, not `pdf-reader/app.js`'s pipeline functions, so it can proceed in parallel with Phase 3
once Phase 1 (Setup) is done — it does not depend on Phase 2 (Foundational) or Phase 3.

### Tests for User Story 2

- [X] T035 [P] [US2] Write a failing test in `pdf-reader/reader.test.js` asserting that before
      any file is chosen, a plain-language non-retention statement is present in
      `pdf-reader/index.html`'s markup (FR-013). Implemented as a direct read of `index.html`'s
      source (the `.intro` section), not the fake-DOM app-behavior harness used elsewhere in the
      file — this is a static-content requirement, not an app-behavior one, since app.js does
      not generate this copy.
- [X] T036 [P] [US2] Write a failing test in `pdf-reader/reader.test.js` asserting that the
      `document-controls` region of `index.html` (the persistent panel shown once a document is
      loaded) also contains a non-retention statement, so the assurance remains reachable while
      reading, not only before upload (FR-014).

### Implementation for User Story 2

- [X] T037 [US2] In `pdf-reader/index.html`, add a plain-language non-retention statement
      ("Your document is processed on your device and is never stored or uploaded by
      Evangeline.") inside `.intro`, visible before a file is chosen. Makes T035 pass.
- [X] T038 [US2] In `pdf-reader/index.html`, add a second, shorter persistent reference
      ("Evangeline forgets your document when you're done — nothing is stored or uploaded.")
      inside the `.transport` controls area of `document-controls`, reachable while reading.
      Makes T036 pass. Styled via `pdf-reader/styles.css` (`.privacy-assurance` /
      `.privacy-assurance--inline`) to stay unobtrusive alongside the existing minimal-player
      layout — a small muted-text treatment matching `.lede`/`.drop-copy`'s existing pattern.
      keep it unobtrusive alongside the existing minimal-player layout.

**Checkpoint**: User Stories 1 AND 2 both work independently; loading a document still shows
the assurance, and narration/display behavior from Phase 3 is untouched by this phase's
HTML/CSS-only changes.

---

## Phase 5: User Story 3 - Confidence that cleanup doesn't remove or scramble real content (Priority: P3)

**Goal**: The reading pane's displayed text and order act as verifiable ground truth against
which a skeptical user can confirm narration cleanup/reordering didn't drop or scramble
anything (FR-009 end-to-end; the spec's ambiguous-classification preservation guarantee).

**Independent Test**: Load a PDF, compare the on-screen text against the source PDF's actual
content and order, and confirm every real sentence is present in a sensible order while noise
lines are absent from narration only (quickstart.md).

**Note**: This story's core structural guarantee (display path never consumes pipeline output)
was already established and tested in Phase 2 (T013/T014) and re-verified in Phase 3 (T024).
This phase's tasks add the remaining explicit coverage for the "system favors preservation over
guessing" behavior at the boundary cases the earlier phases' tests don't already cover directly.

### Tests for User Story 3

- [X] T039 [P] [US3] Write a failing test in `pdf-reader/reader.test.js` asserting that when
      `classifyBlocks` encounters a block that fails the header/footer repetition threshold by a
      narrow margin (repeats on ~55% of 11 eligible pages, just under the 60% gate), it remains
      classified `"body"` rather than being promoted — directly exercising the "uncertain →
      preserve" gate from research.md §5 as a boundary case, not just the clear-cut cases T015
      already covers. Passed immediately against the existing T026/T027 implementation — no
      code change needed (see T041).
- [X] T040 [P] [US3] Write a failing test in `pdf-reader/reader.test.js` asserting that when
      `detectColumns` finds a horizontal gap that does not span most of the page's body height
      (an unstable/partial gap between two small "sliver" blocks), it does NOT assign columns —
      reinforcing FR-012's "favor a conservative fallback order over a confident-looking but
      wrong reordering" at a boundary case beyond T018's no-gap-at-all case. Passed immediately
      against the existing T028 implementation — no code change needed (see T042). Verified by
      direct inspection that the coverage-height gate (not the full-width exclusion) is what
      rejects the gap, confirming the test genuinely exercises the intended boundary.

### Implementation for User Story 3

- [X] T041 [US3] Verified `classifyBlocks`'s header/footer gate (T026/T027) already satisfies
      the boundary case in T039 — the ≥60% `HEADER_FOOTER_MIN_REPETITION_RATE` threshold was
      implemented as a strict `>=` comparison from the start, so a 55% candidate is correctly
      rejected. No adjustment needed; both the boundary case and the clear-cut ≥60% case
      (T015/T026) pass together.
- [X] T042 [US3] Verified `detectColumns` (T028) already satisfies the boundary case in T040 —
      the `COLUMN_GAP_MIN_HEIGHT_COVERAGE` (0.5) check in `findStableColumnGap` correctly
      rejects a gap whose flanking blocks only span a small sliver of the body height. No
      adjustment needed; both the boundary case and the clear-cut column-assignment case
      (T017/T028) pass together.

**Checkpoint**: All three user stories are independently functional. The full suite passes, and
quickstart.md's manual validation (including the irregular-layout fallback check) confirms the
preservation principle holds at both clear-cut and boundary cases.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification against the plan's stated constraints before considering this
feature done.

- [X] T043 Run `cd pdf-reader && node --test reader.test.js` one final time to confirm the
      complete suite (65 tests total: pre-existing 37 + all new pipeline/US2/US3/regression
      tests) passes with no regressions.
- [~] T044 Follow quickstart.md's manual validation steps 1–5 in-browser. **Partially
      completed**: verified the static server serves `index.html`/`app.js` correctly (HTTP 200)
      and that `app.js` has no syntax errors (`node --check`). Could NOT complete the actual
      browser-based manual steps (loading real single-column/two-column/clean/irregular-layout
      PDF fixtures and listening to playback) — this shell environment has no browser and no
      sample PDF fixtures available. **This step needs to be completed by the user in an actual
      browser** before considering SC-001, SC-002, SC-003, SC-006, SC-007, SC-008 fully verified
      end-to-end; the automated test suite covers the same behaviors at the unit level but is
      not a substitute for real-PDF, real-browser playback verification.
- [X] T045 Reviewed each new function in `pdf-reader/app.js` against Constitution Principle IV's
      Security Review. **Real bug found and fixed**: `classifyBlocks`'s header/footer/page-number
      edge-zone check only tested whether a block's top/bottom edge touched the header/footer
      zone (`bbox.y0 <= HEADER_ZONE`), not whether the block was confined to it. A stress test
      with 3000 synthetic text items caused `reconstructBlocks` to merge many rows into one tall,
      whole-page block (a realistic outcome for irregular/pathological layouts) that was then
      misclassified as a header, stripping 100% of narration content. Fixed by requiring
      confinement to the zone (`isConfinedToHeaderZone`/`isConfinedToFooterZone`), not just edge
      contact. Locked in with a new regression test. Re-ran the 3000-item stress test after the
      fix: completes in ~10ms with narration length matching display length (no content lost).
      No performance-related defensive cap was needed — every stage stayed linear/log-linear
      even under the stress fixture.
- [X] T046 Confirmed every new exported pipeline function
      (`extractPositionedItems`, `reconstructLines`, `reconstructBlocks`, `analyzeDocumentStats`,
      `buildPipelineOutput`, `classifyBlocks`, `detectColumns`, `resolveReadingOrder`,
      `renderNarrationText`) is present in the `api` object (`app.js:537-552`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001–T002). BLOCKS Phase 3 (User Story 1) and
  the display-path guarantee Phase 5 (User Story 3) relies on — every classification/ordering
  task modifies the seam T014 introduces.
- **User Story 1 (Phase 3)**: Depends on Foundational (Phase 2) completion.
- **User Story 2 (Phase 4)**: Depends only on Setup (Phase 1) — touches different files
  (`index.html`/`styles.css`) than Phases 2–3 and 5, so it may run in parallel with Phase 3.
- **User Story 3 (Phase 5)**: Depends on Foundational (Phase 2) for the display/narration seam,
  and on Phase 3 (User Story 1) for `classifyBlocks`/`detectColumns` to exist before their
  boundary-case behavior can be tested.
- **Polish (Phase 6)**: Depends on Phases 3, 4, and 5 all being complete.

### Within Phase 3 (User Story 1)

- Tests T015–T025 MUST be written and confirmed failing before their corresponding
  implementation task, per the non-negotiable TDD rule.
- T026 → T027 are sequential (same function, `classifyBlocks`).
- T028 is independent of T026/T027 (different function, `detectColumns`) but depends on Phase 2.
- T029 depends on T028 (reading order needs column assignment).
- T030 → T031 → T032 are sequential (same function, `renderNarrationText`, each extending the
  previous).
- T033 (integration wiring) depends on T026–T032 all being complete.
- T034 (refactor) depends on T033 confirming green, per Principle III ("refactor without
  touching the tests").

### Within Phase 5 (User Story 3)

- T039 depends on T026/T027 existing (tests a boundary case of the same function).
- T040 depends on T028 existing (tests a boundary case of the same function).
- T041 depends on T039; T042 depends on T040.

### Parallel Opportunities

- T015–T025 (Phase 3 test-writing) are marked [P]: each asserts a logically distinct behavior
  on a distinct function, though they land in the same test file — treat [P] here as reflecting
  independence of reasoning, not literal simultaneous file writes within one contributor's
  session.
- T026–T034 are NOT parallel — each modifies shared functions in `app.js` in the dependency
  order above.
- Phase 4 (T035–T038, User Story 2) can run fully in parallel with Phase 3 (T015–T034, User
  Story 1) — different files, no shared dependency beyond Setup.
- T039/T040 (Phase 5 tests) are marked [P] relative to each other (different functions).

---

## Parallel Example: Foundational stage tests vs. User Story 2

```bash
# Once Setup (Phase 1) is done, these can proceed in parallel by different contributors:

# Track A — pipeline (Foundational, then User Story 1):
Task: "Write failing test for extractPositionedItems (T003)"
Task: "Write failing test for reconstructLines grouping (T005)"
# ... continues sequentially through Phase 2 and Phase 3 (shared file: app.js)

# Track B — non-retention messaging (User Story 2, independent of Track A):
Task: "Write failing test for pre-load non-retention statement (T035)"
Task: "Write failing test for persistent non-retention statement (T036)"
```

---

## Implementation Strategy

### MVP Scope

User Story 1 (Phase 3, on top of Phases 1–2) is the MVP — it is the feature's core
differentiator per spec.md's "Why this priority" for User Story 1. Complete:

1. Phase 1: Setup (T001–T002)
2. Phase 2: Foundational (T003–T014)
3. Phase 3: User Story 1 (T015–T034)
4. **STOP and VALIDATE**: run quickstart.md steps 1–4 (single-column, two-column, and clean
   fixtures) independently before continuing.

### Incremental Delivery

1. Complete Setup + Foundational → pipeline seam ready, display path verified unaffected.
2. Add User Story 1 → validate independently (MVP!).
3. Add User Story 2 (can have run in parallel with step 2) → validate independently.
4. Add User Story 3's boundary-case coverage → validate independently, including the
   irregular-layout fallback (quickstart.md step 5).
5. Phase 6: Polish — full-suite regression pass and manual validation across all fixtures.

### TDD Cycle Discipline (per user global instructions and Constitution Principle III)

For each function (one at a time): write **one** failing test, write the minimal code to pass
it, then move to the next. Do not write all of T015–T025 to completion before implementing
T026 — execution MUST interleave one test → one implementation step, per pairing:
T003→T004, T005+T006→T007, T008+T009→T010, T011→T012, T013→T014 (Foundational); then
T015→T026, T016→T027, T017+T018→T028, T019+T020→T029, T021→T030, T022→T031, T023→T032,
T024+T025→T033 (User Story 1); T035→T037, T036→T038 (User Story 2); T039→T041, T040→T042
(User Story 3).

---

## Notes

- [P] marks logical independence (distinct function/file), not required concurrent execution.
- Tests are mandatory in this plan (not optional), per non-negotiable global TDD instructions.
- Every task specifies exact file paths (`pdf-reader/app.js`, `pdf-reader/reader.test.js`,
  `pdf-reader/index.html`) — no new files are created anywhere in this feature.
- Commit after each test→implementation pair, not after a whole phase, to keep TDD cycles small
  per Constitution Principle III.
- Stop after each phase's checkpoint to validate that story independently before moving on.
- This tasks.md fully replaces the prior flat-text-plan tasks.md for this feature directory —
  do not attempt to reconcile task IDs between the two; the prior file's T001–T023 no longer
  correspond to any current task.

## Phase 7: Convergence

- [X] T047 Completed real-browser manual validation using Claude in Chrome against two
      real-world PDF fixtures (user-approved, generic/non-personal): "Civil Disobedience" by
      Henry David Thoreau (18-page clean single-column essay) and "Patterns of Enterprise
      Application Architecture" (389-page technical book, 150,047 words). Verified: SC-004/
      SC-005/FR-013/FR-014 (non-retention assurance visible pre-load and while reading);
      SC-003/FR-010 (clean document narrated and displayed unaltered, playback highlighting
      works); extraction and playback succeed with no console errors on a large real-world
      document. SC-001/SC-002 (header/footer/page-number/citation/URL removal) and SC-007
      (dehyphenation) could not be positively demonstrated end-to-end because neither available
      fixture's PDF.js text extraction actually contained that noise (confirmed via independent
      `pdftotext` extraction) — unit test coverage (T004–T032) remains the evidence for those
      rules' correctness. SC-006 (two-column) remains unverified — no two-column fixture was
      available. SC-008 (no page fails narration outright) was not specifically exercised with
      an irregular-layout fixture.

      **Critical bug found and fixed during this validation**: the reading pane was NOT
      showing literal display text as FR-009 requires — `renderPlaybackText` rendered
      `state.chunks` (narration-derived: cleaned, reordered, citations/URLs stripped) via
      `renderChunkedText` whenever chunks existed, which is always true once a document loads.
      This was verified concretely: a real URL (`martinfowler.com`) and a citation-shaped
      marker (`[0]`) present in the source PDF were completely absent from the on-screen
      reading pane. This predates this feature (chunking always drove display) but was
      invisible until narration started meaningfully diverging from raw text. Per user
      decision, fixed with a two-mode reading pane: literal text is now the default view
      (satisfying FR-009), and the existing click-to-jump chunk view is preserved as an
      explicit opt-in toggle (`#passageJumpToggle` in `index.html`, wired in `app.js`'s
      `renderPlaybackText`/`showingPassageJumpView`). Verified via unit tests (2 new tests) and
      re-confirmed in the real browser: `martinfowler.com` and `[0]` are now present in the
      default literal view, and toggling shows the chunk buttons as before. Full suite: 67/67
      passing.
