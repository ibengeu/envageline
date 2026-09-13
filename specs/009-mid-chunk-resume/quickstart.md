# Quickstart: Validating Mid-Chunk Resume Position

Validates the new resume-offset behavior end-to-end once implemented, without duplicating the
full behavior spec (see [spec.md](./spec.md)) or contract details (see
[contracts/resume-offset-behavior.md](./contracts/resume-offset-behavior.md)).

## Prerequisites

- No new dependencies to install — this feature adds code only to `pdf-reader/app.js` and tests
  only to `pdf-reader/reader.test.js`.
- Node.js available for running the automated test suite.
- `index.html`/`styles.css` are explicitly out of scope — no manual UI validation step required
  (FR-008: no new control is introduced).

## Automated validation

From the repository root:

```sh
cd pdf-reader
node --test reader.test.js
```

Expected: **all existing tests continue to pass, unmodified** (SC-001) — including every existing
bookmark-related test (save, restore, remove, corrupt-data handling, storage-failure tolerance,
privacy-mode tolerance). Plus new tests covering:

- Saving a bookmark while a chunk's audio is loaded records a mid-chunk offset matching
  `state.audio.currentTime`.
- Reopening a document with such a bookmark resumes the bookmarked chunk at approximately that
  offset.
- The chunk immediately following the resumed one begins at time zero, not offset (SC-004) —
  this is the test most directly proving the one-shot consumption design (research.md
  Decision 2) works correctly, not just by construction.
- A bookmark record constructed in the exact pre-009 shape (no `offsetSeconds` field at all) is
  read successfully and resumes at chunk-start, exactly as before this feature (SC-003) — this is
  the single most important test in this feature, proving zero regression for every existing
  bookmark.
- A bookmark record with a malformed/invalid `offsetSeconds` value still resumes successfully,
  without error or stall (SC-005).

## Manual validation

Not required for this feature — same reasoning as specs 004-008: no UI or user-observable control
surface changes; the automated suite (which already exercises full app load/bookmark/resume
cycles via `loadBrowserApp`) is the complete validation surface.

## Success criteria mapping

- SC-001 (100% of existing suite passes unmodified) → `node --test reader.test.js` full pass with
  zero pre-existing test file edits.
- SC-002 (resume within tolerance of the saved mid-chunk position, and at/near chunk-start when
  saved near zero) → the two dedicated save/restore-offset tests.
- SC-003 (pre-009-shaped bookmark reads and resumes exactly as before) → the dedicated backward-
  compatibility test — the feature's primary regression guard.
- SC-004 (the chunk after the resumed one is never offset) → the dedicated one-shot-consumption
  test.
- SC-005 (invalid/out-of-range offset never blocks resume) → the dedicated invalid-offset test.

## Out of scope for this validation pass

Any change to `ttsCache`, its cache-key derivation, or eviction behavior is not implemented or
validated here (FR-006) — confirmed unaffected by inspection, not by a new test, since no code
path in this feature touches that subsystem at all. Any new UI indicator or control showing the
saved offset is also out of scope (FR-008).
