# Implementation Plan: Mid-Chunk Resume Position

**Branch**: `009-mid-chunk-resume` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-mid-chunk-resume/spec.md`

## Summary

Extend the bookmark record `saveBookmark` writes (`app.js:1619`) with one new, optional field —
the current chunk's playback position — captured from `state.audio.currentTime` at save time.
Restore it in the existing load flow (`app.js:2312`) as a one-shot pending value
(`state.pendingResumeOffsetSeconds`), consumed and cleared the first time `speakLocalChunk`
(`app.js:2352`) creates the `Audio` element for the bookmarked chunk, applied via
`state.audio.currentTime = offset` before `state.audio.play()`. **Critical finding during
planning**: `readBookmark`'s existing validation (`app.js:1594`) checks `value.version ===
BOOKMARK_VERSION` with strict equality — bumping `BOOKMARK_VERSION` would cause every pre-009
bookmark to fail validation and be deleted as corrupt, directly violating FR-004. This plan does
**not** bump the version; the new field is purely additive and optional under the existing
version `1`, read with an explicit presence/validity check rather than a version-gated branch.

## Technical Context

**Language/Version**: JavaScript (Node.js `--test` runner; browser-executed via `<script>`, no
build step) — same as specs 001-008.

**Primary Dependencies**: None new. Reuses the existing `localStorage`-backed bookmark storage
and the browser's `Audio` element `currentTime` property.

**Storage**: `localStorage`, via the existing `bookmarkStorage()`/`readBookmark`/`saveBookmark`
functions — schema gains one new optional field; no new storage key, no new storage mechanism.

**Testing**: `node --test reader.test.js`.

**Target Platform**: Browser (client-side, offline-first), per constitution Principle I.

**Project Type**: Single-page web application, single source file (`pdf-reader/app.js`) plus its
co-located test file — same structure as specs 001-008.

**Performance Goals**: No new performance target; this reads one already-available property
(`Audio.currentTime`) at an already-occurring save event, and sets it once at an already-occurring
chunk-start event.

**Constraints**: Must not change `ttsCache`, its cache-key derivation, or eviction behavior
(FR-006). Must not change the SHA-256 file-byte bookmark key derivation or which chunk a bookmark
resumes into (FR-007). Must not introduce any new UI control (FR-008). A pre-009 bookmark record
MUST continue to validate and restore exactly as today (FR-004) — this is the hard constraint the
version-check finding above directly addresses.

**Scale/Scope**: One file (`pdf-reader/app.js`). Adds: one new optional field in the bookmark
JSON shape, one new piece of transient session state
(`state.pendingResumeOffsetSeconds`), a few lines in `saveBookmark` (capture), `readBookmark`
(validate the optional field), the load flow (stage the pending offset), and `speakLocalChunk`
(consume it once).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS. The new field is a playback-position number,
  stored in the same `localStorage` mechanism already used for the chunk index — no new category
  of data, no filename/content/path ever persisted, consistent with the existing bookmark's
  privacy posture (a "passage index and a content-derived key," per the constitution's own
  wording, now joined by a within-passage offset of the same character).
- **Principle II (Narrow Product Surface)**: PASS. Closes a confirmed, narrow gap in an existing
  feature; introduces no new user-facing capability, control, or surface (FR-008).
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS. FR-004/FR-009's non-regression
  requirements are proven by the existing suite continuing to pass unmodified, plus a dedicated
  test constructing a pre-009-shaped bookmark record directly and confirming it still validates
  and restores correctly (this is the single most important test in this feature, mirroring how
  spec 008 verified substitutability). Each new observable behavior (offset capture, offset
  restore, one-shot consumption, invalid-offset fallback) gets its own small failing test.
- **Principle IV (Security Review as a Gate)**: N/A, justified — see Security Review below.
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS. No new abstraction — a few
  additional lines in four already-existing functions, plus one new transient state field. The
  "no version bump, purely additive optional field" decision (this plan's key finding) is itself
  the simpler path relative to the alternative (a version-gated branch in `readBookmark`), per
  Principle V — fewer moving parts, no risk of the strict-equality bug this plan identified.

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1 data-model.md/contracts/quickstart.md): PASS, unchanged.
The finalized design is exactly the additive-optional-field approach committed to at the initial
gate — confirmed during design that relying on the platform's own `Audio.currentTime` clamping
(research.md Decision 3) avoids needing any new validation logic beyond a simple finite-number
check, keeping this feature's total surface at a handful of lines across four existing functions
plus one new transient state field.

## Security Review

*(Constitution Principle IV — included per mandatory-section rule.)*

- **Applicable OWASP Top 10:2025 risks**: N/A. No new input path, network request, or third-party
  dependency. The new field is a number written to and read from the same already-reviewed
  `localStorage` mechanism (constitution-governed: "session and resume state MUST store the
  minimum data needed to function... never raw filenames, extracted text, or file bytes" — a
  playback-position number satisfies this exactly as the existing chunk index does).
- **Mitigations**: FR-005's fallback-to-zero requirement for an invalid/out-of-range offset is
  itself the relevant hardening here — it is the constitution's "corrupt bookmark data is
  discarded without blocking reading" principle applied to this one new field specifically,
  verified by a dedicated test (an out-of-range or non-numeric offset value must not prevent
  chunk-level resume from succeeding).
- **Key behavior-driven security tests planned via TDD**: A test confirming a bookmark record
  with a malformed/out-of-range offset field still resumes at chunk-start successfully (does not
  propagate an error, does not block reading) — extending the existing "corrupt bookmark data is
  discarded without blocking reading" test's spirit to this new field.

## Project Structure

### Documentation (this feature)

```text
specs/009-mid-chunk-resume/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
pdf-reader/
├── app.js               # Single source file (specs 001-008). This feature:
│                         #   - Extends saveBookmark to include an `offsetSeconds` field
│                         #     (Number.isFinite(state.audio?.currentTime) ? ... : omitted)
│                         #     alongside the existing version/index/savedAt fields — no version
│                         #     bump (see plan.md Summary's critical finding)
│                         #   - Extends readBookmark's validation to accept `offsetSeconds` when
│                         #     present as a finite, non-negative number, without requiring it
│                         #     (absence remains valid, per FR-004)
│                         #   - Extends the load flow (where readBookmark's result is consumed)
│                         #     to stage state.pendingResumeOffsetSeconds when the restored
│                         #     bookmark carries a valid offset
│                         #   - Extends speakLocalChunk to apply
│                         #     state.pendingResumeOffsetSeconds to the newly-created Audio
│                         #     element (state.audio.currentTime = offset) exactly once, clearing
│                         #     the pending value immediately after — and to fall back silently
│                         #     to time zero when the offset is invalid or exceeds the audio's
│                         #     actual duration (FR-005)
├── reader.test.js        # Same file; new tests appended, existing tests untouched
├── index.html            # NOT modified (explicit scope boundary)
└── styles.css            # NOT modified (explicit scope boundary)
```

**Structure Decision**: Single-file project, matching specs 001-008 — no new project, module, or
build step. All new logic lives in `pdf-reader/app.js` as small extensions to four existing
functions plus one new transient state field; all new tests live in `pdf-reader/reader.test.js`.

## Complexity Tracking

*No violations — this section is intentionally empty.*
