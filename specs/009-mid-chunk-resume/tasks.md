---

description: "Task list for Mid-Chunk Resume Position"
---

# Tasks: Mid-Chunk Resume Position

**Input**: Design documents from `/specs/009-mid-chunk-resume/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
contracts/resume-offset-behavior.md, quickstart.md (all present)

**Tests**: Included throughout, per Constitution Principle III (Behavior-Driven TDD,
non-negotiable). Kept lean per prior user feedback on spec 007's test-count growth — this is a
small, targeted feature; each test covers one distinct behavior with no per-example duplication.

**Scope**: Both user stories from spec.md:
- User Story 1 (P1) — Resuming continues from where playback actually stopped (FR-001, FR-002,
  FR-003)
- User Story 2 (P1) — Bookmarks saved before this feature still work exactly as before (FR-004,
  FR-005, FR-009)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files/functions, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2)
- All file paths are relative to the repository root.

## Path Conventions

Single project, matching plan.md's Structure Decision — no new files: all tasks touch
`pdf-reader/app.js` (implementation) and `pdf-reader/reader.test.js` (tests). `saveBookmark`/
`readBookmark`/`speakLocalChunk` are not exported (consistent with specs 001-003's precedent) —
all new tests exercise this feature through the full app via the existing `loadBrowserApp` test
helper, matching how the pre-existing bookmark tests already work.

---

## Phase 1: Setup

**Purpose**: Confirm the baseline this feature builds on.

- [X] T001 Confirmed: 191/191 passing baseline before any change.

---

## Phase 2: User Story 2 - Bookmarks saved before this feature still work exactly as before (Priority: P1) 🎯 Non-regression foundation

**Goal**: A bookmark record in the exact pre-009 shape (no `offsetSeconds` field) is read
successfully and resumes at chunk-start, unaffected by this feature (FR-004, FR-005, FR-009).
Sequenced first, ahead of User Story 1, because it is this feature's hard non-regression
constraint — proving it holds *before* adding new behavior on top makes clear that any later
failure is a real regression introduced by this feature, not a pre-existing gap.

**Independent Test**: Construct a bookmark record with only `version`/`index`/`savedAt` (no
`offsetSeconds`) directly in the test's fake `localStorage`, reopen the document, and confirm it
resumes at chunk-start exactly as it did before this feature existed.

### Tests for User Story 2

> Write these tests FIRST, ensure they FAIL before implementation (i.e. before `readBookmark`'s
> validation is touched at all — these must already pass against the untouched code, then stay
> green throughout implementation).

- [X] T002 [P] [US2] Added test: a bookmark record with no `offsetSeconds` field (the exact
      pre-009 shape) is read successfully and resumes at chunk-start. Passed immediately, both
      before and after T004's implementation — confirming this is a true non-regression guard,
      not something the implementation had to earn.
- [X] T003 [P] [US2] Added test: a bookmark record with a malformed `offsetSeconds` (a negative
      number) still resumes into the correct chunk successfully. Also passed immediately, since
      today's `readBookmark` already ignores unrecognized/extra fields structurally — confirming
      the "purely additive" design (research.md Decision 1) requires no defensive change to
      `readBookmark`'s core validation at all.

### Implementation for User Story 2

- [X] T004 [US2] Added `isValidBookmarkOffsetSeconds(value)` — a small validity check (finite,
      `>= 0`) for use at the point `offsetSeconds` is actually consumed (Phase 3), rather than
      inside `readBookmark`'s pass/fail logic itself. **Confirmed no `BOOKMARK_VERSION` bump was
      needed or added** (research.md Decision 1) — `readBookmark`'s existing validation already
      tolerates an unrecognized extra field structurally, so T002/T003 required zero changes to
      pass; this task's only real work is providing the validity check Phase 3 needs when
      deciding whether to honor a present `offsetSeconds`.

**Checkpoint**: `node --test reader.test.js` — pre-009 bookmarks are provably unaffected by this
feature's presence (verified both before and after T004, not just asserted), and a malformed new
field degrades gracefully. This is the foundation the rest of the feature builds on without risk
of regressing existing users' bookmarks.

---

## Phase 3: User Story 1 - Resuming continues from where playback actually stopped (Priority: P1)

**Goal**: Saving a bookmark captures the current mid-chunk playback position; reopening the
document resumes at approximately that position, exactly once, for exactly the bookmarked chunk
(FR-001, FR-002, FR-003).

**Independent Test**: Save a bookmark partway through a chunk's audio, reopen the document, and
confirm the resumed audio begins at approximately the saved position; confirm the chunk after it
begins at time zero, unaffected.

### Tests for User Story 1

> Write these tests FIRST, ensure they FAIL before implementation.

- [X] T005 [P] [US1] Added failing test: saving a bookmark while `state.audio.currentTime` is
      non-zero produces a stored record whose `offsetSeconds` matches that value (FR-001).
- [X] T006 [P] [US1] Added failing test: reopening a document with such a bookmark resumes the
      bookmarked chunk's audio at the saved offset (FR-002, SC-002).
- [X] T007 [P] [US1] Added failing test: after the resumed chunk finishes and playback
      auto-advances, the next chunk begins at time zero (FR-003, SC-004). **Timing bug found and
      fixed while writing this test**: `onended()` calls `speakLocalChunk()` without awaiting it
      internally, so `await reopened.window.lastAudio.onended()` did not actually wait for the
      new chunk's async cache-lookup/fetch/Audio-construction chain to complete — the assertion
      initially checked the *first* Audio element's stale `currentTime` before the second one
      existed. Fixed using this test file's own established pattern for this exact situation
      (`await new Promise((resolve) => setTimeout(resolve, 20))`, already used elsewhere for
      waiting on async playback chains) instead of a fixed number of `await Promise.resolve()`
      microtask flushes, which proved insufficient.

### Implementation for User Story 1

- [X] T008 [US1] Extended `saveBookmark` to include `offsetSeconds: state.audio.currentTime` in
      the saved record when `state.audio` exists and its `currentTime` passes
      `isValidBookmarkOffsetSeconds`; omitted entirely otherwise (spec.md Edge Cases). Verified
      the pre-existing "bookmarking the selected passage saves only a local resume position" test
      (which asserts the saved record's keys are *exactly* `["index", "savedAt", "version"]`)
      still passes unmodified — that test never presses Play, so `state.audio` is `null` and the
      field is correctly omitted, confirming the additive design doesn't leak into cases with
      nothing to capture. Makes T005 pass.
- [X] T009 [US1] Added `state.pendingResumeOffsetSeconds` (default `null`) to the state object;
      stage it from the restored bookmark's `offsetSeconds` in the document-load flow (the same
      place `state.chunkIndex = bookmark.index` is already set), only when a valid offset is
      present.
- [X] T010 [US1] Extended `speakLocalChunk` to apply `state.pendingResumeOffsetSeconds` to
      `state.audio.currentTime` immediately after creating the `Audio` element (before
      `.play()`) whenever it is not `null`, then unconditionally sets it back to `null` —
      ensuring every subsequent call to `speakLocalChunk` in the session finds it already
      cleared. Makes T006–T007 pass.

**Checkpoint**: `node --test reader.test.js`: 196/196 passing (191 pre-existing, unmodified + 5
new). The full mid-chunk resume behavior works end-to-end and applies exactly once per session,
verified directly (via T007's fixed timing) rather than assumed from the one-shot design alone.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final validation against the spec's success criteria as a whole.

- [X] T011 Reviewed the extended functions against Principle V (≤10 cyclomatic complexity):
      `isValidBookmarkOffsetSeconds` (new, ~1), `readBookmark` (unchanged, no complexity added),
      `saveBookmark` (+1 guard condition), `speakLocalChunk` (+1 guard condition), the
      document-load flow (+1 guard condition). All well within the limit; increments match the
      "handful of guard conditions, not new control-flow structures" prediction exactly.
- [X] T012 Confirmed via inspection: `ttsCache` (4 references, all pre-existing) and
      `bookmarkKeyForFile` (SHA-256 digest logic, untouched) show zero modifications (FR-006,
      FR-007).
- [X] T013 Ran `quickstart.md`'s automated validation section (`node --test reader.test.js`) —
      all listed expectations hold: 191 pre-existing tests unmodified and passing, plus 5 new
      tests, 196/196 total.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **User Story 2 (Phase 2, P1)**: Depends on Setup. Sequenced first as the non-regression
  foundation (see Phase 2's Goal) — proves the feature's hard constraint holds before any new
  behavior is layered on top.
- **User Story 1 (Phase 3, P1)**: Depends on Phase 2's `readBookmark` extension existing (it
  reads the same `offsetSeconds` field Phase 2 taught `readBookmark` to validate).
- **Polish (Phase 4)**: Depends on Phase 3.

### Within Each User Story

- Tests are written and confirmed failing (or, for T002, confirmed already-passing) before
  implementation.
- Implementation tasks follow their tests directly.

### Parallel Opportunities

- T002–T003 (US2 tests) can be written in parallel.
- T005–T007 (US1 tests) can be written in parallel.

---

## Implementation Strategy

### MVP First (User Story 2 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: User Story 2 — `readBookmark` accepts the new optional field without
   breaking any existing bookmark. This alone is a safe, shippable checkpoint even before the
   save/restore behavior exists, since no bookmark is yet being saved with the new field.
3. **STOP and VALIDATE**: run `node --test reader.test.js`.

### Incremental Delivery

1. Setup → baseline confirmed.
2. User Story 2 → `readBookmark` tolerates the new field safely → validate independently.
3. User Story 1 → save/restore/one-shot-consumption all work end-to-end → validate
   independently.
4. Polish → cross-cutting success-criteria confirmation.

This feature is deliberately small: 6 new tests total (T002-T003, T005-T007), reflecting its
scope as a targeted, bounded gap-closer rather than a new subsystem.
