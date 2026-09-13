---

description: "Task list for Highlight and Narration Synchronisation"
---

# Tasks: Highlight and Narration Synchronisation

**Input**: Design documents from `/specs/011-highlight-narration-sync/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/highlight-resolution.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable). Kept lean per the recorded feedback on spec 007's test-count growth — one test per
distinct behaviour, no per-example duplication. Six new tests total.

**Scope**: All three user stories from spec.md:

- US1 (P1) — The highlight stays on the paragraph being read (FR-001)
- US2 (P1) — Exactly one passage is highlighted at a time (FR-002, FR-004)
- US3 (P2) — The highlight matches what the voice is saying (FR-003, FR-005, FR-006)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/functions, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to the repository root.

## Path Conventions

Single project, matching plan.md's Structure Decision — no new files. All tasks touch
`pdf-reader/app.js` (implementation) and `pdf-reader/reader.test.js` (tests). The functions
involved are not exported (consistent with specs 001–010), so every new test exercises this feature
through the full app via the existing `loadBrowserApp` helper.

---

## ⚠️ Two traps recorded before implementation

Both were found by measurement during planning, not by reasoning. Neither is caught by any visible
acceptance criterion for US1 or US2.

**Trap 1 — the naive scan highlights the wrong passage.** The rule is "the *first* passage among
those with the greatest start index at or before the active chunk". A naive "last passage at or
before" differs on every measured map shape:

```text
map [0,1,1,1] at chunk 1   correct -> passage 1    naive -> passage 3
map [0,1,1]   at chunk 1   correct -> passage 1    naive -> passage 2
map [0,1,0]   at chunk 0   correct -> passage 0    naive -> passage 2
```

On merged short passages the naive form points three passages ahead of the words being spoken —
a new defect dressed as a fix. T009 exists specifically to catch this.

**Trap 2 — ranges break on the fallback path.** Deriving `[map[i], map[i+1])` is valid on the exact
map (measured monotonic and gap-free) but not on the fallback map, where duplicate passages measured
`[0,1,0]`. That derives `[1, 0)` — an empty range — leaving a passage permanently unhighlightable on
EPUBs containing repeated text (research.md Decision 3). Use the scan, not ranges. T010 guards it.

---

## Phase 1: Setup

**Purpose**: Confirm the baseline this feature builds on.

- [X] T001 Confirm the 223/223 passing baseline by running `node --test reader.test.js` from
      `pdf-reader/`
      → Confirmed: 223/223 baseline.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None required.

No shared infrastructure, no new entity, no new state field. The active passage is a derived value
and stays derived. Proceed directly to Phase 3.

**Checkpoint**: Baseline confirmed — user story implementation can begin.

---

## Phase 3: User Story 1 — The highlight stays on the paragraph being read (Priority: P1) 🎯 MVP

**Goal**: A paragraph narrated across several chunks stays highlighted for all of them.

**Independent Test**: Play a document containing a paragraph long enough to span several chunks and
confirm it remains the highlighted passage while each of its chunks plays.

### Tests for User Story 1 ⚠️

> Write these FIRST and confirm each FAILS for its stated reason before implementing.

- [X] T002 [P] [US1] Add a failing test in `pdf-reader/reader.test.js` asserting that a paragraph
      spanning several chunks is the highlighted passage while a later one of its own chunks is
      playing (FR-001). Build the document with `createPositionedPdf` using a paragraph of ~700
      characters, which was measured end to end to map `[0,1,3]` across 4 chunks (1 dark chunk);
      advance playback to the paragraph's second chunk and assert the same paragraph is still
      active. A ~1400-character paragraph gives a larger margin (`[0,1,6]` over 7 chunks, 4 dark)
      if the smaller fixture proves fiddly. Verify the fixture's actual map before asserting on it
      — these counts are fixture-dependent.
- [X] T003 [P] [US1] Add a failing test in `pdf-reader/reader.test.js` asserting that at every
      chunk of a multi-chunk document, exactly one passage carries the active marker — never zero
      (FR-003). This is the direct expression of "the highlight never goes dark".

### Implementation for User Story 1

- [X] T004 [US1] Verify T002 and T003 fail for their stated reasons before writing implementation,
      and record the observed failures.
      → Confirmed: all six new tests red for their stated reasons — US1 dark (actual []), US1 never-dark (dark at 2,3,4,5), US2 multiplicity (4 !== 1), US2 tie-break (['Two.','Three.','Four.','Five.']), US3 timing, FR-012.
- [X] T005 [US1] Replace the equality test in `buildPassageButton` in `pdf-reader/app.js` (currently
      `chunkIndex === activeIndex`) so a passage is marked active when it is the resolved active
      passage, rather than when its own start index happens to equal the playing chunk. Resolution
      is computed once per render by the caller and passed in, not recomputed per passage.
- [X] T006 [US1] Add the resolution helper in `pdf-reader/app.js` implementing data-model.md's rule:
      the first passage among those with the greatest start index at or below the active chunk.
      **Not a range derivation — see Trap 2.** Returns a single passage index, or -1 when there is
      no active chunk.
- [X] T007 [US1] Update `renderLiteralTextWithLineNumbers` in `pdf-reader/app.js` to resolve the
      active passage index once and pass it to `buildPassageButton`, replacing the current
      `className`-string comparison used to capture the active block for scrolling.

**Checkpoint**: The highlight stays on a paragraph for its whole reading and never goes dark.

---

## Phase 4: User Story 2 — Exactly one passage is highlighted at a time (Priority: P1)

**Goal**: When several short passages share one chunk, exactly one of them — the first — is
highlighted.

**Independent Test**: Play a document of short passages that merge into one chunk and confirm only
one row is marked active.

### Tests for User Story 2 ⚠️

- [X] T008 [P] [US2] Add a failing test in `pdf-reader/reader.test.js` asserting that a document of
      short passages sharing one chunk marks exactly one passage active (FR-002). Five short
      passages were measured to map `[0,1,1,1,1]`, currently marking four simultaneously.
- [X] T009 [P] [US2] Add a failing test in `pdf-reader/reader.test.js` asserting that when passages
      share a chunk, the **first** of them is the active one (FR-004). **This is the Trap 1 test**:
      a naive "last at or before" scan passes T008 while highlighting a passage several rows ahead
      of the words being spoken, and only this test distinguishes them.

### Implementation for User Story 2

- [X] T010 [US2] Confirm T008 and T009 pass once T006's resolution helper is in place; no separate
      implementation is expected, since the single rule covers both stories. Record here whether
      that held. If T009 fails, the helper selected the last tied passage rather than the first —
      fix the helper, not the test.
      → Held: US2 needed no code beyond T006's helper — both US2 tests went green from the resolution rule alone.

**Checkpoint**: Exactly one passage highlighted, and it is the right one.

---

## Phase 5: User Story 3 — The highlight matches what the voice is saying (Priority: P2)

**Goal**: The highlight advances onto a passage when its audio begins, not when its audio is
requested — without ever leaving the pane blank.

**Independent Test**: Hold audio preparation pending and confirm the highlight has not advanced onto
the pending passage, while some passage remains highlighted.

### Tests for User Story 3 ⚠️

- [X] T011 [P] [US3] Add a failing test in `pdf-reader/reader.test.js` using the existing
      `deferred()` helper to hold the synthesis response open, asserting that (a) the highlight has
      not advanced onto the passage whose audio is pending, and (b) a passage is still highlighted
      (FR-003, FR-005). Both halves in one test: they are the two sides of the same tension and
      asserting them separately would allow a fix that trades one for the other.

### Implementation for User Story 3

- [X] T012 [US3] Verify T011 fails for its stated reason before implementing.
      → Confirmed red: the highlight had advanced to 'The second paragraph' while its audio was gated.
- [X] T013 [US3] In `pdf-reader/app.js`, move the highlight advance in `speakLocalChunk` so it
      happens when audio begins playing rather than before synthesis is awaited. **Retain the
      pre-await render** — it keeps the pane populated (FR-003) and is what gives click-to-seek its
      instant feedback (FR-006); deleting it makes a click appear unresponsive for over a second
      (research.md Decision 4).
      → Root cause was onended incrementing chunkIndex BEFORE speakLocalChunk's pre-await render. Fixed by rendering the previously-played chunk pre-await and the current chunk after play().
- [X] T014 [US3] Confirm the highlight advance is not wired to `resumeReading`'s own `play()` call
      in `pdf-reader/app.js`. Resuming must not change which passage is highlighted (FR-007).
      → Confirmed: resumeReading's own play() is untouched; the advance lives only in speakLocalChunk.

**Checkpoint**: All three stories functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the guarantees the spec makes about what must *not* change.

- [X] T015 [P] Add a test in `pdf-reader/reader.test.js` asserting that a document on the fallback
      mapping path containing repeated identical passages still highlights exactly one passage and
      leaves no passage unreachable (FR-012, OWASP A08 — plan.md Security Review). **This is the
      Trap 2 test**: the underlying map there was measured `[0,1,0]`, and a range-based
      implementation leaves a passage permanently unhighlightable.
      → NOTE: initially failed on MY test's bug, not the code — the fixture maps [0,1,0] over 2 chunks and the loop ran to 3, past end of playback. Loop bound corrected; assertion unchanged.
- [X] T016 Confirm the existing test "the currently-playing paragraph is highlighted in the literal
      view" passes **unmodified**. It pins presence rather than timing, so it should survive
      untouched; needing to change it would signal this feature altered behaviour beyond its scope
      (Principle III).
      → Confirmed: the existing highlight test passed unmodified (no diff lines).
- [X] T017 Confirm the full suite passes with every pre-existing test unmodified — 223 existing plus
      the new tests (FR-010, SC-006).
      → Confirmed: 229/229, every pre-existing test unmodified.
- [X] T018 Verify spoken output is unchanged: narration text and chunk boundaries byte-for-byte
      identical to before the change (FR-010), and that saved reading positions still refer to the
      same place (FR-011).
      → Confirmed: narration intact — 'four hundred dollars' not '$400', citation stripped, chunk count unchanged. Rendering-only change.
- [X] T019 Confirm the literal-text and injection guarantees still hold unmodified (OWASP A07 —
      plan.md Security Review).
      → Confirmed: 3/3 literal-text and injection tests pass.
- [X] T020 Review every changed function against Principle V (≤10 cyclomatic complexity) and record
      the measured figures.
      → Measured after extracting chunkToHighlightBeforeSynthesis — see report. The ternary had pushed speakLocalChunk to the limit.
- [X] T021 Run the `quickstart.md` validation, including the manual pass against a real PDF with
      long body paragraphs — the defect is visual and worst on exactly that content.
      → Automated validation complete. Manual browser pass left to the user.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Empty.
- **US1 (Phase 3)**: Depends only on Setup. Delivers the resolution helper that US2 also relies on.
- **US2 (Phase 4)**: Its tests are independent, but its implementation is satisfied by US1's helper.
- **US3 (Phase 5)**: Independent of US1 and US2 — it changes *when* the highlight moves, not *which*
  passage resolves. Can be implemented before or after them.
- **Polish (Phase 6)**: Depends on Phases 3–5.

### User Story Dependencies

- **US1 (P1)**: Independently testable and deliverable.
- **US2 (P1)**: Independently testable. Expected to need no code beyond US1's helper — T010 records
  whether that held.
- **US3 (P2)**: Independently testable and deliverable. Unlike spec 010, there is no lockstep
  requirement here: US1/US2 and US3 touch different concerns and can be committed separately.

### Parallel Opportunities

- T002, T003, T008, T009, T011 are all additive test tasks and can be written together.
- T015 can be written alongside them.
- T005, T006, T007 touch the same render path and are sequential.

---

## Implementation Strategy

### MVP (US1 + US2)

1. Phase 1 — confirm the 223/223 baseline.
2. Write T002, T003, T008, T009 — confirm each fails for its stated reason.
3. T006 — add the resolution helper (the first-of-maximum rule, not ranges).
4. T005, T007 — wire it into rendering.
5. Confirm T008/T009 pass (T010), then T015 for the fallback path.
6. **Stop and validate**: the highlight no longer goes dark and no longer marks several rows.

### Then US3

7. T011 — write the held-synthesis test, confirm it fails.
8. T013, T014 — move the advance to audio start, keeping the pre-await render.
9. Phase 6 — verify everything that must not change.

Committing US1+US2 separately from US3 is safe and reasonable here.

---

## Notes

- [P] tasks = no dependency on an incomplete task.
- Every new test asserts observable behaviour through the full app: which rendered passage carries
  the active marker, and how many do. None asserts on the resolution helper directly (Principle III).
- Verify tests fail before implementing, and record when one passes on first run — that is a
  characterization test, not a red-green cycle, and must be described as such.
- The `mapParagraphsToChunks` book-scale timing test runs at ~1250–1350 ms against a 1500 ms budget.
  One unreproducible full-suite failure was seen during this feature's specification phase; treat a
  failure there as unattributed and re-run before investigating (quickstart.md "Regression watch").
