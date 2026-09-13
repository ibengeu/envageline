---

description: "Task list for Blank Passage Rendering"
---

# Tasks: Blank Passage Rendering

**Input**: Design documents from `/specs/010-blank-passage-rendering/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/blank-passage-rendering.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable). Kept lean per the recorded feedback on spec 007's test-count growth — this is a
small, targeted fix, so each test covers one distinct behavior with no per-example duplication.
Six new tests total.

**Scope**: All three user stories from spec.md, each P1:

- US1 — The reading pane shows only real passages (FR-001, FR-002, FR-003, FR-004)
- US2 — Clicking a passage always starts reading that passage (FR-005)
- US3 — Documents keep their fast, exact passage mapping (FR-006, FR-007)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/functions, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to the repository root.

## Path Conventions

Single project, matching plan.md's Structure Decision — no new files. All tasks touch
`pdf-reader/app.js` (implementation) and `pdf-reader/reader.test.js` (tests). `documentPassages`,
`resolvePassages`, and `renderNarrationBlocks` are not exported (consistent with specs 001–009's
precedent), so all new tests exercise this feature through the full app via the existing
`loadBrowserApp` helper, matching how every existing reading-pane test already works.

---

## ⚠️ Critical sequencing note (read before starting Phase 5)

US1, US2, and US3 are each independently *testable*, but US1 and US3 are **not independently
deliverable**. Filtering blanks out of `documentPassages` (US1) breaks the alignment invariant
that US3 depends on, silently dropping affected documents onto the slow approximate mapping
(research.md Decision 2, data-model.md "Alignment invariant"). The two filter edits — T007 and
T011 — **must land in the same change**. T011 is therefore sequenced immediately after T007 and
is not marked [P].

Committing T007 alone would leave the tree in a state that passes US1 and US2 while regressing
performance and click accuracy invisibly. Do not commit between them.

---

## Phase 1: Setup

**Purpose**: Confirm the baseline this feature builds on.

- [X] T001 Confirm the 219/219 passing baseline before any change by running
      `node --test reader.test.js` from `pdf-reader/`
      → Confirmed: 219/219 passing baseline before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None required.

This feature adds no shared infrastructure, no new entity, no new state field, and no new
exported function. Every change is a predicate applied at an existing list-construction site.
Proceed directly to Phase 3.

**Checkpoint**: Baseline confirmed — user story implementation can begin.

---

## Phase 3: User Story 1 — The reading pane shows only real passages (Priority: P1) 🎯 MVP

**Goal**: A document containing whitespace-only blocks renders no empty passage rows, and its
visible passage numbering runs consecutively.

**Independent Test**: Load a document containing whitespace-only blocks through the full app and
confirm every rendered passage contains visible text.

### Tests for User Story 1 ⚠️

> Write these FIRST and confirm each FAILS for its stated reason before implementing.

- [X] T002 [P] [US1] Add a failing test in `pdf-reader/reader.test.js` asserting that a document
      whose blocks include whitespace-only entries renders only passages containing visible text
      (FR-001, FR-002). Use `createPositionedPdf` with entries such as `"   "` and `" "`
      between real paragraphs; assert on the rendered `literal-paragraph` node text.
- [X] T003 [P] [US1] Add a failing test in `pdf-reader/reader.test.js` asserting that a block
      whose text is a single visible character (for example `"."`) still renders as a passage
      (spec.md Edge Cases). This is the guard against over-filtering and MUST be written
      alongside T002 — without it, a fix that drops all short passages would pass T002.
      → NOTE: passed on first run — a characterization guard against over-filtering, not a red-green cycle.

### Implementation for User Story 1

- [X] T004 [US1] Verify T002 and T003 fail for the stated reasons (T002: a blank passage is
      rendered; T003: passes already, documenting it as a characterization guard rather than a
      red-green cycle if so) before writing any implementation.
      → Confirmed: T002 red ([' ','   '] rendered), T007 red (blank clickable row), T003 and T009 green — recorded honestly.
- [X] T005 [US1] Change the membership predicate in `documentPassages` in `pdf-reader/app.js`
      from `text.length > 0` to a visible-character test (`text.trim().length > 0`), preserving
      each passage's `text` value exactly as the block produced it (FR-003 — the trim decides
      membership, it never transforms the stored value).
- [X] T006 [US1] Apply the same predicate to `resolvePassages`' blank-line fallback in
      `pdf-reader/app.js`, so documents with no reconstructed block structure cannot render blank
      rows either (FR-012).

**Checkpoint**: Blank rows are gone and numbering is consecutive — but the alignment invariant is
now broken. **Do not commit here.** Continue directly to Phase 5 (T011).

---

## Phase 4: User Story 2 — Clicking a passage always starts reading that passage (Priority: P1)

**Goal**: No clickable row corresponds to a whitespace-only block, so a click never jumps
playback to an unrelated part of the document.

**Independent Test**: In a document containing whitespace-only blocks, confirm no rendered
passage lacks visible text while still carrying a playback target.

### Tests for User Story 2 ⚠️

- [X] T007 [P] [US2] Add a failing test in `pdf-reader/reader.test.js` asserting that every
      rendered clickable passage in a document containing whitespace-only blocks has visible text
      (FR-005). Assert over the rendered nodes carrying `data-chunk-index`.

### Implementation for User Story 2

- [X] T008 [US2] No separate implementation required — T005 and T006 remove the blank passages,
      and a passage that is never constructed is never clickable. Confirm T007 passes once T005
      and T006 are in place, and record in this task that US2 required no additional code.
      → Confirmed: US2 required no code of its own; T007 went green from T005/T006 alone.

**Checkpoint**: No blank clickable rows exist. Alignment invariant still broken — continue.

---

## Phase 5: User Story 3 — Documents keep their fast, exact passage mapping (Priority: P1)

**Goal**: A document containing whitespace-only blocks still uses the exact O(1) passage→chunk
mapping, so clicks resolve correctly even between identically-worded passages.

**Independent Test**: In a document containing both whitespace-only blocks and two passages with
identical text, confirm the later identical passage resolves to its own chunk, not the earlier
one — behaviour only the exact mapping produces.

### Tests for User Story 3 ⚠️

- [X] T009 [P] [US3] Add a failing test in `pdf-reader/reader.test.js` asserting that a document
      containing whitespace-only blocks AND two identically-worded passages resolves the later
      identical passage to a strictly greater chunk index than the earlier one (FR-007). **This
      is the single most important test in this feature**: it is the only one that fails when the
      alignment invariant breaks, and every other test passes under the naive fix.
      → NOTE: passed on first run — a pre-condition check; T010 confirmed it flips red under the naive fix.

### Implementation for User Story 3

- [X] T010 [US3] Verify T009 fails after T005/T006 are applied, confirming the naive fix does
      break the invariant rather than assuming it — this is the empirical check that justifies
      the lockstep requirement.
      → CONFIRMED EMPIRICALLY: after T005/T006 alone, US3 failed — both 'Introduction' passages resolved to chunk 0. The lockstep requirement is real, not theoretical.
- [X] T011 [US3] Apply the same visible-character predicate in `renderNarrationBlocks` in
      `pdf-reader/app.js` so the narrated-block list excludes exactly the blocks the passage list
      excludes (FR-006), restoring
      `narratedPassages.length === narrationBlocks.length`. **Must land in the same change as
      T005/T006 — see the critical sequencing note above.** Not marked [P].

**Checkpoint**: All three stories functional, alignment invariant restored, safe to commit.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the guarantees the spec makes about everything this feature must *not* change.

- [X] T012 [P] Add a test in `pdf-reader/reader.test.js` asserting that a document in which every
      block is whitespace-only reports no readable text through the existing path rather than
      rendering an empty clickable pane (FR-011, OWASP A08:2025 — plan.md Security Review).
- [X] T013 [P] Add a test in `pdf-reader/reader.test.js` asserting an EPUB still renders one
      clickable passage per chapter with no blank rows (FR-012). If the existing EPUB fallback
      test already covers this, record that instead of duplicating it.
      → Covered by the existing test 'an EPUB with no structural blocks still renders one clickable passage per chapter' (8/8 EPUB tests pass). No duplicate added.
- [X] T014 Confirm the full suite passes with every pre-existing test unmodified (FR-008, FR-009,
      SC-005) — 219 existing plus the new tests. Any pre-existing test requiring modification is a
      signal this change altered behavior and must be treated as such per Principle III.
      → Confirmed: 223/223 passing, every pre-existing test unmodified.
- [X] T015 Verify spoken output is unchanged: confirm narration text and speech chunk boundaries
      are byte-for-byte identical to before the change for a document with no whitespace-only
      blocks, and that a whitespace block contributes no chunks either way (FR-009, FR-010).
      → Confirmed: narrationBlocks and resulting chunks byte-identical with and without whitespace blocks; a whitespace block yields []. narrationText itself gains a blank separator (renderNarrationText is left unfiltered) but its chunks are identical, so both paths are unchanged.
- [X] T016 Confirm the literal-text rendering guarantees still hold unmodified — the existing
      "renderExtractedText treats PDF content as literal text" and EPUB injection tests must pass
      untouched (OWASP A07:2025 — plan.md Security Review).
      → Confirmed: 3/3 literal-text and injection tests pass unmodified.
- [X] T017 Review every changed function against Principle V (≤10 cyclomatic complexity) and
      record the measured figures. The change is a predicate swap adding no branch, so no
      function's complexity should increase.
      → Measured: hasVisibleText 1, resolvePassages 2, renderNarrationBlocks 2, documentPassages 5 — all well under the limit of 10.
- [X] T018 Run the `quickstart.md` validation, including the optional manual pass against a real
      PDF whose layout produces spacer blocks, since the reported defect was visual.
      → Automated validation complete (223/223). Manual browser pass left to the user.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Empty — nothing blocks the user stories.
- **User Stories (Phases 3–5)**: All depend only on Setup. US2 requires US1's implementation to
  be in place to pass, and US3 must land atomically with US1 (see the critical sequencing note).
- **Polish (Phase 6)**: Depends on Phases 3–5 being complete.

### User Story Dependencies

- **US1 (P1)**: Independently testable. Its implementation (T005, T006) breaks US3 until T011
  lands.
- **US2 (P1)**: Independently testable. Requires no code of its own — satisfied by US1's
  implementation.
- **US3 (P1)**: Independently testable. Its implementation (T011) must be committed together with
  US1's.

### Within Each User Story

- Tests are written and confirmed failing before implementation.
- No models or services exist in this feature — each story is test → predicate change.

### Parallel Opportunities

- T002 and T003 can be written in parallel (both add independent tests).
- T007, T009 can be written in parallel with the Phase 3 tests — all are additive test tasks in
  the same file but touch no shared assertion.
- T012, T013 can be written in parallel.
- **T011 is explicitly NOT parallel** with T005/T006 — it must land in the same change.

---

## Parallel Example: Phase 3 tests

```bash
# Write both User Story 1 tests together, then confirm each fails for its stated reason:
Task: "Blank-passage exclusion test in pdf-reader/reader.test.js"
Task: "Single-visible-character passage still renders, in pdf-reader/reader.test.js"
```

---

## Implementation Strategy

### Recommended: all three stories in one change

Unlike most features in this repository, splitting this one by story is actively unsafe. The
MVP-first pattern (ship US1, validate, then continue) would commit a tree that passes its visible
acceptance criteria while silently regressing the mapping US3 protects. Complete Phases 3–5
together, then commit once.

### Sequence

1. Phase 1 — confirm the 219/219 baseline.
2. Phase 3 tests (T002, T003) — write, confirm failing.
3. Phase 4 test (T007) and Phase 5 test (T009) — write, confirm failing.
4. T005, T006 — implement the passage-side filter.
5. T010 — confirm T009 now fails specifically because the invariant broke.
6. T011 — implement the narration-side filter, restoring the invariant.
7. Phase 6 — verify everything this feature must not change.
8. Commit once, with all three stories and the non-regression evidence.

---

## Notes

- [P] tasks = no dependency on an incomplete task.
- Every new test asserts observable behavior through the full app; none asserts on the predicate,
  on internal state, or on the unexported functions themselves (Principle III).
- Verify tests fail before implementing, and record when one passes on first run — that is a
  characterization test, not a red-green cycle, and should be described as such.
- The `mapParagraphsToChunks` book-scale timing test runs at ~1280–1345 ms against a 1500 ms
  budget and can flake over it under concurrent load (quickstart.md "Regression watch"). Check for
  contention before treating a failure there as caused by this change.
