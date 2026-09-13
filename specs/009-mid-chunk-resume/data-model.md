# Phase 1 Data Model: Mid-Chunk Resume Position

## Bookmark Record (extended)

The persisted JSON value `saveBookmark` writes and `readBookmark` reads, keyed by the existing
SHA-256 file-byte digest (unchanged, per FR-007). Gains one new optional field.

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | `number` | yes | Unchanged — stays `1` (research.md Decision 1; no version bump). |
| `index` | `number` | yes | Unchanged — the bookmarked chunk index, validated exactly as today. |
| `savedAt` | `number` | yes | Unchanged — the save timestamp, validated exactly as today. |
| `offsetSeconds` | `number` | no | New. The playback position (seconds) within the bookmarked chunk's audio at save time. Absent on every pre-009 record and on any record saved with no audio currently loaded (spec.md Edge Cases). When present, MUST be a finite number `>= 0` to be honored — an invalid value is treated as absent, not as grounds to discard the record (research.md Decision 1). |

## Transient Session State (new)

Not persisted — exists only for the duration of one document-load-to-first-chunk-start cycle.

| Field | Type | Notes |
|---|---|---|
| `state.pendingResumeOffsetSeconds` | `number \| null` | Set once, during document load, when a restored bookmark carries a valid `offsetSeconds`. Consumed (applied to `state.audio.currentTime`) and cleared to `null` the first time `speakLocalChunk` creates an `Audio` element afterward (research.md Decision 2). `null` at all other times, including before any bookmark is restored and after the one-shot consumption. |

## Validation rules (from Functional Requirements)

- `readBookmark` MUST continue to require exactly `version === BOOKMARK_VERSION` (unchanged,
  `BOOKMARK_VERSION` staying `1`), `index` a valid integer within chunk-count bounds, and
  `savedAt` a positive finite number — identical to today (FR-004).
- `readBookmark` MUST accept a record with `offsetSeconds` absent as fully valid (FR-004) — this
  is the normal case for every bookmark saved before this feature.
- `readBookmark` MUST accept a record with a valid `offsetSeconds` (finite, `>= 0`) as valid, and
  MAY normalize/ignore an invalid `offsetSeconds` value (non-number, negative, `NaN`) without
  invalidating the rest of the record (FR-005).
- `saveBookmark` MUST include `offsetSeconds` in the saved record only when `state.audio` exists
  and its `currentTime` is a finite number; otherwise the field MUST be omitted (spec.md Edge
  Cases), producing a record indistinguishable in shape from a pre-009 bookmark.
- `state.pendingResumeOffsetSeconds` MUST be applied to at most one `Audio` element per document
  load — every subsequent chunk in the same session MUST begin unaffected by it (FR-003).
- Setting `state.audio.currentTime` to an out-of-range or otherwise unusable value MUST NOT
  prevent playback of the resumed chunk from starting (FR-005) — relying on the platform's own
  clamping behavior (research.md Decision 3), not a custom pre-check.

## State transitions

`state.pendingResumeOffsetSeconds`: `null` (default) → `<number>` (set once, at document-load
bookmark-restore time, only if a valid offset was saved) → `null` (cleared unconditionally the
first time `speakLocalChunk` runs afterward, whether or not the offset was successfully applied).
This is the only state transition this feature introduces; the persisted `Bookmark Record`
remains a one-shot read/write value exactly as it is today (no transitions of its own).
