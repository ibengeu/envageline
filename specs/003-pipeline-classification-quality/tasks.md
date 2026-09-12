---

description: "Task list for Reading Pipeline Classification Quality"
---

# Tasks: Reading Pipeline Classification Quality

**Input**: Design documents from `/specs/003-pipeline-classification-quality/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/classification-functions.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable) and this project's established practice in specs 001 and 002 — every
implementation task is preceded by a failing test written first.

**Scope**: All three user stories from spec.md:
- User Story 1 (P1) — Hearing when a new section starts (FR-001, FR-002, FR-003)
- User Story 2 (P2) — Paragraph breaks land where the document intends them (FR-004–FR-007)
- User Story 3 (P2) — Footnotes/captions/tables don't interrupt narration as prose
  (FR-008–FR-012)
- Cross-cutting: FR-013 (reproducibility), FR-014 (no regression on unaffected documents)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/functions, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to the repository root.

## Path Conventions

Single project, matching plan.md's Structure Decision — no new files: all tasks touch
`pdf-reader/app.js` (implementation) and `pdf-reader/reader.test.js` (tests).

---

## Phase 1: Setup

**Purpose**: Confirm the baseline this feature builds on, before any new code.

- [X] T001 Confirmed: 83/83 passing baseline before any change.
- [X] T002 Confirmed via inspection: `medianBodyFontSize` already computed, unused by
      `classifyBlocks` — the entry point this feature extends.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Extend `analyzeDocumentStats`'s returned profile with the two new document-relative
thresholds every classification story needs. No user story's classification logic can be
implemented until these thresholds exist, since FR-002/FR-008 require comparing against them
rather than any fixed constant.

**⚠️ CRITICAL**: No user story's classification work can begin until this phase is complete.

- [X] T003 [P] Added test: `analyzeDocumentStats` derives a defined `headingFontSizeThreshold`
      between body and heading sizes. Passed after T006.
- [X] T004 [P] Added test: uniform font sizes → `headingFontSizeThreshold` is `undefined`.
- [X] T005 [P] Added test: `footnoteFontSizeThreshold` derived below body size; `undefined` when
      uniform.
- [X] T006 Implemented `relativeFontSizeThreshold(bodyFontSizes, medianBodyFontSize, margin,
      direction)` and wired both new fields into `analyzeDocumentStats`'s return value
      (±1.5pt margin from the median, requiring ≥3 font-sized blocks and an actual contrasting
      size present). Makes T003–T005 pass.

**Checkpoint**: `analyzeDocumentStats` now exposes the two new thresholds every subsequent
classification story depends on.

---

## Phase 3: User Story 1 - Hearing when a new section starts (Priority: P1) 🎯 MVP

**Goal**: Classify blocks whose font size exceeds the document's own heading threshold as
`"heading"`, never inventing a heading when no such threshold exists (FR-001–FR-003).

**Independent Test**: Load a document with clearly-styled headings and confirm heading blocks
are classified distinctly from body paragraphs; load a document with no distinguishable heading
style and confirm no block is force-classified as a heading.

### Tests for User Story 1

- [X] T007 [P] [US1] Added test: block above `headingFontSizeThreshold` → classified `"heading"`.
- [X] T008 [P] [US1] Added test: same block with threshold undefined → stays `"body"` (FR-002).
- [X] T009 [P] [US1] Added test: no local-comparison shortcut — a block larger only than its
      immediate neighbor but not the document-wide threshold stays `"body"`.
- [X] T010 [P] [US1] Added test: `renderNarrationText` includes heading text (heading not in
      `NARRATION_EXCLUDED_TYPES`).

### Implementation for User Story 1

- [X] T011 [US1] Extended `classifyBlocks` to classify `"heading"` when `fontSize >
      stats.headingFontSizeThreshold` (threshold defined). Makes T007–T009 pass.
- [X] T012 [US1] Confirmed T010 passes with no further change — headings were never added to
      `NARRATION_EXCLUDED_TYPES`.
- [X] T013 [US1] Full suite passed: 91/91 at this checkpoint, no regressions.
- [X] **Post-hoc fix found via manual validation (T038)**: a decorative drop-cap first letter
      (e.g. "I" starting a chapter) is extracted by PDF.js as its own oversized-font block,
      distinct from every other body-sized block on the page. The original heading check
      classified it `"heading"`, which then split it out of its own sentence during narration —
      a real, disruptive regression this feature's new heading behavior introduced against a
      pre-existing (out-of-scope) drop-cap/line-reconstruction quirk. Added a regression test
      ("classifyBlocks does not classify a single-character block (a decorative drop cap) as a
      heading") and fixed `classifyBlocks` to require `block.text.trim().length > 1` for heading
      eligibility — no legitimate section heading is a single character. This does NOT fix the
      underlying drop-cap block-reconstruction quirk itself (out of this feature's scope,
      pre-existing, affects any document with decorative drop caps regardless of heading
      detection); it only ensures this feature's new classification doesn't make that
      pre-existing quirk's narration impact worse.

**Checkpoint**: User Story 1 is fully functional and independently testable — heading detection
works end-to-end from classification through narration inclusion.

---

## Phase 4: User Story 2 - Paragraph breaks land where the document intends them (Priority: P2)

**Goal**: Split a reconstructed block into separate paragraph units at genuine indentation or
vertical-spacing signals, never splitting a block with uniform margins/spacing throughout
(FR-004–FR-007).

**Independent Test**: Load a document containing a single reconstructed block that visually
represents multiple paragraphs and confirm the pipeline splits it at those points; confirm a
block with uniform margins/spacing throughout is never split.

### Tests for User Story 2

- [X] T014 [P] [US2] Added test: a line indented beyond the block's own left margin → split at
      that line.
- [X] T015 [P] [US2] Added test: an unusually large vertical gap between lines → split at that
      gap.
- [X] T016 [P] [US2] Added test: uniform margins and spacing throughout → unchanged (FR-006).
- [X] T017 [P] [US2] Added test: uniform hanging indent throughout (not just one line) →
      unchanged (FR-007). Passed immediately once implemented — the fixed-floor threshold
      already distinguished "uniform indent from the start" from "a genuine mid-block departure."
- [X] T018 [P] [US2] Added test: degenerate single-line block never throws, returns unchanged.

### Implementation for User Story 2

- [X] T019 [US2] Implemented `splitParagraphBoundaries(blocks)` with `splitBlockAtParagraphBoundaries`,
      `lineStartsNewParagraph`, and `median` helpers: computes each block's own left margin and
      typical inter-line gap, splits at lines departing from both a fixed floor
      (`PARAGRAPH_INDENT_MARGIN`) and a multiple of the block's own baseline gap
      (`PARAGRAPH_GAP_MULTIPLIER`). Makes T014–T016 pass.
- [X] T020 [US2] Not needed — T017 (uniform hanging indent) passed on the first implementation
      attempt: the fixed floor + ≥3-line requirement already prevented false positives on
      uniform patterns without further tuning.
- [X] T021 [US2] Confirmed T018 passes — `splitBlockAtParagraphBoundaries` guards blocks with
      fewer than 3 lines by returning them unchanged before any geometry comparison.
- [X] T022 [US2] Wired `splitParagraphBoundaries` into `buildPipelineOutput` between
      `reconstructBlocks` and `analyzeDocumentStats`.
- [X] T023 [US2] Full suite passed: 96/96 at this checkpoint, no regressions.

**Checkpoint**: User Story 1 AND User Story 2 both work independently — paragraph boundaries are
now detected without affecting heading classification.

---

## Phase 5: User Story 3 - Footnotes, captions, and tables don't interrupt narration as prose (Priority: P2)

**Goal**: Classify footnote, caption, and table blocks distinctly and exclude them from default
narration, without excluding ordinary body content on weak/single-signal evidence (FR-008–FR-012).

**Independent Test**: Load a document containing a footnote, caption, or table and confirm that
content is excluded from narrated output while ordinary body content nearby is retained.

### Tests for User Story 3

- [X] T024 [P] [US3] Added test: footer-zone + below-threshold font size → `"footnote"`.
- [X] T025 [P] [US3] Added test: same small font, NOT in footer zone → stays `"body"`.
- [X] T026 [P] [US3] Added test: isolated small-font block (large gap on both sides from page
      neighbors) + distinct styling → `"caption"`.
- [X] T027 [P] [US3] Added test: 3+ lines sharing a repeated column-gap pattern (each line
      modeled with left/right cell `items`, per data-model.md) → `"table"`.
- [X] T028 [P] [US3] Added test: only 2 aligned lines (repetition threshold not met) → stays
      `"body"`.
- [X] T029 [P] [US3] Added test: `renderNarrationText` excludes footnote/caption/table text,
      includes body text.

### Implementation for User Story 3

- [X] T030 [US3] Implemented `isFootnoteCandidate(block, stats)`: footer-zone confinement AND
      below-`footnoteFontSizeThreshold` font size. Makes T024 pass without breaking T025.
- [X] T031 [US3] Implemented `isCaptionCandidate(block, blocksOnPage, stats)`: isolation from
      page neighbors (gap on both sides exceeding a multiple of the page's own typical
      inter-block gap) AND font size differing from the document's body/heading profile — the
      documented text-geometry-only proxy for image-adjacency (research.md §4).
- [X] T032 [US3] Implemented `blockLooksLikeTable(block)`: reuses `findStableColumnGap` at
      per-line CELL granularity (each line's own `items`, not the merged line bbox) and requires
      the gap to hold across ≥3 lines (`TABLE_MIN_LINE_COUNT`). Makes T027 pass without breaking
      T028. Note: the first test fixture attempt modeled each table "row" as a single merged
      line, which cannot expose a two-sided column gap at all — corrected to give each row two
      cell-level `items` (left/right), matching how the function actually inspects data.
- [X] T033 [US3] Added `"footnote"`, `"caption"`, `"table"` to `NARRATION_EXCLUDED_TYPES`. Makes
      T029 pass.
- [X] T034 [US3] Full suite passed: 103/103 at this checkpoint, no regressions.
- [X] **Post-hoc fix found via manual validation (T038)**: a bare page number (e.g. "3") with a
      smaller font than body text, sitting in the footer zone, was being classified `"footnote"`
      instead of staying unclassified/`"body"` — because the existing page-number check
      (`hasStablePageNumberProgression`) requires the *same* digit to repeat across 2+ pages,
      which no single page's own unique number ever satisfies on its own. Added a regression test
      ("classifyBlocks does not classify a standalone page number as a footnote...") and fixed
      `isFootnoteCandidate` to also exclude `isStandalonePageNumberText` matches, regardless of
      whether the stricter page-number repetition evidence fired.

**Checkpoint**: All three user stories are independently functional — running
`node --test reader.test.js` proves heading, paragraph-boundary, and footnote/caption/table
behavior end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final verification against the plan's stated constraints (FR-013/FR-014) before
considering this feature done.

- [X] T035 Added test: `buildPipelineOutput` remains deterministic with heading, paragraph-
      boundary, and footnote content all present together (FR-013). Passed immediately —
      confirms the new functions stayed pure/side-effect-free.
- [X] T036 Added test: a plain, uniform-font, single-paragraph, no-footnote/table document
      produces the exact same narration text a hand-computed pre-feature expectation would
      (FR-014/SC-006). Passed — new classification behaviors introduce no evidence on this
      fixture, so nothing changes.
- [X] T037 Full suite: 107/107 passing (final count, after the two post-hoc fixes below).
- [X] T038 Ran quickstart.md's manual validation live via claude-in-chrome against a real book
      ("Never Wrestle with a Pig" — 303 pages), calling the actual pipeline functions from the
      browser console against real PDF.js-extracted pages, not just synthetic fixtures. Findings:
      - Confirmed the two real section headings on the sampled pages ("The Person Who Will
        Change Your Life Is Not in It Now", "Beware the Small Defining Moments") were correctly
        classified `"heading"` with a document-derived threshold (12pt vs. 10.5pt body median).
      - Found and fixed (see T011, T030 post-hoc notes above) two real bugs this synthetic-only
        test suite had not caught: a decorative drop-cap letter being classified `"heading"` and
        disrupting its sentence during narration, and a bare page number being classified
        `"footnote"` in a small (single-page-scoped) sample. Both are now covered by regression
        tests and confirmed fixed against the same real book.
      - Confirmed no ordinary body content was incorrectly excluded from narration in the
        sampled pages (143-144 blocks classified `"body"` out of ~148 total per 9-page sample,
        the rest being the 3 real headings and small artifact blocks).
      - Step 5 (a document with none of these three patterns) is covered by the automated T036
        test; a live-browser equivalent was not separately re-run since the automated fixture
        already gives byte-exact coverage stronger than a visual spot-check would.
- [X] T039 Reviewed against Constitution Principle IV (A08:2025). Verified directly (not just by
      inspection) that `classifyBlocks`, `analyzeDocumentStats`, and `splitParagraphBoundaries`
      never throw on: a block with `fontSize: undefined`, a block with an empty or missing
      `lines` array, and a table-check on lines lacking an `items` array — each degrades to
      "insufficient evidence, leave classification unchanged" rather than throwing. No changes
      needed; existing guard clauses already hold.
- [X] T040 Reviewed against Constitution Principle V (complexity ≤10). All new functions are
      small and independent: `median` (3), `lineStartsNewParagraph` (3),
      `splitBlockAtParagraphBoundaries` (~6), `relativeFontSizeThreshold` (3),
      `isFootnoteCandidate` (4), `isCaptionCandidate` (~8, the highest of the new functions —
      still under budget, no split needed), `blockLooksLikeTable` (~5). No refactor required.
- [X] T041 Success-criteria mapping confirmed:
      - SC-001/SC-002 (heading detection / no false headings) → T007-T009 (automated) + T038
        manual (real headings correctly found; drop-cap false-positive found and fixed).
      - SC-003/SC-004 (paragraph boundaries / no false splits) → T014-T018 (automated).
      - SC-005 (footnote/caption/table excluded) → T024-T029 (automated) + T038 manual (real
        page-number-as-footnote false-positive found and fixed).
      - SC-006 (unaffected documents unchanged) → T036 (automated, byte-exact).
      No remaining gaps found.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup (T001–T002). BLOCKS User Stories 1 and 3, both of
  which classify blocks against the new thresholds T003–T006 introduce. User Story 2 does not
  depend on Phase 2 (paragraph-boundary splitting doesn't use either new threshold) and could
  technically start in parallel with it.
- **User Story 1 (Phase 3)**: Depends on Phase 2 (T006's `headingFontSizeThreshold`).
- **User Story 2 (Phase 4)**: Depends only on Phase 1 — independent of Phase 2 and every other
  story.
- **User Story 3 (Phase 5)**: Depends on Phase 2 (T006's `footnoteFontSizeThreshold`). Also
  touches `classifyBlocks` and `NARRATION_EXCLUDED_TYPES`, the same surfaces User Story 1 touches
  — completing User Story 1 first avoids merge friction even though there is no hard technical
  dependency between the two stories' own evidence rules.
- **Polish (Phase 6)**: Depends on Phases 3–5 all being complete.

### Within Each User Story

- Tests MUST be written and confirmed failing before their corresponding implementation task, per
  the non-negotiable TDD rule.
- Within User Story 1: T011 → T012 → T013 are sequential (same function chain). T007–T010 (tests)
  can be written in parallel with each other first.
- Within User Story 2: T019 → T020 → T021 are sequential (same function, `splitParagraphBoundaries`,
  each extending the previous). T022 (wiring) depends on T019–T021 all being complete. T014–T018
  (tests) can be written in parallel with each other first.
- Within User Story 3: T030, T031, T032 each extend `classifyBlocks` for a different type and can
  proceed in any order relative to each other once T024–T028 exist, but T033 (narration
  exclusion) depends on all three types existing. T024–T029 (tests) can be written in parallel
  with each other first.

### Parallel Opportunities

- T003–T005 (Foundational tests) are marked [P] relative to each other.
- T007–T010 (User Story 1 tests) are marked [P] relative to each other.
- T014–T018 (User Story 2 tests) are marked [P] relative to each other.
- T024–T029 (User Story 3 tests) are marked [P] relative to each other.
- User Story 2 (Phase 4) has no dependency on Phase 2 and could be worked in parallel with the
  Foundational phase and User Story 1/3 by a different contributor.
- User Story 1 and User Story 3 both depend on Phase 2 completing first, but do not depend on
  each other's evidence rules and could proceed in parallel after that (though see the merge-
  friction note above under Phase Dependencies).

---

## Parallel Example: Independent user stories after Setup

```bash
# Once Phase 1 (Setup) is done, User Story 2 can proceed in parallel with Phase 2 —
# it doesn't depend on either new threshold:

# Track A — Phase 2 (Foundational, blocks US1/US3):
Task: "Write failing tests for headingFontSizeThreshold/footnoteFontSizeThreshold (T003-T005)"

# Track B — User Story 2 (paragraph boundaries, independent of Phase 2):
Task: "Write failing tests for splitParagraphBoundaries (T014-T018)"

# Track C (after Phase 2 lands) — User Story 1 (heading detection):
Task: "Write failing tests for heading classification (T007-T010)"

# Track D (after Phase 2 lands, ideally after Track C to avoid classifyBlocks merge
# friction) — User Story 3 (footnote/caption/table):
Task: "Write failing tests for footnote/caption/table classification (T024-T029)"
```

---

## Implementation Strategy

### MVP Scope

User Story 1 (Phase 3, on top of Phases 1–2) is the suggested MVP, matching spec.md's own P1
priority: heading detection is "the single biggest gap identified in current listening quality"
per the spec's own User Story 1 rationale. Because User Story 2 has no dependency on Phase 2, it
is also cheap to deliver alongside User Story 1 without extra sequencing cost, but User Story 3
should follow rather than land first, given the constitution-driven caution around footnote/
caption/table evidence requirements (FR-012) needing the most tuning-and-verification care of
the three.

### Incremental Delivery

1. Complete Setup + Foundational → thresholds ready.
2. Add User Story 1 → test independently → heading detection live (MVP).
3. Add User Story 2 → test independently → paragraph boundaries live.
4. Add User Story 3 → test independently → footnote/caption/table exclusion live.
5. Polish phase confirms FR-013/FR-014 (reproducibility, no regression) across all three
   together, then closes out with the manual quickstart pass and constitution reviews.

### Notes

- Commit after each test→verification/implementation pair, not after a whole phase, to keep TDD
  cycles small per Constitution Principle III.
- Every new threshold and evidence rule is tuned against synthetic test fixtures during
  implementation (research.md's Assumptions) — no exact numeric constant is specified in this
  task list itself, consistent with the spec's own decision not to fix numeric values as
  business requirements.

---

## Phase 7: Convergence

- [X] T042 Updated contracts/classification-functions.md's heading behavioral guarantee to state
      the `block.text.trim().length > 1` requirement and its drop-cap rationale; added a matching
      line to the Test contract section. No code change — the guard already existed in
      `classifyBlocks`; this closes the documentation gap only. Full suite unaffected: 107/107.
- [X] T043 Updated contracts/classification-functions.md's footnote behavioral guarantee to state
      the `isStandalonePageNumberText` exclusion and its rationale (a single-page sample's page
      number never satisfies the stricter repetition-based page-number check); added a matching
      line to the Test contract section. No code change — the guard already existed in
      `isFootnoteCandidate`; this closes the documentation gap only. Full suite unaffected:
      107/107.
