---

description: "Task list for sentence highlight alignment"
---

# Tasks: Sentence Highlight Alignment

**Input**: Design documents from `specs/014-sentence-highlight-alignment/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`

**Test policy**: Use behavior-focused TDD. Write one failing test before each implementation change. Test public geometry and reader outcomes, not private state or call order.

## Phase 1: Setup

**Purpose**: Confirm the current geometry contract and test entry points.

- [x] T001 [P] Review the current paragraph-wide bounds assignment in `reader-app/src/reader/narration/compiler.ts`, overlay rendering in `reader-app/src/components/reader/pdf-viewer.tsx`, and PDF extraction in `reader-app/src/reader/pdf/text-extractor.ts`.
- [x] T002 [P] Review the existing compiler and PDF rendering tests in `reader-app/src/reader/narration/compiler.test.ts`, `reader-app/src/reader/pdf/pdf-engine.ts`, and `reader-app/src/reader/core/types.ts`.
- [x] T003 [P] Add the new geometry, extractor, and page-navigation tests to `reader-app/package.json`.

## Phase 2: Foundational Contracts

**Purpose**: Establish the pure geometry boundary before integration changes.

- [x] T004 Create the sentence-to-source-line and normalized-rectangle contract in `reader-app/src/reader/narration/highlight-geometry.ts`.
- [x] T005 Create the PDF viewport rectangle conversion contract in `reader-app/src/reader/pdf/text-extractor.ts` without changing current callers yet.

**Checkpoint**: The public geometry contracts are defined. No playback, storage, or network behavior changes.

## Phase 3: User Story 1 - Highlight the Spoken Sentence (Priority: P1)

**Goal**: Highlight only the source lines that belong to the active sentence.

**Independent Test**: A compiler test with two sentences in one paragraph proves that each segment receives separate bounds and a multi-line sentence receives all relevant line bounds.

### Tests for User Story 1

- [x] T006 [P] [US1] Write a failing behavior test for sentence-to-line mapping with two sentences on separate lines in `reader-app/src/reader/narration/highlight-geometry.test.ts`.
- [x] T007 [P] [US1] Write a failing behavior test for a sentence spanning multiple lines and removed citation tokens in `reader-app/src/reader/narration/highlight-geometry.test.ts`.
- [x] T008 [P] [US1] Write a failing compiler integration test for sentence-specific `NarrationSegment.bounds` in `reader-app/src/reader/narration/compiler.test.ts`.

### Implementation for User Story 1

- [x] T009 [US1] Implement ordered token matching, source-line selection, and safe rectangle filtering in `reader-app/src/reader/narration/highlight-geometry.ts`.
- [x] T010 [US1] Preserve source line text and line geometry in paragraph groups in `reader-app/src/reader/narration/paragraph-builder.ts`.
- [x] T011 [US1] Assign mapped sentence bounds during compilation in `reader-app/src/reader/narration/compiler.ts`.

**Checkpoint**: Sentence transitions no longer use paragraph-wide highlight rectangles.

## Phase 4: User Story 2 - Stay Aligned Across PDF Viewports (Priority: P1)

**Goal**: Keep highlight rectangles aligned with rendered PDF text at scale and rotation.

**Independent Test**: Text extraction tests prove that identity and rotated viewport transforms produce normalized rectangles that match the renderer's top-left coordinate system.

### Tests for User Story 2

- [x] T012 [P] [US2] Create public behavior tests for identity, 90-degree rotation, and scale viewport transforms in `reader-app/src/reader/pdf/text-extractor.test.ts`.
- [x] T013 [P] [US2] Create a failing behavior test for zero, non-finite, and out-of-range geometry in `reader-app/src/reader/narration/highlight-geometry.test.ts`.
- [x] T014 [P] [US2] Create a failing overlay safety test for invalid rectangles in the nearest existing public geometry test boundary, `reader-app/src/reader/narration/highlight-geometry.test.ts`.

### Implementation for User Story 2

- [x] T015 [US2] Transform all text-item rectangle corners through the PDF viewport matrix and normalize the result in `reader-app/src/reader/pdf/text-extractor.ts`.
- [x] T016 [US2] Pass the page viewport transform from PDF page extraction to text-item block extraction in `reader-app/src/reader/pdf/pdf-engine.ts`.
- [x] T017 [US2] Filter invalid highlight rectangles before CSS rendering and keep valid overlays above the canvas in `reader-app/src/components/reader/pdf-viewer.tsx`.
- [x] T018 [US2] Confirm the existing overlay stacking rule is sufficient; no `reader-app/src/styles.css` change is required.

**Checkpoint**: Fit-width, zoomed, and rotated page geometry uses one coordinate system.

## Phase 5: User Story 3 - Preserve Reader Interaction (Priority: P2)

**Goal**: Preserve sentence order, click-to-seek, scrolling, pause, resume, and narration-follow behavior.

**Independent Test**: Existing compiler, controller, and reader tests pass, and a manual sample-PDF walkthrough confirms that only highlight geometry changes.

### Tests for User Story 3

- [x] T019 [P] [US3] Update public compiler regression tests for sentence order, literal hostile text, citations, and unchanged speech text in `reader-app/src/reader/narration/compiler.test.ts`.
- [x] T020 [P] [US3] Run the existing reader interaction behavior tests in `reader-app/src/reader/controller.test.ts` and document the result in `specs/014-sentence-highlight-alignment/quickstart.md`.

### Implementation for User Story 3

- [x] T021 [US3] Preserve click-to-seek coordinates, sidebar page selection, and narration-follow behavior while using sentence-specific bounds in `reader-app/src/components/reader/pdf-viewer.tsx`, `reader-app/src/components/reader/page-navigation.ts`, and `reader-app/src/reader/controller.ts`.
- [x] T022 [US3] Confirm that segment storage and public types remain compatible without a migration in `reader-app/src/reader/storage/database.ts` and `reader-app/src/reader/core/types.ts`.

**Checkpoint**: The alignment fix does not change reading order or controls.

## Phase 6: Polish and Validation

**Purpose**: Validate the complete feature and record known limits.

- [x] T023 [P] Run the focused geometry, compiler, extractor, page-navigation, and controller tests from `specs/014-sentence-highlight-alignment/quickstart.md`.
- [x] T024 [P] Run TypeScript type checking, ESLint, and Prettier on all changed files.
- [x] T025 [P] Run `npm run build:dev` in `reader-app/`.
- [x] T026 Run the full new-app test suite and record unrelated baseline failures without changing unrelated features.
- [ ] T027 Run the manual sample-PDF walkthrough at fit width, zoom, sentence transitions, seek, scroll, pause, resume, and rotation when a suitable PDF is available.
- [x] T028 Confirm that the old `pdf-reader` implementation is unchanged and that no new network request, storage entry, or dependency was added.

## Security Review

### Applicable OWASP Top 10:2025 categories

- **A02:2025 Security Misconfiguration**: Reject invalid geometry before CSS generation and validate page values before DOM selection. Test non-finite, zero-size, out-of-range rectangles, and invalid page values.
- **A04:2025 Insecure Design**: Bound geometry work to source items and avoid unbounded DOM output from malformed PDF data. Test empty and extreme inputs.
- **A07:2025 Injection**: Treat extracted text as literal data during matching and rendering. Test hostile text containing markup characters.

### Not applicable categories

- **A01:2025 Broken Access Control** is not applicable. The feature has no users, roles, ownership, tenants, or protected resources.
- **A03:2025 Software Supply Chain Failures** is not applicable. The feature adds no dependency or package source.
- **A05:2025 Cryptographic Failures** is not applicable. The feature adds no secret, credential, encryption, hash, or sensitive-data storage.
- **A06:2025 Identification and Authentication Failures** is not applicable. The feature has no authentication, sessions, tokens, or credentials.
- **A08:2025 Security Logging and Monitoring Failures** is not applicable. The feature adds no security logging or audit flow.
- **A09:2025 Server-Side Request Forgery** is not applicable. The feature adds no outbound request and does not alter the TTS endpoint path.
- **A10:2025 Vulnerable and Outdated Components** is not applicable to this implementation. The feature adds no component. Existing dependency checks remain part of validation.

### NIST SSDF alignment

- **PO.1**: Trace the fix through the specification, plan, tasks, contracts, and tests.
- **PO.3**: Define untrusted PDF content as the input trust boundary.
- **PW.1**: Use public behavior tests for geometry mapping and safe rendering.
- **PW.2**: Use finite-value validation, clamping, and literal text handling as secure defaults.
- **PW.5**: Add no dependency and preserve existing data and network boundaries.
- **PW.7**: Review changed code for invalid CSS, resource exhaustion, and text injection.
- **RV.1**: Run focused tests, type checking, lint, formatting, build, and manual visual verification.

## Dependencies and execution order

1. Complete Phase 1 before Phase 2.
2. Complete Phase 2 before User Story 1.
3. Complete User Story 1 before User Story 2 because viewport conversion consumes the sentence geometry contract.
4. Complete User Story 2 before User Story 3 regression validation.
5. Complete all stories before Phase 6.
6. Run each test task before its related implementation task and confirm the expected failure.

## Implementation strategy

1. Deliver User Story 1 as the MVP.
2. Validate sentence-level geometry independently.
3. Add viewport transform support and invalid-geometry safety.
4. Run interaction regression tests and the manual visual walkthrough.
5. Run the full validation commands and record unrelated baseline failures.
