---

description: "Task list for TTS Engine Abstraction"
---

# Tasks: TTS Engine Abstraction

**Input**: Design documents from `/specs/008-tts-engine-abstraction/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/tts-engine-functions.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable). Per user feedback on spec 007's test-count growth, this feature is scoped to the
minimum tests that each cover a distinct behavior not already exercised by the existing suite —
no per-example duplication, no restating a unit-level assertion at the integration level unless
the integration level is what's actually new.

**Scope**: Both user stories from spec.md:
- User Story 1 (P1) — Nothing changes for a listener today (FR-006, FR-007, FR-010)
- User Story 2 (P1) — The pipeline depends on an interface, not on Kokoro specifically (FR-001,
  FR-002, FR-003, FR-004, FR-005, FR-011)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/functions, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2)
- All file paths are relative to the repository root.

## Path Conventions

Single project, matching plan.md's Structure Decision — no new files: all tasks touch
`pdf-reader/app.js` (implementation) and `pdf-reader/reader.test.js` (tests).

---

## Phase 1: Setup

**Purpose**: Confirm the baseline this feature builds on.

- [X] T001 Confirmed: 186/186 passing baseline before any change.

---

## Phase 2: User Story 2 - The pipeline depends on an interface, not on Kokoro specifically (Priority: P1) 🎯 MVP

**Goal**: `createKokoroTtsEngine()` exists, satisfies the `TTSEngine` contract, performs exactly
`fetchLocalAudioBlob`'s existing logic, and is substitutable by a Kokoro-agnostic test double
(FR-001–FR-005, FR-011). Sequenced first because User Story 1's non-regression tests need this
implementation to exist before they can exercise it end-to-end.

**Independent Test**: Construct a minimal test double implementing `synthesize(text, options)`
and confirm it can be substituted for the default engine, with no test code referencing
Kokoro-specific request/response shape; separately, confirm `createKokoroTtsEngine()` reproduces
`fetchLocalAudioBlob`'s three defining behaviors (endpoint resolution/validation, request
construction, retry) directly.

### Tests for User Story 2

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T002 [P] [US2] Added failing test: `createKokoroTtsEngine()` returns an object with a
      `synthesize` function (FR-001).
- [X] T003 [P] [US2] **Spec correction found during this task**: inspecting the pre-008
      `fetchLocalAudioBlob` directly (via `git show HEAD:pdf-reader/app.js`) showed it never
      validated loopback-only itself — that check has only ever lived at the playback-initiation
      call site, one level up. FR-006 in spec.md incorrectly assumed the check lived inside the
      synthesis function; corrected spec.md's FR-006 in place to state the real architecture
      (documented as a correction, not silently rewritten) rather than implement a check that
      would be a genuine, forbidden behavior change for this zero-behavior-change spec. Replaced
      the originally-planned rejection test with one confirming `synthesize` requests exactly the
      endpoint it's given (FR-002) — the actually-correct thing to verify at this layer.
- [X] T004 [P] [US2] Added failing test: `synthesize` resolves to an object with a `.blob` field
      containing the audio from a mocked successful `fetch` (FR-005).
- [X] T005 [P] [US2] Added test proving substitutability. **Two real bugs found and fixed while
      writing/running this test**:
      (1) My first draft used `loadBrowserApp` (which deletes the require cache and re-requires
      `app.js` fresh, so `attachReader` re-runs with `global.window` set) and called
      `setTtsEngine` on the *original* top-of-file-imported module instance — a completely
      different closure from the one `loadBrowserApp`'s fresh instance uses, so the substitution
      never reached the code under test. Rewrote the test to exercise the same top-level module
      instance directly instead (via `getDefaultTtsEngine()`, see bug 2), which is what
      `setTtsEngine`/`localChunkPromise` actually share.
      (2) `defaultTtsEngine` is exposed via an object getter (so `setTtsEngine` reassignment is
      visible) — but destructuring `const { defaultTtsEngine } = require(...)` at the top of the
      test file evaluates the getter exactly once, at require-time, freezing a snapshot rather
      than tracking reassignment. Fixed by removing `defaultTtsEngine` from the destructured
      import and adding a `getDefaultTtsEngine()` helper that reads `appModule.defaultTtsEngine`
      fresh on every call.
- [X] T006 [P] [US2] Added failing test: `defaultTtsEngine` (via the new `getDefaultTtsEngine()`
      helper) is an object with a `synthesize` function, confirming FR-004.

### Implementation for User Story 2

- [X] T007 [US2] Implemented `createKokoroTtsEngine()`: a factory whose `synthesize(text,
      options)` method contains `fetchLocalAudioBlob`'s exact existing body (endpoint resolution
      via `localTtsEndpoints`, request construction, retry-with-backoff via
      `waitForRetryDelay`), reading `voice`/`speed`/`endpoint` from `options` instead of
      `elements.*`, returning `{ blob, synthesisMs }` instead of a bare `Blob`. Deleted
      `fetchLocalAudioBlob` (verified via search: zero remaining references). **Placement bug
      found and fixed**: initially placed this new code alongside `fetchLocalAudioBlob`'s old
      location, which is textually *after* the file's `if (typeof document === "undefined")
      return;` early-return guard (line ~1433) — meaning `let defaultTtsEngine =
      createKokoroTtsEngine()` never executed under Node (no `document` global), and the module's
      exported `defaultTtsEngine` getter threw `ReferenceError: Cannot access 'defaultTtsEngine'
      before initialization` the moment any test file required the module. Fixed by moving the
      whole block (factory function, the `let defaultTtsEngine = ...` instantiation, and
      `setTtsEngine`) to before that guard, alongside the other Node-testable pipeline functions.
      Makes T002, T004 pass.
- [X] T008 [US2] Added `let defaultTtsEngine = createKokoroTtsEngine();` at module scope (a `let`,
      not `const`, since `setTtsEngine` must be able to reassign it) plus `setTtsEngine(engine)`
      and an exported `get defaultTtsEngine()` getter (not a plain property) so reassignment
      through `setTtsEngine` is visible to anything reading `api.defaultTtsEngine` after the
      fact. Makes T006 pass.
- [X] T009 [US2] Updated `localChunkPromise` to call `defaultTtsEngine.synthesize(chunkText, {
      voice, speed, endpoint })` instead of `fetchLocalAudioBlob(endpoint, chunkText)`, reading
      `result.blob` for the cached/returned value and `result.synthesisMs` for the
      `ewma.record(...)` call — this moves `ewma.record` from inside the old synthesis function
      (its actual pre-008 location, confirmed via `git show`) to the caller, exactly matching
      spec.md's Edge Cases ("the caller continues to own recording it... the interface does not
      entangle audio synthesis with playback-timing orchestration"). Makes T005 pass.
- [X] T010 [US2] Exported `createKokoroTtsEngine`, `setTtsEngine`, and a `get defaultTtsEngine()`
      getter from the `api`/`module.exports` object.

**Checkpoint**: `node --test reader.test.js`: 191/191 passing (186 pre-existing, unmodified + 5
new). The interface exists, is genuinely substitutable (proven against the same live module
binding `localChunkPromise` reads), and `KokoroTtsEngine` reproduces the pre-008 behavior
directly. This is the feature's actual MVP.

---

## Phase 3: User Story 1 - Nothing changes for a listener today (Priority: P1)

**Goal**: Confirm, without any new bespoke tests, that the full pre-existing test suite — which
already exercises localhost-only validation, endpoint fallback, retry-on-failure, and prefetching
end-to-end via `fetch()` mocking — passes unmodified against the Phase 2 refactor (FR-007,
FR-010).

**Independent Test**: Run the full existing test suite and confirm every test passes unmodified.

- [X] T011 [US1] Ran `node --test reader.test.js`: 191/191 passing (186 baseline + 5 new), zero
      pre-existing test modified. All existing TTS-related tests (localhost rejection, same-
      origin acceptance, localhost:8880 fallback, retry-on-reconnect, backgrounded playback)
      pass unchanged against the refactored `localChunkPromise`/`KokoroTtsEngine` path.

**Checkpoint**: The refactor is proven behavior-preserving using the existing suite alone — no
duplicate regression tests were written for behavior the existing suite already covers precisely
because it operates at the `fetch()` mock boundary (confirmed in plan.md), consistent with the
user's direction to keep this suite lean.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against the spec's success criteria as a whole.

- [X] T012 Reviewed `createKokoroTtsEngine`'s `synthesize` (~5: try/catch, one for-loop, two
      ifs — identical branching shape to the pre-008 `fetchLocalAudioBlob` it relocates, no
      complexity added) and `setTtsEngine` (~1, a single assignment). Both well within the limit.
- [X] T013 Searched `pdf-reader/app.js` for `fetchLocalAudioBlob`: zero references remain.
- [X] T014 Ran `quickstart.md`'s automated validation section (`node --test reader.test.js`) —
      all listed expectations hold: 186 pre-existing tests unmodified and passing, plus 5 new
      tests, 191/191 total.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **User Story 2 (Phase 2, P1)**: Depends on Setup. Builds the actual interface and
  implementation — sequenced first since User Story 1 has nothing to verify until this exists.
- **User Story 1 (Phase 3, P1)**: Depends on Phase 2 being complete — it is a verification phase
  over Phase 2's output, not new capability, so it is sequenced after despite sharing P1
  priority.
- **Polish (Phase 4)**: Depends on Phase 3.

### Within Each User Story

- Tests are written and confirmed failing before implementation.
- Implementation tasks follow their tests directly.

### Parallel Opportunities

- T002–T006 (US2 tests) can all be written in parallel — each asserts an independent fact about
  the not-yet-implemented `createKokoroTtsEngine`/`defaultTtsEngine`.

---

## Implementation Strategy

### MVP First (User Story 2 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: User Story 2 — the interface, `KokoroTtsEngine`, and substitutability all
   exist and are independently correct. This alone is the feature's actual deliverable.
3. **STOP and VALIDATE**: run `node --test reader.test.js`.

### Incremental Delivery

1. Setup → baseline confirmed.
2. User Story 2 → interface + implementation + substitutability proven → validate independently.
3. User Story 1 → non-regression proven using the existing suite alone, no new tests needed →
   validate independently.
4. Polish → cross-cutting success-criteria confirmation.

This feature is deliberately small: 5 new tests total (T002–T006), reflecting that most of its
success criteria (SC-001, SC-002) are proven by the *absence* of needed changes to the existing
suite, not by new test volume.
