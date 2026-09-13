# Feature Specification: Highlight and Narration Synchronisation

**Feature Branch**: `011-highlight-narration-sync`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "the highlighting is not in sync with the reading". Investigation
reproduced three separate defects in how the reading pane decides which passage is currently being
read, each measured against the real pipeline rather than inferred:

1. The highlight goes dark part-way through a paragraph. A passage is marked active only when the
   chunk being narrated is the passage's *first* chunk. A paragraph longer than the narration
   chunk size spans several chunks, so it lights up for the first one and then goes dark while its
   own remaining text is still being read aloud. Measured end to end: a 700-character paragraph
   leaves 1 of 4 narration units with nothing highlighted, a 1400-character paragraph 4 of 7, and
   a 3000-character paragraph 11 of 14. The effect grows with paragraph length, so it is worst on
   ordinary long body paragraphs.
2. The highlight runs ahead of the voice. It moves when narration audio is *requested* rather than
   when it *begins playing*. Measured: while audio for the first passage was still being prepared,
   the pane already showed that passage highlighted with no audio playing at all. Preparation
   costs roughly a second and a half or more when the audio is not already prepared, and less when
   it is, so the lead varies unpredictably. The same happens at every passage boundary.
3. Several passages highlight at once. Short adjacent passages are read together as one unit of
   narration, and every passage sharing that unit is marked active simultaneously. Measured: five
   short passages produced four simultaneously-highlighted rows.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The highlight stays on the paragraph being read (Priority: P1)

A reader listens to a long paragraph. The paragraph stays highlighted from its first word to its
last, for the whole time it is being narrated — it does not light up briefly and then go dark while
the voice is still reading it.

**Why this priority**: This is the most visible and most frequent failure. Ordinary body
paragraphs exceed the narration chunk size, so on a real book the highlight goes dark part-way
through most paragraphs, leaving the reader with no indication of where the voice is for the
majority of the reading time.

**Independent Test**: Play a document containing a paragraph long enough to be narrated in several
parts, and confirm that paragraph remains highlighted throughout, including while its later parts
are being read.

**Acceptance Scenarios**:

1. **Given** a paragraph long enough to be narrated in several parts, **When** any part of it is
   being read, **Then** that paragraph is the highlighted one.
2. **Given** such a paragraph, **When** narration moves from one of its parts to the next,
   **Then** the highlight does not disappear or move to another paragraph.
3. **Given** a document being narrated, **When** any moment during playback is examined, **Then**
   exactly one passage is highlighted.

---

### User Story 2 - Exactly one passage is highlighted at a time (Priority: P1)

A reader listens to a passage of short paragraphs — a list, a sequence of headings, a run of brief
lines. One paragraph is highlighted at a time, so the reader can follow which one the voice is on.

**Why this priority**: Several rows highlighting at once is not a subtle timing issue; it removes
the highlight's meaning entirely for that part of the document, because it no longer points at
anything in particular.

**Independent Test**: Play a document whose paragraphs are short enough to be narrated together and
confirm only one passage is highlighted at any moment.

**Acceptance Scenarios**:

1. **Given** several short passages read together as one unit of narration, **When** that unit is
   being read, **Then** exactly one of those passages is highlighted.
2. **Given** the same document, **When** narration proceeds, **Then** the highlight advances
   through those passages rather than marking several at once.

---

### User Story 3 - The highlight matches what the voice is saying (Priority: P2)

A reader following along sees the highlight move onto a paragraph at the moment the voice starts
reading that paragraph, not noticeably before it.

**Why this priority**: Lower than the other two because the highlight is at least pointing at the
right paragraph, just early. It is still a genuine synchronisation failure — the reader's eye is
pulled forward while the voice is still finishing the previous passage — but unlike US1 and US2 the
reader is never left with no usable highlight. It is also the story whose fix carries the most risk
of introducing a worse problem (a gap with nothing highlighted), so it is sequenced after the two
that are unambiguous improvements.

**Independent Test**: Begin playback with audio preparation artificially delayed and confirm the
highlight does not advance onto the new passage until its audio actually begins.

**Acceptance Scenarios**:

1. **Given** playback is starting and audio for the first passage is still being prepared,
   **When** the reading pane is examined, **Then** the highlight has not yet advanced past where
   the reader actually is.
2. **Given** narration finishes one passage and the next passage's audio is still being prepared,
   **When** the reading pane is examined, **Then** some passage is still highlighted — the pane is
   never left with nothing marked.
3. **Given** audio for a passage begins playing, **When** the reading pane is examined, **Then**
   that passage is the highlighted one.

---

### Edge Cases

- **A passage that is never narrated** (a footnote, header, caption or table): it is visible and
  clickable but its text is never spoken, so it is never the highlighted passage. The highlight
  stays on the narrated passage the voice is actually reading.
- **The very first moment of playback**, before any audio has begun: some passage must be
  highlighted so the reader can see where narration is about to start.
- **A document whose passages do not correspond to narration units** (an EPUB, or a PDF with no
  usable layout information): highlighting must still mark exactly one passage and must not go
  dark, even though the correspondence is approximate.
- **Seeking by clicking a passage**: the clicked passage becomes the highlighted one immediately,
  so the reader gets instant feedback that their click registered.
- **Pausing and resuming**: the highlighted passage does not change while paused.
- **The last passage of a document**: it stays highlighted until narration ends, rather than going
  dark after its first part.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A passage MUST be highlighted for the entire time any part of it is being narrated,
  not only while its first part is read.
- **FR-002**: At most one passage MUST be highlighted at any moment.
- **FR-003**: At least one passage MUST be highlighted at any moment during active playback,
  including while the next passage's audio is being prepared.
- **FR-004**: When several passages are narrated together as one unit, the system MUST highlight
  exactly one of them, chosen by a rule that is stable and produces the same result every time for
  the same document.
- **FR-005**: The highlight MUST move onto a passage when that passage's narration begins playing,
  not when its audio is requested.
- **FR-006**: Clicking a passage MUST highlight it immediately, without waiting for its audio.
- **FR-007**: The highlighted passage MUST NOT change while playback is paused.
- **FR-008**: Every passage that is narrated MUST be highlightable — no narrated passage may be
  unreachable by the highlight during a complete playthrough.
- **FR-009**: A passage that is never narrated MUST NOT become the highlighted passage during
  playback.
- **FR-010**: The spoken output MUST be unchanged: the same words, in the same order, divided into
  the same units of narration as before this change.
- **FR-011**: Saved reading positions MUST continue to refer to the same place in the document.
- **FR-012**: Documents whose passages do not correspond to narration units MUST still satisfy
  FR-002 and FR-003.

### Key Entities

- **Passage**: One readable, clickable unit shown in the reading pane. Already carries which unit
  of narration it starts at. This feature additionally requires knowing the *range* of narration
  units it covers, so it can stay highlighted across all of them.
- **Narration unit**: One continuous piece of spoken audio. May cover part of a passage, exactly
  one passage, or several short passages.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: During a complete playthrough of any document, exactly one passage is highlighted at
  every moment — never zero, never more than one.
- **SC-002**: For a paragraph narrated in several parts, the same paragraph remains highlighted for
  100% of the time it is being read.
- **SC-003**: Across a document of any paragraph length, no moment of playback leaves the reading
  pane with no passage highlighted. Measured against the current behaviour, where a 1400-character
  paragraph leaves 4 of 7 narration units with nothing highlighted.
- **SC-004**: The highlight advances onto a passage no earlier than the moment its narration begins
  playing.
- **SC-005**: Clicking a passage highlights it with no perceptible delay.
- **SC-006**: The spoken words, their order, and the division of the document into narration units
  are byte-for-byte identical to before this change, for every document.

## Assumptions

- **The highlight persists rather than clearing during preparation.** FR-003 and FR-005 pull in
  opposite directions: moving the highlight to the moment audio starts would otherwise leave the
  pane blank for the second or more it takes to prepare the next passage. The resolution assumed
  here is that the previously-highlighted passage stays highlighted until the next one actually
  begins, so the highlight is always on the passage the voice is reading or has just finished —
  never ahead of it, and never absent. No new visual state (such as a "preparing" indicator) is
  introduced, since that would add user-facing surface this project's principles direct us to
  avoid.
- **When several passages share one narration unit, the first of them is highlighted.** Any stable
  rule satisfies FR-004; the first is chosen because narration of that unit does begin with that
  passage's text, so it is the one the voice is actually reading at the moment the unit starts.
- The existing passage list and the existing correspondence between passages and narration units
  are correct and are not changed by this feature — only how the active passage is resolved from
  them, and when the resolution is applied.
- Clicking a passage already highlights it immediately today; FR-006 records that this must be
  preserved, not newly built.
- The existing test asserting that the playing paragraph is highlighted pins only that some passage
  is active during playback, not its timing, so it constrains none of the changes above.
