# Feature Specification: Blank Passage Rendering

**Feature Branch**: `010-blank-passage-rendering`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: the reading pane shows empty rows and its visible passage numbering
appears to skip. Reported as "the selection of a passage and presentation seems to show blank
lines". Diagnosis confirmed empirically: the reader renders one clickable passage per
reconstructed block, and a block whose text is entirely whitespace survives into that list
because passages are filtered on raw length rather than on whether any visible text remains. Each
such passage renders as a full-height clickable row that consumes a line of vertical space and a
passage number, and carries a playback target, so clicking it jumps playback to an unrelated part
of the document. A constraint found while diagnosing: the narrated-block list keeps a
corresponding empty entry for each whitespace block, and the reader only uses its exact
passage-to-chunk mapping when those two lists have equal length — so removing blank passages from
one list without the other silently drops every affected document back onto the slow approximate
mapping. Selection highlighting itself was investigated and found correct, and is out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The reading pane shows only real passages (Priority: P1)

A reader opens a document whose layout leaves some blocks containing nothing but whitespace — a
spacer line, a stray non-breaking space, an artefact of the original page geometry. The reading
pane shows a passage for every part of the document that has something to read, and no empty rows
between them. The passage numbers run consecutively down the pane with no apparent gaps.

**Why this priority**: This is the reported defect and the whole point of the feature. Empty rows
make the reading pane look broken, and because each one still claims a passage number, the
numbering appears to skip — so a reader cannot trust the pane as a map of the document.

**Independent Test**: Open a document containing at least one whitespace-only block and confirm
the reading pane renders no empty passage rows and that passage numbering is consecutive.

**Acceptance Scenarios**:

1. **Given** a document in which some blocks contain only whitespace, **When** the reader displays
   it, **Then** no passage is rendered for those blocks.
2. **Given** the same document, **When** the reader displays it, **Then** every rendered passage
   contains at least one visible character.
3. **Given** a document in which no block is whitespace-only, **When** the reader displays it,
   **Then** exactly the same passages are rendered as before this change.

---

### User Story 2 - Clicking a passage always starts reading that passage (Priority: P1)

A reader clicks a passage to start listening from there. Every row that can be clicked corresponds
to real text, so playback begins at the place the reader pointed at, rather than jumping to an
unrelated part of the document.

**Why this priority**: Equal in severity to the visual defect and the same root cause. A blank row
still carried a playback target, so clicking one moved playback somewhere the reader never
indicated. That is a correctness failure in the reader's primary interaction, not just a cosmetic
one.

**Independent Test**: In a document containing whitespace-only blocks, click each rendered passage
in turn and confirm playback begins at the clicked text.

**Acceptance Scenarios**:

1. **Given** a document containing whitespace-only blocks, **When** the reader inspects the
   reading pane, **Then** there is no clickable row that corresponds to a whitespace-only block.
2. **Given** any rendered passage, **When** the reader clicks it, **Then** playback begins at that
   passage's own text.

---

### User Story 3 - Documents keep their fast, exact passage mapping (Priority: P1)

A reader opens a document that happens to contain a whitespace-only block. Clicking a passage
still resolves instantly and lands on exactly the right place, the same as for a document with no
such blocks.

**Why this priority**: This is the trap that makes the fix non-trivial, and it is invisible if
untested. The reader only uses its exact passage-to-chunk mapping when the passage list and the
narrated-block list agree in length. Removing blank passages from only one of them makes them
disagree, so every document containing a single stray whitespace block would silently fall back to
the slower approximate mapping — which is both measurably slower and unable to distinguish two
passages with identical text. A fix that repaired the visible symptom while causing this
regression would look successful and be worse.

**Independent Test**: Open a document containing both whitespace-only blocks and at least one
repeated identical passage, and confirm that clicking the later of the two identical passages
starts reading at that occurrence rather than the earlier one — the behaviour only the exact
mapping provides.

**Acceptance Scenarios**:

1. **Given** a document containing whitespace-only blocks, **When** it is prepared for reading,
   **Then** the reader uses the exact passage-to-chunk mapping rather than the approximate one.
2. **Given** such a document that also contains two passages with identical text, **When** the
   reader clicks the later one, **Then** playback begins at that occurrence and not at the
   earlier one.

---

### Edge Cases

- A document in which **every** block is whitespace-only: the reading pane must show the document
  as having no readable text, using the existing message for that case, rather than rendering an
  empty pane or failing.
- A block containing a single non-breaking space, or other whitespace that is not a plain space:
  treated as blank, exactly as a run of spaces is.
- A block whose text is a single visible character (for example a lone `.` or a page number
  digit): **not** blank. It has something to show and must still render as a passage.
- A block with leading or trailing whitespace around real text: not blank; it renders with its
  text intact and unmodified.
- A document with no whitespace-only blocks at all: completely unaffected, rendering the identical
  passages it did before.
- Documents with no reconstructed block structure at all (for example EPUBs, or PDFs whose pages
  carry no usable position data), which already use the approximate mapping: unaffected, and must
  not gain blank rows either.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reader MUST NOT render a passage for a block whose text contains no visible
  characters.
- **FR-002**: Every rendered passage MUST contain at least one visible character.
- **FR-003**: The reader MUST render the text of each non-blank passage unchanged, including any
  leading or trailing whitespace around its visible text.
- **FR-004**: Visible passage numbering MUST be consecutive across the rendered passages, with no
  number consumed by an unrendered block.
- **FR-005**: Every clickable passage MUST correspond to text that exists in the document, and
  clicking it MUST begin playback at that passage.
- **FR-006**: The narrated-block list MUST exclude the same blocks the passage list excludes, so
  that the two remain aligned.
- **FR-007**: A document containing whitespace-only blocks MUST continue to use the exact
  passage-to-chunk mapping, not the approximate fallback.
- **FR-008**: A document containing no whitespace-only blocks MUST render exactly the passages it
  rendered before this change.
- **FR-009**: The spoken output MUST be unchanged: the same words, in the same order, split into
  the same speech chunks as before this change.
- **FR-010**: Saved reading positions MUST continue to refer to the same place in the document as
  before this change.
- **FR-011**: A document in which every block is blank MUST be reported as having no readable
  text, using the reader's existing handling for that case.
- **FR-012**: Documents that have no reconstructed block structure MUST be unaffected by this
  change, and MUST NOT render blank passages either.

### Key Entities

- **Passage**: One readable, clickable unit shown in the reading pane, corresponding to one
  reconstructed block of the document. Carries the text shown to the reader, whether that text is
  narrated, and which part of the audio it starts.
- **Narrated block**: The spoken form of one block, used to generate speech. Exists only for
  blocks the speech policy includes. Must stay positionally aligned with the narrated passages.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A document containing whitespace-only blocks renders zero empty passage rows.
- **SC-002**: Passage numbers shown in the reading pane are consecutive from the first passage to
  the last, with no gaps, for every document.
- **SC-003**: 100% of clickable passages begin playback at their own text.
- **SC-004**: A document containing whitespace-only blocks resolves a passage click as quickly as
  an equivalent document without them, and distinguishes repeated identical passages correctly.
- **SC-005**: For documents with no whitespace-only blocks, the rendered passages, the spoken
  words, and the speech chunk boundaries are all byte-for-byte identical to before this change.

## Assumptions

- "No visible characters" means the text consists solely of whitespace, including spaces, tabs,
  newlines, and non-breaking spaces. A single visible character, including punctuation or a digit,
  makes a passage non-blank.
- Whitespace-only blocks arise from the source document's layout rather than from a defect in
  block reconstruction, so excluding them at render time is the correct treatment; reconstruction
  itself is out of scope.
- The existing behaviour for documents with no readable text is correct and is reused rather than
  redefined.
- Selection highlighting is already correct — the active passage highlight moves as soon as a
  passage is clicked — and is out of scope. The reported selection problem is a consequence of
  blank rows being clickable and is expected to disappear once they are not rendered.
- No change to speech chunking, to the speech policy that decides which blocks are narrated, or to
  how reading positions are stored is needed or intended.
