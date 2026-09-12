---

description: "Task list for Document AST & Block Schema"
---

# Tasks: Document AST & Block Schema

**Input**: Design documents from `/specs/004-document-ast/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/document-ast-functions.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable) and this project's established practice in specs 001-003 — every implementation
task is preceded by a failing test written first.

**Scope**: All three user stories from spec.md:
- User Story 1 (P1) — Listening experience is unchanged after the refactor (FR-005, FR-006,
  FR-010)
- User Story 2 (P1) — Every pipeline block has a complete, typed identity (FR-001–FR-004,
  FR-009, FR-011)
- User Story 3 (P2) — Blocks are organized into a navigable document/section structure
  (FR-007, FR-008)

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

- [X] T001 Confirmed: 107/107 passing baseline before any change.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Introduce block id assignment — the one piece every later story (schema
completeness, section grouping, and the no-behavior-change guarantee) depends on, since ids must
exist before blocks can be grouped into sections or asserted complete.

**⚠️ CRITICAL**: No user story's implementation can begin until this phase is complete.

- [X] T002 Added failing test: `assignBlockIds` returns the same `id` for two calls given
      identical `(page, text, bbox)` input (FR-009).
- [X] T003 [P] Added failing test: `assignBlockIds` returns distinct `id`s for two blocks
      differing only in page, only in text, or only in bbox.
- [X] T004 [P] Added failing test: `assignBlockIds` preserves every other existing field on each
      block unchanged.
- [X] T005 Implemented `assignBlockIds(blocksByPage)` using a synchronous FNV-1a hash of
      page + text + bbox (crypto.subtle is async and would force the whole synchronous
      block-construction pipeline async — ids aren't security-sensitive per Decision 1, so a
      simple sync hash is the right tool). Wired into `buildPipelineOutput` around the
      `pagesOfItems.map(...)` that produces `rawBlocksByPage`, before `analyzeDocumentStats`.
      Fixed one wiring bug during implementation: `assignBlockIds` expects the full
      `blocksByPage` (array of pages), not a single page's flat block array — it must wrap the
      `.map(...)` call, not run inside it. Makes T002–T004 pass; full suite 110/110 green.
- [X] T006 Exported `assignBlockIds` from the `api`/`module.exports` object.

**Checkpoint**: Every block flowing through the pipeline now carries a stable `id`. User stories
can now build on this.

---

## Phase 3: User Story 2 - Every pipeline block has a complete, typed identity (Priority: P1)

**Goal**: Every block in the pipeline's output independently exposes the full `Block` schema
(data-model.md): `id`, `page`, `type`, `text`, `readingOrder`, `speak`, plus `bbox`/
`style.fontSize`/`confidence` wherever the pipeline already computed them (FR-001–FR-004,
FR-011).

**Independent Test**: Process a representative multi-page, multi-column, multi-type document
(headings, body paragraphs, footnotes, page numbers, captions, tables) and confirm every output
block independently satisfies the schema without cross-referencing other blocks or arrays.

### Tests for User Story 2

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T007 [P] [US2] Added failing test: for a document containing one block of each existing
      type, every block in `buildDocumentAst(...)`'s flattened sections exposes defined `id`,
      `page`, `type`, `text`, `readingOrder`, and boolean `speak`.
- [X] T008 [P] [US2] Added failing test: a block with a `confidence` value exposes that same
      value on its `Block` record.
- [X] T009 [P] [US2] Added failing test: a block with computed `bbox`/`fontSize` exposes them
      under `bbox`/`style.fontSize`; a block without them omits the fields entirely (no
      placeholder).
- [X] T010 [P] [US2] Added failing test: `speak` is `false` exactly for the existing
      narration-excluded types and `true` otherwise.
- [X] T011 [P] [US2] Added failing test: `readingOrder` is strictly increasing across a
      multi-page document's flattened block sequence.

### Implementation for User Story 2

- [X] T012 [US2] Implemented `toAstBlock` (per-block schema mapping: carries forward
      id/page/type/text/bbox/confidence, nests fontSize under style.fontSize, derives speak from
      NARRATION_EXCLUDED_TYPES) and `buildDocumentAst` (flattens ordered pages, assigns
      readingOrder by position, wraps blocks in a single section — full multi-section grouping
      deferred to Phase 4/US3 per tasks.md sequencing; this phase's tests only require schema
      completeness, not grouping correctness). Makes T007–T011 pass; full suite 115/115 green.
- [X] T013 [US2] Exported `buildDocumentAst` from the `api`/`module.exports` object.

**Checkpoint**: Every block independently satisfies the full schema. User Story 2 is complete
and independently testable/demonstrable.

---

## Phase 4: User Story 3 - Blocks are organized into a navigable document/section structure (Priority: P2)

**Goal**: A processed document exposes a title and an ordered list of sections, each with a
heading level and its ordered blocks, with every block from the flat reading-order sequence
appearing in exactly one section (FR-007, FR-008).

**Independent Test**: Process a document containing multiple heading-delimited sections and
confirm blocks are grouped under their enclosing section in reading order; process a document
with no headings and confirm a valid single-section structure is still produced.

### Tests for User Story 3

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T014 [P] [US3] Added failing test: a document with two or more heading blocks produces
      sections whose `blocks` contain exactly the blocks between its heading (inclusive) and the
      next heading (exclusive), in order.
- [X] T015 [P] [US3] Added test: a document with no headings produces exactly one section
      containing all blocks (passed incidentally against the Phase 3 single-section stub, as
      anticipated — this behavior was already correct before T018).
- [X] T016 [P] [US3] Added test: concatenating every section's blocks equals the flat
      reading-order sequence exactly (also passed incidentally pre-T018, same reason as T015).
- [X] T017 [P] [US3] Added failing test: `buildPipelineOutput(...)` returns a top-level
      `document` object exposing `title` and `sections`.

### Implementation for User Story 3

- [X] T018 [US3] Implemented `groupBlocksIntoSections` (single linear pass, research.md
      Decision 2): starts a new titled section at each heading block, collects leading
      pre-heading blocks into one untitled implicit section. Makes T014 pass (T015/T016 already
      passed).
- [X] T019 [US3] Wired `buildDocumentAst(orderedBlocksByPage)` into `buildPipelineOutput`'s
      return value as `document`, called after `renderNarrationText` (order between the two
      doesn't matter — both read the same `orderedBlocksByPage`, neither mutates it). Makes T017
      pass; full suite 119/119 green.

**Checkpoint**: Documents are now navigable as a title + ordered sections + ordered blocks tree.
User Story 3 is complete.

---

## Phase 5: User Story 1 - Listening experience is unchanged after the refactor (Priority: P1)

**Goal**: Confirm, with dedicated regression tests, that none of the schema/section work in
Phases 2–4 altered `displayText`, `narrationText`, block classification, or reading order for any
document already covered by specs 001-003 (FR-005, FR-006, FR-010).

**Independent Test**: Run the full existing test suite and confirm all previously-passing tests
still pass unmodified; run a dedicated before/after comparison on `displayText`/`narrationText`.

### Tests for User Story 1

> Write these tests FIRST — they should already pass once Phases 2–4 are correctly implemented,
> since FR-005/FR-006 constrain those phases to be additive-only. A failure here means an earlier
> phase leaked a behavior change and must be fixed there, not worked around here.

- [X] T020 [P] [US1] Added baseline test reusing the header/citation/URL/page-number fixture
      already in the suite (line ~1176): asserts `displayText`/`narrationText` as exact literal
      strings. Verified equal to actual output on first run (no functions in the narration/
      classification path — `classifyBlocks`, `resolveReadingOrder`, `renderNarrationText`,
      `stripCitationsAndUrls` — were touched by any edit this session; confirmed by re-checking
      each against the verbatim bodies read before implementation began). This test is the
      forward-looking regression guard FR-005/FR-006 require.
- [X] T021 [P] [US1] Added test: calling `buildPipelineOutput` twice with the same input yields
      identical block AND section `id` values across both calls (FR-009, SC-003).

### Verification for User Story 1

- [X] T022 [US1] `node --test reader.test.js`: 121/121 passing (107 baseline + 14 new across
      Phases 2–4 and this phase), zero pre-existing tests modified.

**Checkpoint**: The refactor is proven behavior-preserving. All three user stories are complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against the spec's success criteria as a whole.

- [X] T023 [P] Added a combined full-pipeline test exercising all three stories on one two-page,
      two-heading, header/citation/URL/page-number document. Caught a genuine test-fixture bug
      during writing (expected 2 sections, got 3) — the leading recurring header before the first
      heading correctly forms its own untitled implicit section per FR-007/FR-008/Decision 2;
      fixed the test's expectation, not the implementation. 122/122 green.
- [X] T024 Reviewed every new function against Principle V (≤10 cyclomatic complexity):
      `fnv1aHash` (one loop, complexity 2), `assignBlockIds` (one ternary in a nested map,
      ~2), `toAstBlock` (3 independent guard-clause ifs, complexity 4), `groupBlocksIntoSections`
      (one forEach with one compound condition and one ternary, ~4), `buildDocumentAst` (one
      ternary, 2). All well within the limit; no documented exception needed.
- [X] T025 Ran `quickstart.md`'s automated validation section (`node --test reader.test.js`) —
      all listed expectations hold: 107 pre-existing tests unmodified and passing, plus all new
      schema/section/id/regression tests from Phases 2–6, 122/122 total.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories (US2 and US3 both build
  `Block`/`Document` records that require `id` to already exist; US1's regression tests need
  something to run against).
- **User Story 2 (Phase 3, P1)**: Depends on Foundational. No dependency on US3.
- **User Story 3 (Phase 4, P2)**: Depends on Foundational and on US2's per-block schema (a
  section's `blocks` array is composed of the `Block` records US2 defines) — sequenced after
  US2 for that reason, even though both are needed for `buildDocumentAst`'s full contract.
- **User Story 1 (Phase 5, P1)**: Depends on US2 and US3 being implemented, since it verifies
  their combined output caused no regression — this is a verification phase, not new capability,
  so it is sequenced last despite its P1 priority.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Tests are written and confirmed failing before implementation (Principle III).
- Implementation tasks follow their tests directly, one behavior at a time — do not batch
  multiple failing tests before making the current one pass (constitution Development Workflow).

### Parallel Opportunities

- T003, T004 can run in parallel with each other (different assertions, same new function, no
  shared mutable state) once T002 establishes the test file pattern.
- All of T007–T011 (US2 tests) can be written in parallel — independent assertions against the
  same not-yet-implemented function.
- All of T014–T017 (US3 tests) can be written in parallel — same reasoning.
- T020, T021 (US1 regression tests) can be written in parallel.
- T023 depends on T012, T018, and T019 all being complete (it exercises all three stories
  together) and so is not parallelizable with them.

---

## Parallel Example: User Story 2

```bash
# Launch all US2 tests together (all assert against the not-yet-implemented buildDocumentAst):
Task: "Add failing test: every block exposes id/page/type/text/readingOrder/speak"
Task: "Add failing test: confidence is preserved where already computed"
Task: "Add failing test: bbox/style.fontSize preserved, omitted when absent"
Task: "Add failing test: speak matches existing NARRATION_EXCLUDED_TYPES exclusion"
Task: "Add failing test: readingOrder is strictly increasing"
```

---

## Implementation Strategy

### MVP First (User Story 2 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (block ids) — CRITICAL, blocks all stories.
3. Complete Phase 3: User Story 2 — every block is now schema-complete. This alone already
   unblocks spec 005 (Speech Policy Engine) and spec 006 (Text Normalization Engine), per
   research.md Decision 2's note that section grouping isn't strictly required by either.
4. **STOP and VALIDATE**: run `node --test reader.test.js`.

### Incremental Delivery

1. Setup + Foundational → block ids exist.
2. Add User Story 2 → every block is schema-complete → validate independently.
3. Add User Story 3 → documents are section-navigable → validate independently.
4. Add User Story 1 → prove zero regression across the whole suite → validate independently.
5. Polish phase → cross-cutting success-criteria confirmation.

Each story adds value without breaking the previous one, per FR-005/FR-006's non-regression
constraint holding throughout.
