# Feature Specification: Mid-Chunk Resume Position

**Feature Branch**: `009-mid-chunk-resume`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: sixth and final subsystem of a multi-spec effort to evolve the
existing Smart PDF Reading pipeline (`pdf-reader/app.js`, from specs 001-008) toward the "PDF →
structured spoken-document representation" architecture described in a full system design
document (Mobile PDF-to-Speech Reader). This is a targeted gap-closing spec, not a rebuild:
specs 001-003 already implemented a complete, tested, privacy-conscious resume system (a SHA-256
digest of the raw PDF file bytes as a local storage key, storing `{ version, index, savedAt }`
and restoring `state.chunkIndex` on reopen) and a complete, tested IndexedDB audio cache
(`ttsCache`). Both are correct today and are not touched by this spec. The one confirmed gap:
resume restores playback to the start of the bookmarked chunk only, never to the position within
that chunk's audio the listener had actually reached — a chunk can span several seconds of audio,
so every resume replays from the beginning of whatever sentence the listener was mid-way through.
This spec extends the bookmark to also persist and restore that mid-chunk offset, using the
existing live `Audio` element's `currentTime`, which already carries the data needed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resuming continues from where playback actually stopped (Priority: P1)

A listener bookmarks a passage partway through a long chunk being read aloud, closes the reader,
and reopens the same document later. Playback resumes from approximately the same moment they
left off — not from the beginning of the sentence or clause that chunk started with.

**Why this priority**: This is the entire point of the spec — the confirmed, real gap. A listener
bookmarking mid-chunk today always hears the first part of that chunk re-read, which is a minor
but repeated annoyance in exactly the resume flow bookmarking exists to serve.

**Independent Test**: Save a bookmark partway through a chunk's audio playback (simulating a
mid-chunk position), reopen the same document, and confirm the restored audio begins at
approximately the saved position rather than at the start of the chunk.

**Acceptance Scenarios**:

1. **Given** a listener is partway through a chunk's audio when they bookmark and close the
   reader, **When** they reopen the same document, **Then** the bookmarked chunk's audio begins
   at approximately the saved mid-chunk position, not at time zero.
2. **Given** a listener bookmarks right at the very start of a chunk (position at or near zero),
   **When** they reopen the same document, **Then** playback begins at or near the start of that
   chunk, exactly as it does today.
3. **Given** a listener resumes into a bookmarked chunk with a saved mid-chunk offset, **When**
   that chunk finishes and playback naturally advances to the next chunk, **Then** the next chunk
   begins at time zero, not offset by the previously-saved value — the offset applies only to the
   one bookmarked chunk being resumed into, never to any subsequent chunk in the same session.

---

### User Story 2 - Bookmarks saved before this feature still work exactly as before (Priority: P1)

A listener who bookmarked a document before this feature existed reopens that document after the
update. Resume behaves exactly as it did before — restoring to the start of the bookmarked chunk
— since no mid-chunk position was ever recorded for that older bookmark.

**Why this priority**: Ranked alongside User Story 1 as P1 because this is the non-regression
guarantee the whole feature depends on — a resume system that silently breaks or discards
existing users' bookmarks on upgrade would be a regression far worse than the gap being closed.
Any stored bookmark, old or new format, must never be treated as corrupted data and discarded
because of this change.

**Independent Test**: Construct a bookmark record in the exact shape specs 001-003 already
produce (no mid-chunk offset field present) and confirm it is read successfully, is not treated
as corrupt, and restores to chunk-start exactly as it did before this feature existed.

**Acceptance Scenarios**:

1. **Given** a bookmark record saved by the pre-009 code (containing only `version`, `index`,
   `savedAt`), **When** the document is reopened, **Then** it is read successfully (not discarded
   as corrupt) and resumes at the start of the bookmarked chunk, identical to today's behavior.
2. **Given** a bookmark saved by this feature (containing a mid-chunk offset) is later read by
   this same feature's code, **When** the document is reopened, **Then** the mid-chunk offset is
   honored as described in User Story 1.

### Edge Cases

- What happens when the saved mid-chunk offset is at or beyond the actual duration of the
  resumed chunk's audio (e.g. the audio was re-synthesized slightly differently, or the offset
  value is otherwise stale/invalid)? Playback falls back to starting that chunk at time zero
  rather than failing, stalling, or seeking to an invalid position — an unusable offset is
  treated as if no offset were saved, not as a fatal error.
- What happens when the audio element cannot support seeking to a specific time before playback
  starts (e.g. the format or environment doesn't support it)? The reader still begins playback
  of the correct chunk; the mid-chunk offset is a best-effort refinement, not a requirement for
  resume to work at all — the existing chunk-level resume behavior remains the fallback.
- What happens when a listener bookmarks while playback is paused rather than actively playing?
  The paused position is exactly the position to save — this feature does not distinguish
  "paused" from "actively playing" for the purpose of capturing where to resume; either state
  has a well-defined current playback position to persist.
- What happens to a bookmark saved with no chunk currently loaded (nothing playing yet)? No
  mid-chunk offset is available to save in that case, so none is recorded, and the resulting
  bookmark behaves exactly as an old-format bookmark would — this is already how a bookmark
  without a valid `state.audio` reference is handled today, unaffected by this change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When a listener saves a bookmark while a chunk's audio is loaded, the system MUST
  persist the current playback position within that chunk, in addition to the existing chunk
  index and save timestamp.
- **FR-002**: When a listener reopens a document with a bookmark that includes a saved mid-chunk
  position, the system MUST begin playback of the bookmarked chunk at approximately that
  position rather than at its start.
- **FR-003**: The mid-chunk position MUST apply only to the one chunk the bookmark resumes into;
  every subsequent chunk in that playback session MUST begin at its own start, unaffected by the
  previously-restored offset.
- **FR-004**: A bookmark record saved before this feature existed (containing no mid-chunk
  position field) MUST continue to be read successfully and MUST resume at the start of the
  bookmarked chunk, exactly as it did before this feature — such a record MUST NOT be treated as
  corrupted or discarded because the new field is absent.
- **FR-005**: The system MUST fall back to starting the resumed chunk at time zero when the saved
  mid-chunk position is missing, invalid, or at/beyond the actual audio duration, rather than
  failing to resume or producing an unusable playback state.
- **FR-006**: This feature MUST NOT change the existing audio cache (`ttsCache`), its cache-key
  derivation, or any of its eviction behavior.
- **FR-007**: This feature MUST NOT change the existing bookmark key derivation (the SHA-256
  digest of the raw PDF file bytes) or which chunk a bookmark resumes into — it only adds a
  finer-grained position on top of the chunk already selected by today's logic.
- **FR-008**: This feature MUST NOT introduce any new user-facing control, button, or visible
  indicator — the mid-chunk position is saved and restored transparently as part of the existing
  bookmark save/restore flow.
- **FR-009**: For any document and bookmark scenario that does not involve a mid-chunk position
  (no bookmark, or a bookmark saved by this feature's own code with no meaningful offset to
  record), the system MUST produce identical observable behavior to before this feature.

### Key Entities *(include if feature involves data)*

- **Bookmark Record**: The persisted resume-state value for a given document (keyed by the
  existing SHA-256 file-byte digest). Gains one new, optional field carrying the mid-chunk
  playback position; all fields specs 001-003 already defined (`version`, `index`, `savedAt`)
  remain present and unchanged in meaning. A record without the new field is exactly as valid as
  one with it — the field's absence is a normal, expected case (every pre-009 bookmark), not an
  error condition.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of the existing behavioral test suite (191 tests as of spec 008) continues to
  pass unmodified after this feature, with no pre-existing test needing rewriting to tolerate a
  behavior change.
- **SC-002**: Saving a bookmark mid-chunk and reopening the document resumes playback within a
  small, consistent tolerance of the saved position, verified for at least one mid-chunk position
  and for a position at/near chunk-start (matching today's behavior at that boundary).
- **SC-003**: A bookmark record in the exact pre-009 shape (no mid-chunk field) is read
  successfully and resumes at chunk-start, with zero instances of such a record being discarded
  as corrupt, across all tested cases.
- **SC-004**: After resuming into a bookmarked chunk with a saved mid-chunk position, the next
  chunk in the same session begins at time zero in 100% of tested cases.
- **SC-005**: An invalid, missing, or out-of-range mid-chunk position results in the resumed
  chunk starting at time zero rather than a failure, stall, or exception, in 100% of tested
  cases.

## Assumptions

- The mid-chunk position is measured in the same unit the underlying `Audio` element already
  uses for its current-time property (seconds, as a floating-point value) — no new unit
  conversion or precision requirement is introduced beyond what the platform already provides.
- "Approximately" the saved position (User Story 1, SC-002) allows for ordinary small timing
  variance inherent to audio seeking and does not require frame-exact precision.
- No schema migration process beyond additive field tolerance is required — an old-format
  bookmark is valid input, not data requiring conversion, since the new field is purely optional
  and additive to the existing shape.
- This feature does not change how or when a bookmark is saved (the same explicit user action
  that saves a bookmark today) — it only changes what is captured at that moment and how it is
  used on restore.
