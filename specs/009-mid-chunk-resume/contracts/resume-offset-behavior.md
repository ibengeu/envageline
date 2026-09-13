# Contract: Mid-Chunk Resume Behavior (`pdf-reader/app.js`)

This project has no network API. `readBookmark`, `saveBookmark`, and `speakLocalChunk` are
internal functions not exported via the `api` object (consistent with specs 001-003's existing
bookmark tests, which exercise this behavior only through the full app via `loadBrowserApp`, not
via direct unit calls). This document specifies the new/changed *observable* behavior at the full-
app level — the actual contract surface for this feature, per this project's established pattern
for internal, DOM-adjacent code.

## Extended: Bookmark save captures mid-chunk offset

**Purpose**: FR-001. When a bookmark is saved while a chunk's audio is loaded, the saved
`localStorage` record includes an `offsetSeconds` field (data-model.md) reflecting
`state.audio.currentTime` at save time.

**Behavioral guarantees**:
- Saving a bookmark while `state.audio` exists and reports a finite `currentTime` produces a
  stored record whose `offsetSeconds` matches that value.
- Saving a bookmark with no `state.audio` currently loaded produces a stored record with no
  `offsetSeconds` field at all — identical in shape to a pre-009 bookmark (spec.md Edge Cases).
- Every field a pre-009 bookmark already had (`version`, `index`, `savedAt`) continues to be
  written exactly as before (FR-007's "only adds... on top of" framing).

## Extended: Resume restores mid-chunk offset once

**Purpose**: FR-002, FR-003. Reopening a document with a bookmark carrying a valid
`offsetSeconds` seeks the first `Audio` element created for the bookmarked chunk to that offset
before playback begins; every subsequent chunk begins unaffected.

**Behavioral guarantees**:
- The first chunk played after a resume with a valid saved offset begins at approximately that
  offset (research.md Decision 3: exact value is attempted; platform clamping handles the
  out-of-range case).
- The chunk immediately following the resumed one (via normal chunk-end auto-advance) begins at
  time zero, never offset by the previously-consumed value (FR-003) — verified directly, not just
  by construction, per this project's TDD practice.
- A resume with a bookmark carrying no `offsetSeconds` (a pre-009-shaped record) begins the
  bookmarked chunk at time zero, exactly as it does today (FR-004).

## Extended: Invalid or out-of-range offset falls back safely

**Purpose**: FR-005. A malformed, negative, or out-of-range `offsetSeconds` value never prevents
the resumed chunk from starting.

**Behavioral guarantees**:
- A bookmark record with a non-numeric, negative, or otherwise invalid `offsetSeconds` value
  still resumes into the correct chunk and begins playback successfully, starting at time zero
  for that field's purposes (the record's `index`/`version`/`savedAt` fields remain otherwise
  valid and are not affected by an invalid `offsetSeconds`).
- A syntactically valid but out-of-range `offsetSeconds` (larger than the actual audio duration)
  does not throw, stall, or block playback — the resumed chunk still plays.

## Unchanged: Everything else about bookmark save/restore

**Purpose**: FR-004, FR-006, FR-007, FR-009 — the non-regression contract this entire feature is
bounded by.

**Behavioral guarantees**:
- `ttsCache` (audio caching), its cache-key derivation, and its eviction behavior are completely
  unaffected by this feature (FR-006) — no test or code path in this feature touches it.
- The bookmark key (SHA-256 digest of raw PDF bytes) and which chunk a bookmark resumes into are
  completely unaffected by this feature (FR-007) — this feature only adds a within-chunk
  refinement on top of the existing chunk-level resume decision.
- Every existing bookmark-related test (save/restore/remove/corrupt-data-handling/storage-
  failure/privacy-mode) continues to pass unmodified (FR-009, SC-001) — this feature's tests are
  additive, not replacements.
