# Implementation Plan: Blank Passage Rendering

**Branch**: `010-blank-passage-rendering` | **Date**: 2026-09-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-blank-passage-rendering/spec.md`

## Summary

The reading pane renders one clickable passage per reconstructed block. `documentPassages` filters
those blocks on `text.length > 0`, which admits a block whose text is entirely whitespace. Such a
passage renders as a full `.literal-paragraph` button — `margin: 0 0 1em`, padding, and an
unconditional `counter-increment` — so it occupies a visible empty row *and* consumes a paragraph
number, which is why the numbering appears to skip. It also carries a `data-chunk-index`, so
clicking it jumps playback to an unrelated chunk.

Reproduced directly: a four-block document with two whitespace-only blocks renders 4 passages, 2
of them blank.

**The critical finding, and the reason this is not a one-line fix.** `renderNarrationBlocks` keeps
a corresponding empty string for each whitespace block, so `narrationBlocks.length` counts them
too. `buildChunksAndMapping` only takes the exact O(1) passage→chunk path when

```text
narratedPassages.length === result.narrationBlocks.length
```

Filtering blanks out of `documentPassages` alone breaks that equality. Measured on the
reproduction fixture:

```text
narrationBlocks:  ["Real first paragraph.", "", "", "Real second paragraph."]   (4)
narrated passages, filtered:                                                      2
GUARD before fix: true      GUARD after naive fix: false
```

Every document containing one stray whitespace block would silently fall off the exact mapping
onto the ~1350ms word-overlap similarity search — which is not only slower but cannot distinguish
two passages with identical text. The naive fix therefore passes the visible acceptance criteria
while regressing both performance and click accuracy, invisibly. Both lists must be filtered in
lockstep, and the spec states that as an independently testable outcome (US3).

**Technical approach**: change the filter predicate in `documentPassages` and `resolvePassages`
from "has length" to "has a visible character", and exclude the same blocks in
`renderNarrationBlocks` so the two lists stay aligned. No change to chunking, speech policy,
bookmark storage, or the rendering sink.

**Out of scope, verified not broken**: selection highlighting. `renderPlaybackText(state.chunkIndex)`
runs *before* the `await` in `speakLocalChunk`, so the active highlight moves immediately on
click. The reported selection problem is a downstream symptom of blank rows being clickable.

## Technical Context

**Language/Version**: JavaScript (ES2022), browser-targeted, no build step

**Primary Dependencies**: None added. PDF.js 4.10.38 and fflate 0.8.3 remain vendored and pinned.

**Storage**: N/A for this feature — `localStorage` bookmarks and the IndexedDB audio cache are
untouched (FR-010)

**Testing**: `node --test pdf-reader/reader.test.js` (Node's built-in runner), 219 passing at
baseline

**Target Platform**: Modern browsers, served as static files from localhost

**Project Type**: Single-project static web application

**Performance Goals**: Preserve the exact passage→chunk mapping (~10ms at book scale) rather than
regressing to the word-overlap fallback (~1350ms at book scale, measured)

**Constraints**: Offline-capable; extracted document text is untrusted and rendered only as
literal text; spoken output and chunk boundaries must be byte-for-byte unchanged (FR-009)

**Scale/Scope**: Two filter predicates and one list construction in `pdf-reader/app.js`; new
behavioral tests in `pdf-reader/reader.test.js`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Principle I (Local-First Privacy)**: PASS. No new input path, no network request, no new
  persisted data. The change removes entries from an in-memory list built from already-parsed
  document text.
- **Principle II (Narrow Product Surface)**: PASS. Fixes a defect in the existing reading pane.
  Adds no capability, control, or surface. Passes the "does this make a document better to listen
  to?" test directly: blank rows currently misdirect playback when clicked.
- **Principle III (Behavior-Driven TDD, NON-NEGOTIABLE)**: PASS. Each user story maps to a failing
  test written first, asserting observable outcomes — rendered passage text (US1), which rows are
  clickable (US2), and whether repeated identical passages resolve to distinct chunks (US3). US3
  is the one that catches the guard regression the naive fix would introduce; without it the
  regression is invisible. FR-008/FR-009's non-regression requirements are proven by the existing
  219 tests continuing to pass unmodified.
- **Principle IV (Security Review as a Gate)**: PASS — see Security Review below. This touches the
  rendering path for untrusted document text, so the review is mandatory rather than N/A.
- **Principle V (Simplicity & Cyclomatic Discipline)**: PASS. The change is a predicate swap in
  two existing filters plus one added filter, introducing no new branch, abstraction, or
  configuration surface. No function's cyclomatic complexity increases.

**Initial gate result**: PASS. No violations requiring Complexity Tracking entries.

**Post-design re-check** (after Phase 1 data-model.md/contracts/quickstart.md): PASS, unchanged.
The finalized design is the lockstep-filter approach committed to at the initial gate. Design
confirmed that filtering at the two list-construction sites (rather than at render time, or by
mutating block classification) keeps the alignment invariant local and checkable, and adds no
state.

## Security Review

*(Constitution Principle IV — mandatory: this feature touches the rendering path for untrusted
document text.)*

**Applicable OWASP Top 10:2025 risks**:

- **A07:2025 Injection** — APPLICABLE. Passage text originates in an untrusted PDF or EPUB. The
  constitution requires extracted content be "rendered as literal text only, never interpreted as
  HTML/markup or executed." This feature changes *which* passages are rendered, not *how*.
  **Mitigation**: the rendering sink is unchanged — `buildPassageButton` continues to assign
  `block.textContent`, never `innerHTML`. The existing tests "renderExtractedText treats PDF
  content as literal text" and "EPUB chapter markup is rendered as literal text, never executed or
  injected" must continue to pass unmodified, and a whitespace-only block containing markup-like
  characters is not a new vector because such a block has no visible characters by definition and
  is dropped before reaching the sink.
- **A08:2025 Mishandling of Exceptional Conditions** — APPLICABLE, and the substantive risk here.
  Two distinct exceptional conditions:
  1. *A document in which every block is blank* must report "no readable text" through the
     existing path rather than rendering an empty pane or throwing (FR-011).
  2. *The alignment invariant* between the passage list and the narrated-block list. A silent
     divergence does not throw — it degrades to the approximate mapping, which is precisely the
     class of failure that hides. **Mitigation**: filter both lists at the same predicate, and
     pin the outcome with a behavioral test (US3) that fails if the exact mapping is lost.
- **A01:2025 Broken Access Control** — N/A. No authentication, authorization, or multi-user
  surface exists in this application.
- **A02:2025 Security Misconfiguration** — N/A. No change to the CSP or to hosting configuration.
- **A03:2025 Software Supply Chain Failures** — N/A. No dependency added, removed, or updated.
- **A04:2025 Cryptographic Failures** — N/A. Bookmark key derivation (SHA-256 over file bytes) is
  untouched.
- **A05:2025 Identification and Authentication Failures** — N/A. No identity surface.
- **A09:2025 SSRF** — N/A. No new network path; loopback-only TTS validation untouched.

**Key behavior-driven security tests planned via TDD**:

- A document whose blocks are all whitespace reports no readable text and does not render an empty
  clickable pane (FR-011, A08).
- A document containing whitespace-only blocks still resolves repeated identical passages to
  distinct chunks, proving the exact mapping survived (FR-007/US3, A08).
- The existing literal-text rendering tests continue to pass unmodified (A07).

## Project Structure

### Documentation (this feature)

```text
specs/010-blank-passage-rendering/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── blank-passage-rendering.md
├── checklists/
│   └── requirements.md  # Created by /speckit-specify
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
pdf-reader/
├── app.js               # documentPassages, resolvePassages, renderNarrationBlocks
├── reader.test.js       # new behavioral tests for US1, US2, US3
├── index.html           # unchanged
└── styles.css           # unchanged
```

**Structure Decision**: Single project, matching every prior spec in this repository (001–009).
No new files. Implementation touches `pdf-reader/app.js` only; tests are added to
`pdf-reader/reader.test.js`. `index.html` and `styles.css` are explicitly unchanged — the blank
rows are caused by which passages are constructed, not by how they are styled, so no CSS rule is
edited (a CSS-only fix such as `:empty { display: none }` was rejected in research.md Decision 3
because it would hide the row while leaving it clickable and still consuming a counter number).

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.
