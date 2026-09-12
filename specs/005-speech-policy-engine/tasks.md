---

description: "Task list for Speech Policy Engine"
---

# Tasks: Speech Policy Engine

**Input**: Design documents from `/specs/005-speech-policy-engine/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/speech-policy-functions.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable) and this project's established practice in specs 001-004.

**Scope**: All three user stories from spec.md:
- User Story 1 (P1) — Nothing changes for a listener today (FR-001, FR-002, FR-008, FR-010)
- User Story 2 (P1) — One decision, not two copies of it (FR-005, FR-006, FR-009)
- User Story 3 (P2) — The policy's shape matches future reader settings (FR-003, FR-004, FR-007)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/functions, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- All file paths are relative to the repository root.

## Path Conventions

Single project, matching plan.md's Structure Decision — no new files: all tasks touch
`pdf-reader/app.js` (implementation) and `pdf-reader/reader.test.js` (tests).

---

## Phase 1: Setup

**Purpose**: Confirm the baseline this feature builds on.

- [X] T001 Confirmed: 122/122 passing baseline before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Introduce the policy shape and its single-source-of-truth lookup — every user story
depends on both existing before any consumer can be migrated.

**⚠️ CRITICAL**: No user story's migration work can begin until this phase is complete.

- [X] T002 [P] Added failing test: `DEFAULT_SPEECH_POLICY` exposes all ten fields from
      data-model.md with their documented default values.
- [X] T003 [P] Added failing test: for every block type the pipeline currently produces,
      `shouldSpeak(type, DEFAULT_SPEECH_POLICY)` equals the old `NARRATION_EXCLUDED_TYPES`-based
      result (data-model.md's equivalence table, US1 AS1/AS2, FR-001/FR-002).
- [X] T004 [P] Added failing test: `resolveSpeechPolicy()`/`resolveSpeechPolicy({})` both equal
      `DEFAULT_SPEECH_POLICY`.
- [X] T005 [P] Added failing test: `resolveSpeechPolicy({ speakFootnotes: true })` changes only
      that field (FR-006, SC-004).
- [X] T006 Implemented `DEFAULT_SPEECH_POLICY` (const) and `shouldSpeak(type, policy)` per
      contracts/speech-policy-functions.md and research.md Decision 1/2.
- [X] T007 Implemented `resolveSpeechPolicy(overrides)` (shallow merge over
      `DEFAULT_SPEECH_POLICY`, research.md Decision 3). T002–T005 all pass.
- [X] T008 Exported `DEFAULT_SPEECH_POLICY`, `resolveSpeechPolicy`, `shouldSpeak`.

**Process deviation, documented**: After T006–T008 alone, running the full suite gave 46
failures (`ReferenceError: NARRATION_EXCLUDED_TYPES is not defined`) — my T006 implementation had
fully replaced the constant's declaration rather than leaving it in place alongside the new
policy, but `toAstBlock`/`renderNarrationText` (not yet migrated) still referenced it. Leaving
Foundational and US1's migration (T011–T014) split across two commits would have meant an
intermediate broken state with no working `NARRATION_EXCLUDED_TYPES` and no consumer yet reading
`shouldSpeak`. Rather than reintroduce the now-redundant constant just to re-delete it one phase
later, T011–T014 (the migration) were completed in the same pass as T006–T008 — see Phase 3
below for what those tasks actually did. Foundational's own deliverable (the policy shape,
independently correct per T002–T005) is unaffected by this sequencing change.

**Checkpoint**: The policy shape and its single lookup function exist and are independently
correct. (Both consumers ended up migrated in the same pass — see Phase 3's note.)

---

## Phase 3: User Story 1 - Nothing changes for a listener today (Priority: P1)

**Goal**: Migrate both consumers (`toAstBlock`, `renderNarrationText`) to `shouldSpeak` with the
default policy, and confirm zero behavior change for any document the existing suite covers
(FR-001, FR-002, FR-008, FR-010).

**Independent Test**: Run the full existing suite (including spec 004's own literal-string
regression baseline) and confirm every test passes unmodified.

### Tests for User Story 1

> Write these tests FIRST — they should already pass once Phase 2 + this phase's migration are
> correctly implemented, since FR-001/FR-002/FR-008 constrain the migration to be behavior-
> preserving. A failure here means the migration leaked a behavior change.

- [X] T009 [P] [US1] Added test: calling `buildDocumentAst(blocksByPage)` and
      `renderNarrationText(blocksByPage)` with no `policy` argument reproduces pre-005 speak/
      exclusion behavior, for a document exercising every block type.
- [X] T010 [P] [US1] Added test: calling `buildPipelineOutput(pages, w, h)` with no `policy`
      argument reproduces the pre-005 baseline exactly. Caught a test-fixture bug while writing
      it (same lesson as spec 004's T023): a single-page fixture never lets the header-repetition
      heuristic (specs 001/003, requires recurrence across multiple pages) fire, so "Evangeline
      Research Report" stayed classified as `body` and was correctly spoken — not a policy defect.
      Fixed by using a 2-page fixture so the header is legitimately recognized and excluded.

### Implementation for User Story 1

- [X] T011 [US1] Migrated `toAstBlock` to accept `policy` and compute `speak` via
      `shouldSpeak(block.type, policy)`. Threaded `policy` through `buildDocumentAst` (resolved
      via `resolveSpeechPolicy` when omitted). Completed together with Foundational's T006-T008
      — see Phase 2's documented process deviation for why.
- [X] T012 [US1] Migrated `renderNarrationText` to accept `policy` and filter via
      `shouldSpeak(block.type, policy)`. Same timing as T011.
- [X] T013 [US1] Threaded an optional `policy` parameter through `buildPipelineOutput`, resolved
      once via `resolveSpeechPolicy`, passed identically to both `buildDocumentAst` and
      `renderNarrationText`. Same timing as T011.
- [X] T014 [US1] Verified via `grep -n "NARRATION_EXCLUDED_TYPES" app.js`: zero code references
      remain (only two explanatory comments mentioning the old name for context) — the constant
      itself was already fully removed. Same timing as T011.

**Checkpoint**: `node --test reader.test.js`: 128/128 passing (122 pre-existing, unmodified +
6 new from Phases 2-3). This is the acceptance gate for User Story 1.

---

## Phase 4: User Story 2 - One decision, not two copies of it (Priority: P1)

**Goal**: Prove that a policy override changes both consumers' output consistently — the actual
defect this spec exists to close (FR-005, FR-006, FR-009).

**Independent Test**: Override one field and confirm both narration text and the per-block
`speak` flag reflect the change consistently, for both a boolean field and the `tables` field.

### Tests for User Story 2

> Write these tests FIRST, ensure they FAIL before implementation (they exercise the migrated
> consumers with non-default policies, which Phase 3 alone does not yet prove correct).

- [X] T015 [P] [US2] Added test: `{ speakFootnotes: true }` includes a footnote's text in
      `narrationText` AND sets its `speak` flag `true` (US2 AS1). Passed immediately.
- [X] T016 [P] [US2] Added test: `{ speakHeadings: false }` excludes a heading's text from
      `narrationText` AND sets its `speak` flag `false` (US2 AS2). Passed immediately.
- [X] T017 [P] [US2] Added test: `{ tables: "detailed" }` includes a table's text in
      `narrationText` AND sets its `speak` flag `true` (SC-003, non-boolean field). Passed
      immediately.
- [X] T018 [P] [US2] Added test: processing with no `policy` argument reproduces
      `NARRATION_EXCLUDED_TYPES`'s old per-block behavior for both a spoken and an excluded type
      together (US2 AS3). Passed immediately.

### Implementation for User Story 2

- [X] T019 [US2] No wiring gap found — T015–T018 all passed directly from Phase 2/3's
      implementation, confirming both consumers genuinely share one `shouldSpeak`/`policy` path
      with no drift. 132/132 passing.

**Checkpoint**: A single policy field change provably propagates to both outputs consistently.
User Story 2 is complete.

---

## Phase 5: User Story 3 - The policy's shape matches future reader settings (Priority: P2)

**Goal**: Confirm the policy's field names and value shapes match the product's documented speech
policy concept, so future reader-settings work has no reason to invent a different shape
(FR-003, FR-004, FR-007).

**Independent Test**: Inspect `DEFAULT_SPEECH_POLICY` and confirm the required field set and
value shapes.

### Tests for User Story 3

- [X] T020 [P] [US3] Added test: `DEFAULT_SPEECH_POLICY` exposes a boolean field for each of the
      seven simple types (US3 AS1). Passed immediately.
- [X] T021 [P] [US3] Added test: `tables` is one of the three named modes, and non-default modes
      are accepted without error (US3 AS2). Passed immediately.
- [X] T022 [P] [US3] Added test: `speakCitations`/`speakReferences` overrides are accepted
      without error and leave `shouldSpeak`'s result unchanged for every current block type
      (spec.md Edge Cases, FR-007). Passed immediately.

### Implementation for User Story 3

- [X] T023 [US3] No mismatch found — T020–T022 all passed directly from Phase 2's
      `DEFAULT_SPEECH_POLICY`/`resolveSpeechPolicy`, confirming the shape matches data-model.md
      exactly. 135/135 passing.

**Checkpoint**: The policy's public shape is confirmed complete and forward-compatible. All three
user stories are complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against the spec's success criteria as a whole.

- [X] T024 [P] Added a combined test: default policy reproduces the pre-005 baseline (US1), then
      overriding `speakFootnotes` and `tables` together includes both while leaving the untouched
      `caption` field's result unaffected (US2/US3, no cross-field interference). 136/136 green.
- [X] T025 Reviewed against Principle V (≤10 cyclomatic complexity): `resolveSpeechPolicy` (one
      object spread, complexity 1), `shouldSpeak` (one switch, 7 cases + default ≈ complexity 8).
      Both within the limit; `shouldSpeak` is the highest in this feature but still comfortably
      under 10 with no documented exception needed.
- [X] T026 Searched `pdf-reader/app.js` for `NARRATION_EXCLUDED_TYPES`: zero code references
      remain, only two explanatory comments documenting the prior name for context (research.md
      Decision 4 fully applied).
- [X] T027 Ran `quickstart.md`'s automated validation section (`node --test reader.test.js`) —
      all listed expectations hold: 122 pre-existing tests unmodified and passing, plus 14 new
      tests across Phases 2-6, 136/136 total.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories (the policy shape and
  `shouldSpeak` must exist before either consumer can be migrated or tested against overrides).
- **User Story 1 (Phase 3, P1)**: Depends on Foundational. Performs the actual migration of both
  consumers — US2 and US3's tests exercise this migrated code, so US1 is sequenced first despite
  sharing P1 priority with US2.
- **User Story 2 (Phase 4, P1)**: Depends on US1's migration being complete (its tests exercise
  `buildPipelineOutput` with non-default policies, which requires the Phase 3 wiring to exist).
- **User Story 3 (Phase 5, P2)**: Depends on Foundational only (inspects `DEFAULT_SPEECH_POLICY`/
  `resolveSpeechPolicy` directly) — could run in parallel with US1/US2 in principle, but
  sequenced last here since it is lowest priority and its tests are expected to pass "for free"
  from Phase 2.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written and confirmed failing (or failing-until-verified) before implementation.
- Implementation tasks follow their tests directly, one behavior at a time.

### Parallel Opportunities

- T002–T005 (Foundational tests) can all be written in parallel.
- T009, T010 (US1 regression tests) can run in parallel.
- T015–T018 (US2 tests) can all be written in parallel.
- T020–T022 (US3 tests) can all be written in parallel.
- T024 depends on T011–T013 and T019 all being complete (exercises the fully-migrated pipeline
  with multiple overrides) and so is not parallelizable with them.

---

## Parallel Example: Foundational Phase

```bash
# Launch all Foundational tests together (all assert against not-yet-implemented functions):
Task: "Add failing test: DEFAULT_SPEECH_POLICY exposes all ten documented fields/defaults"
Task: "Add failing test: shouldSpeak matches NARRATION_EXCLUDED_TYPES for every block type"
Task: "Add failing test: resolveSpeechPolicy()/({}) equal DEFAULT_SPEECH_POLICY"
Task: "Add failing test: resolveSpeechPolicy partial override changes only that field"
```

---

## Implementation Strategy

### MVP First (Foundational + User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (policy shape + `shouldSpeak`) — CRITICAL, blocks all stories.
3. Complete Phase 3: User Story 1 — both consumers migrated, `NARRATION_EXCLUDED_TYPES` deleted,
   zero behavior change proven. This alone closes the immediate maintenance risk (two hardcoded
   copies) even before any override is ever exercised.
4. **STOP and VALIDATE**: run `node --test reader.test.js`.

### Incremental Delivery

1. Setup + Foundational → policy shape and lookup function exist.
2. Add User Story 1 → both consumers migrated, proven behavior-identical → validate
   independently.
3. Add User Story 2 → proven that overrides propagate consistently → validate independently.
4. Add User Story 3 → proven the shape matches future settings needs → validate independently.
5. Polish phase → cross-cutting success-criteria confirmation, dead-code check.

Each story adds value without breaking the previous one, per FR-001/FR-002/FR-008's
non-regression constraint holding throughout.
