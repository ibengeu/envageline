---

description: "Task list for adaptive audio read-ahead"
---

# Tasks: Adaptive Audio Read-Ahead

**Input**: Design documents from `specs/013-adaptive-audio-read-ahead/`

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`

**Test policy**: Use behavior-focused TDD. Write one failing test before each implementation change. Test public contracts, not private state or call order.

## Phase 1: Setup

**Purpose**: Confirm the new-app boundaries and test entry points.

- [x] T001 [P] Review the legacy read-ahead behavior and record the preserved constants in `pdf-reader/app.js` and `specs/013-adaptive-audio-read-ahead/research.md`.
- [x] T002 [P] Review the new-app speech and controller contracts in `reader-app/src/reader/speech/kokoro-tts.ts`, `reader-app/src/reader/controller.ts`, and `reader-app/src/reader/core/types.ts`.
- [x] T003 [P] Add the read-ahead test file to the focused test command in `reader-app/package.json`.

## Phase 2: Foundational Contracts

**Purpose**: Establish the public contracts that all user stories use.

- [x] T004 Add the public synthesis-result and prepared-audio contracts in `reader-app/src/reader/speech/kokoro-tts.ts` without changing existing request payload behavior.
- [x] T005 Create the read-ahead scheduler contract and placeholder exports in `reader-app/src/reader/speech/read-ahead.ts`.

**Checkpoint**: The new contracts compile, and no user story changes the old reader.

## Phase 3: User Story 1 - Continuous Narration (Priority: P1)

**Goal**: Prepare upcoming speech while the current passage plays, adapt the look-ahead window to observed synthesis time, reuse in-flight and completed audio, and keep memory bounded.

**Independent test**: A scheduler test proves that the current passage can use prepared audio, upcoming passages are prepared, duplicate requests share one synthesis, the window adapts from timing data, and background failures do not stop current playback.

### Tests for User Story 1

- [x] T006 [P] [US1] Write failing behavior tests for the legacy 1-to-6 adaptive depth formula in `reader-app/src/reader/speech/read-ahead.test.ts`.
- [x] T007 [P] [US1] Write failing behavior tests for request reuse, bounded entries, retry after failure, and background error isolation in `reader-app/src/reader/speech/read-ahead.test.ts`.
- [x] T008 [P] [US1] Write failing behavior tests for synthesis results and prepared-blob playback in `reader-app/src/reader/speech/kokoro-tts.test.ts`.

### Implementation for User Story 1

- [x] T009 [US1] Implement the adaptive depth calculation, dual EWMA timing state, bounded session cache, request reuse, and background failure handling in `reader-app/src/reader/speech/read-ahead.ts`.
- [x] T010 [US1] Implement public synthesis, synthesis timing, prepared-blob playback, and safe audio lifecycle handling in `reader-app/src/reader/speech/kokoro-tts.ts`.
- [x] T011 [US1] Integrate the scheduler with the narration loop so the current passage uses prepared audio and upcoming passages start preparation in `reader-app/src/reader/controller.ts`.

**Checkpoint**: User Story 1 works with the new app. The old reader remains unchanged.

## Phase 4: User Story 2 - Safe Playback Changes (Priority: P1)

**Goal**: Prevent stale prepared audio, canceled work, or setting changes from affecting the active document.

**Independent test**: Cancellation and context-reset tests prove that document close, seek, voice changes, rate changes, and superseded synthesis do not play stale audio or retain stale resources.

### Tests for User Story 2

- [x] T012 [P] [US2] Write a failing behavior test for cancellation of in-flight synthesis and cleanup of prepared audio in `reader-app/src/reader/speech/kokoro-tts.test.ts`.
- [x] T013 [P] [US2] Write failing behavior tests for scheduler reset, stale completion rejection, and setting-specific cache separation in `reader-app/src/reader/speech/read-ahead.test.ts`.
- [x] T014 [P] [US2] Verify the existing controller behavior tests remain green after seek, close, rate, and voice context-reset integration in `reader-app/src/reader/controller.ts` and `reader-app/src/reader/controller.test.ts`.

### Implementation for User Story 2

- [x] T015 [US2] Track active and background abort controllers, cancel external synthesis on stop, and revoke playback resources in `reader-app/src/reader/speech/kokoro-tts.ts`.
- [x] T016 [US2] Reset the scheduler and invalidate stale context on seek, close, voice changes, rate changes, and new document binding in `reader-app/src/reader/controller.ts` and `reader-app/src/reader/speech/read-ahead.ts`.
- [x] T017 [US2] Ensure stale scheduler completions cannot repopulate the active cache after reset in `reader-app/src/reader/speech/read-ahead.ts`.

**Checkpoint**: User Story 2 works without stale playback or resource leaks.

## Phase 5: User Story 3 - Preserved Reading Behavior (Priority: P2)

**Goal**: Preserve sentence boundaries, highlighting, playback controls, voice fallback, and existing loopback safety while adding read-ahead.

**Independent test**: Existing controller and TTS behavior tests pass, and manual playback confirms that highlighting and controls follow the same passage order.

### Tests for User Story 3

- [x] T018 [P] [US3] Verify public behavior tests for sentence order, current-segment preparation, pause, resume, stop, and voice fallback in `reader-app/src/reader/speech/read-ahead.test.ts`, `reader-app/src/reader/controller.test.ts`, and `reader-app/src/reader/speech/kokoro-tts.test.ts`.
- [x] T019 [P] [US3] Verify loopback-endpoint rejection for the normal synthesis path and preserve the same validation before prepared-audio playback in `reader-app/src/reader/speech/kokoro-tts.test.ts` and `reader-app/src/reader/speech/kokoro-tts.ts`.

### Implementation for User Story 3

- [x] T020 [US3] Preserve segment order, highlighting updates, and playback controls while using the prepared-audio path in `reader-app/src/reader/controller.ts`.
- [x] T021 [US3] Preserve loopback validation and safe public errors for all synthesis paths in `reader-app/src/reader/speech/kokoro-tts.ts`.

**Checkpoint**: All user stories pass their focused behavior tests.

## Phase 6: Polish and Validation

**Purpose**: Validate the complete feature and document the operational result.

- [x] T022 [P] Run the focused read-ahead, TTS, and controller tests from `specs/013-adaptive-audio-read-ahead/quickstart.md`.
- [x] T023 [P] Run TypeScript type checking and ESLint for the changed new-app files.
- [x] T024 Run the full new-app test suite and record unrelated baseline failures without changing unrelated features.
- [ ] T025 Run the manual quickstart flow and confirm that shutdown releases playback, aborts pending synthesis, and leaves no feature-owned process or object-URL leak. Not run because this change has no manual-audio environment in the test session.
- [x] T026 Confirm that `specs/013-adaptive-audio-read-ahead/quickstart.md` matches the implemented focused commands.

## Security Review

### Applicable categories

- **A02:2025 Security Misconfiguration**: Keep the loopback endpoint requirement, safe public errors, and production-safe defaults. Test endpoint rejection and non-sensitive error responses.
- **A04:2025 Insecure Design**: Bound the look-ahead cache, bound the look-ahead depth, isolate background failures, and invalidate stale contexts. Test resource limits, reset behavior, and stale completion behavior.
- **A07:2025 Injection**: Keep the fixed JSON request shape and pass untrusted segment text through the existing request body. Test malformed and hostile text as data, not executable input.
- **A09:2025 Server-Side Request Forgery**: Preserve loopback-only synthesis endpoint validation. Test that non-loopback endpoints fail before network access.

### Not applicable categories

- **A01:2025 Broken Access Control** is not applicable. The feature has no users, roles, ownership checks, tenants, or protected resources.
- **A03:2025 Software Supply Chain Failures** is not applicable to the feature implementation. The feature adds no dependency or package source. Existing dependency checks remain part of validation.
- **A05:2025 Cryptographic Failures** is not applicable. The feature stores no credentials or sensitive data and adds no cryptographic operation.
- **A06:2025 Identification and Authentication Failures** is not applicable. The feature has no authentication, session identity, or credential flow.
- **A08:2025 Security Logging and Monitoring Failures** is not applicable to the feature boundary. The feature adds no security event or audit flow. Existing safe error handling remains required.
- **A10:2025 Vulnerable and Outdated Components** is not applicable to the code path. The feature adds no component. The existing dependency audit remains part of validation.

### NIST SSDF alignment

- **PO.1**: Trace the feature to the specification, plan, tasks, and contracts.
- **PO.3**: Define the trust boundary at the loopback synthesis endpoint and the browser audio resource.
- **PW.1**: Use behavior-focused tests for bounded resources, cancellation, endpoint validation, and safe errors.
- **PW.2**: Use secure defaults, fixed request shape, bounded cache size, and context invalidation.
- **PW.5**: Keep the change small and preserve the existing dependency set.
- **PW.7**: Review changed code for injection, SSRF, resource exhaustion, stale data, and unsafe error behavior.
- **RV.1**: Run focused tests, type checking, linting, and the full new-app test suite.

## Dependencies and execution order

1. Complete Phase 1 before Phase 2.
2. Complete Phase 2 before User Story 1.
3. Complete User Story 1 before User Story 2 because cancellation protects the scheduler integrated by User Story 1.
4. Complete User Story 2 before User Story 3 regression validation.
5. Complete all stories before Phase 6.
6. Run each test task before its related implementation task and confirm the expected failure.

## Implementation strategy

1. Deliver User Story 1 as the MVP.
2. Validate the MVP with focused tests.
3. Add cancellation and stale-context protection.
4. Run regression tests for preserved reading behavior.
5. Run the full validation commands and manual shutdown check.
